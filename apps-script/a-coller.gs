// Réservations du festival — fichier unique à coller dans Apps Script.
// Fabriqué par assembler.py depuis Code.js, Reservations.js et Admin.html (dépôt GitHub festival-reservations) :
// pour changer le code, modifier ces fichiers-là puis relancer l'assemblage.

/**
 * Réservations du festival — application Google Apps Script liée à la feuille du festival.
 *
 * Menu « Festival » de la feuille :
 *   - Lien de l'appli : affiche l'adresse pour le site et le lien personnel de l'appli de gestion.
 *   - Changer la clé du lien : l'ancien lien personnel ne marche plus.
 *   - Activer la mise à jour automatique / Mettre à jour maintenant : le code vient de GitHub (voir MiseAJour.js).
 */

var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Festival')
    .addItem("Lien de l'appli de gestion", 'lienAppli')
    .addItem('Changer la clé du lien', 'changerCleAppli')
    .addSeparator()
    .addItem('Activer la mise à jour automatique', 'activerMiseAJour')
    .addItem('Mettre à jour le script maintenant', 'mettreAJourMaintenant')
    .addToUi();
}

/** "2026-10-17" -> "17 octobre 2026" (et "1er" pour le premier du mois). */
function texteDate_(iso) {
  var p = iso.split('-').map(Number);
  return (p[2] === 1 ? '1er' : p[2]) + ' ' + MOIS[p[1] - 1] + ' ' + p[0];
}

function mettreAJourMaintenant() { SpreadsheetApp.getUi().alert('Mise à jour', verifierMiseAJour(), SpreadsheetApp.getUi().ButtonSet.OK); }

/**
 * Réservations du festival — même principe que Wix Events (et que le Festival L'Escalier) :
 * des événements avec un nombre de places, un formulaire sur le site, un e-mail de confirmation.
 *
 * Données : deux onglets de la feuille Google, « Événements » et « Réservations ».
 * Application web (Déployer > Application web, exécuter en tant que moi, accès : tout le monde) :
 *   GET  ?api=evenements          -> liste publique des événements à venir (pour le site)
 *   POST {api:"reserver", ...}    -> enregistre une réservation et envoie les e-mails
 *   GET  ?cle=<clé>               -> l'application de gestion (écran Admin.html)
 * La clé est créée au premier passage sur l'adresse de l'application (ou menu Festival > Lien de l'appli) :
 * elle n'est écrite nulle part ailleurs.
 */

var RESA = {
  ongletEvenements: 'Événements',
  ongletReservations: 'Réservations',
  maxParReservation: 10,
  cleAdmin: 'RESA_CLE_ADMIN',
  cleReglages: 'RESA_REGLAGES',
  dossierPhotos: 'Petit Festival · photos du site',
  cleDossierPhotos: 'RESA_DOSSIER_PHOTOS',
  cleComptes: 'RESA_COMPTES',
  cleAppareils: 'RESA_APPAREILS',
  dureeAppareil: 180, // jours sans utilisation avant de redemander le code PIN
};

var COL_EV = ['id', 'Titre', 'Spectacle', 'Compagnie', 'Date', 'Début', 'Fin', 'Durée', 'Âge', 'Lieu', 'Adresse',
  'Description', 'Tarif', 'Places', 'Statut', 'Image', 'Créé le', 'Liste d\'attente', 'Texte long', 'Distribution', 'Vidéo'];
var CHAMPS_EV = ['id', 'titre', 'spectacle', 'compagnie', 'date', 'debut', 'fin', 'duree', 'age', 'lieu', 'adresse',
  'description', 'tarif', 'places', 'statut', 'image', 'cree', 'attente', 'long', 'distribution', 'video'];

// Adresse de l'appli de gestion (page GitHub installable comme une icône, ordinateur et téléphone)
var GESTION_URL = 'https://sevanegu-pixel.github.io/festival-reservations/';
var COL_RES = ['id', 'Événement (id)', 'Événement', 'Reçue le', 'Nom', 'E-mail', 'Téléphone', 'Places', 'Message', 'Statut', 'Arrivée'];
var CHAMPS_RES = ['id', 'evenement', 'titreEvenement', 'recue', 'nom', 'email', 'telephone', 'places', 'message', 'statut', 'arrivee'];

// Statuts d'un événement : Ouvert (réservable), Fermé (affiché, sans réservation), Brouillon (caché), Annulé (caché)
var STATUTS_EV = ['Ouvert', 'Fermé', 'Brouillon', 'Annulé'];

var REGLAGES_DEFAUT = {
  nomFestival: 'Le Petit Festival au Théâtricul',
  siteUrl: 'https://petit-festival.ch/apercu/',
  copieA: 'petitfestival.ge@gmail.com',
  sujet: 'Votre réservation : {titre}',
  message: 'Bonjour {nom},\n\nNous avons bien reçu votre réservation de {places} place(s) pour « {titre} », ' +
    'le {date} à {heure}, {lieu}.\n\nLe paiement se fait sur place.\n\n' +
    'Pour annuler ou changer votre réservation, répondez simplement à cet e-mail.\n\nÀ bientôt !\n{festival}',
  sujetAnnulation: 'Réservation annulée : {titre}',
  messageAnnulation: 'Bonjour {nom},\n\nVotre réservation pour « {titre} » du {date} a été annulée.\n\n{festival}',
  sujetAttente: 'Liste d\'attente : {titre}',
  messageAttente: 'Bonjour {nom},\n\nC\'est complet pour « {titre} » le {date} à {heure}, mais vous êtes sur la liste d\'attente pour {places} place(s). ' +
    'Dès qu\'une place se libère, nous vous écrivons pour confirmer.\n\n{festival}',
  piedDePage: '{festival}\n{adresse}\n{site}\nPour toute question, répondez simplement à cet e-mail.',
  billet: 'Oui',
};

// ---------- Point d'entrée web ----------

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.api === 'evenements') return json_({ festival: reglages_().nomFestival, evenements: evenementsPublics_() });
  if (p.cle && cleValide_(p.cle)) {
    var t = typeof ADMIN_HTML !== 'undefined' ? HtmlService.createTemplate(ADMIN_HTML) : HtmlService.createTemplateFromFile('Admin');
    t.cle = p.cle;
    return t.evaluate()
      .setTitle('Réservations · ' + reglages_().nomFestival)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (!PropertiesService.getScriptProperties().getProperty(RESA.cleAdmin)) return premiereOuverture_();
  return ContentService.createTextOutput('Ouvrez le lien personnel de l\'application.');
}

/**
 * Tout premier passage sur l'adresse de l'application, juste après le déploiement : la clé est créée
 * à ce moment-là et le lien personnel s'affiche. L'adresse publique (pas la clé) est notée dans
 * l'onglet « Réglages » pour pouvoir la brancher sur le site.
 */
function premiereOuverture_() {
  var verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(RESA.cleAdmin)) return ContentService.createTextOutput('Ouvrez le lien personnel de l\'application.');
    var cle = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty(RESA.cleAdmin, cle);
    var url = ScriptApp.getService().getUrl();
    onglet_(RESA.ongletEvenements, COL_EV);
    onglet_(RESA.ongletReservations, COL_RES);
    var reglages = onglet_('Réglages', ['Réglage', 'Valeur']);
    reglages.appendRow(['Adresse de l\'application (pour le site)', url]);
    var lien = GESTION_URL + '?cle=' + cle + '&exec=' + encodeURIComponent(url);
    return HtmlService.createHtmlOutput(
      '<div style="font:17px/1.5 sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#111">' +
      '<h1 style="font-size:24px">C\'est installé !</h1>' +
      '<p>Voici <b>votre lien personnel</b> vers l\'appli de gestion des réservations. Il l\'ouvre sans mot de passe : ' +
      'ajoutez-le à vos favoris, installez l\'icône (ordinateur ou téléphone) et ne le partagez pas.</p>' +
      '<p><a href="' + lien + '" target="_top" style="display:inline-block;background:#ff5a5f;color:#1a0607;' +
      'padding:12px 22px;border-radius:999px;font-weight:600;text-decoration:none">Ouvrir l\'application</a></p>' +
      '<p style="font-size:14px;color:#555">Le lien :<br><input readonly style="width:100%" value="' + lien + '" onclick="this.select()"></p>' +
      '<p style="font-size:14px;color:#555">Ce lien ne s\'affiche qu\'une fois. Si vous le perdez : dans la feuille, ' +
      'menu Festival &gt; Lien de l\'appli de gestion.</p></div>')
      .setTitle('Réservations du festival');
  } finally {
    verrou.releaseLock();
  }
}

function doPost(e) {
  var donnees;
  try {
    donnees = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, erreur: 'Demande illisible.' });
  }
  if (donnees.api === 'reserver') return json_(reserver_(donnees));
  if (donnees.api === 'admin') return json_(adminApi_(donnees));
  return json_({ ok: false, erreur: 'Demande inconnue.' });
}

/**
 * Appli de gestion hébergée sur GitHub Pages (sans le bandeau Google) : elle appelle les fonctions admin*
 * par POST {api:'admin', cle|pin, fn, args}. On entre soit avec le lien personnel (clé), soit avec le code PIN
 * d'un compte (Sévane ou un·e bénévole) ; chaque compte a ses droits.
 */
var DROITS = [
  ['reservations', 'Réservations : voir la liste, pointer les arrivées, ajouter ou annuler'],
  ['evenements', 'Événements : modifier les textes, dates, places et photos'],
  ['publier', 'Publier : changer ce qui est visible sur le site (statut Ouvert, Fermé, Brouillon)'],
  ['photos', 'Galerie : ajouter, recadrer ou supprimer des photos'],
  ['reglages', 'Réglages : e-mails de confirmation, adresse du site'],
  ['comptes', 'Comptes : créer des codes PIN et choisir leurs droits (administration)']
];
var FONCTION_DROIT = {
  adminCharger: null,
  adminEnregistrerEvenement: 'evenements', adminSupprimerEvenement: 'evenements',
  adminAjouterReservation: 'reservations', adminAnnulerReservation: 'reservations', adminPointer: 'reservations', adminConfirmerReservation: 'reservations',
  adminEnregistrerReglages: 'reglages', adminEssaiMail: 'reglages',
  adminEnregistrerImage: 'photos', adminListerPhotos: 'photos', adminLireImage: 'photos', adminSupprimerPhoto: 'photos', adminEnregistrerVisuel: 'photos',
  adminListerComptes: 'comptes', adminEnregistrerCompte: 'comptes', adminSupprimerCompte: 'comptes', adminMettreAJour: 'comptes',
  adminListerAppareils: 'comptes', adminDeconnecterAppareil: 'comptes', adminQuitterAppareil: null
};
function adminApi_(d) {
  try {
    if (!(d.fn in FONCTION_DROIT)) throw new Error('Fonction inconnue.');
    var compte = acces_(d), droit = FONCTION_DROIT[d.fn];
    if (droit && !compte.droits[droit]) throw new Error('Votre compte (' + compte.nom + ') n\'a pas ce droit : ' + droit + '.');
    var args = Array.isArray(d.args) ? d.args : [];
    if (d.fn === 'adminEnregistrerEvenement' && !compte.droits.publier) args[0] = sansPublication_(args[0]);
    var cle = PropertiesService.getScriptProperties().getProperty(RESA.cleAdmin);
    var res = d.fn === 'adminQuitterAppareil' ? adminQuitterAppareil(cle, compte.appareil) : globalThis[d.fn].apply(null, [cle].concat(args));
    if (res && res.evenements && res.reglages) { // réponse adminCharger : on y joint le compte, et on cache les contacts à qui n'a pas le droit
      res.compte = { id: compte.id, nom: compte.nom, droits: compte.droits, appareil: compte.appareil || '' };
      if (compte.jeton) res.jeton = compte.jeton; // nouvel appareil : il garde ce jeton et n'a plus à redonner le code
      res.version = VERSION_CODE;
      res.droits = DROITS;
      if (!compte.droits.reservations) res.reservations = res.reservations.map(function (r) { return { id: r.id, evenement: r.evenement, places: r.places, statut: r.statut }; });
      if (!compte.droits.reglages && !compte.droits.comptes) res.reglages = { nomFestival: res.reglages.nomFestival, siteUrl: res.reglages.siteUrl };
    }
    return { ok: true, resultat: res };
  } catch (err) {
    return { ok: false, erreur: err.message || String(err), pin: /PIN/.test(err.message || '') };
  }
}
/** Sans le droit de publier, le statut reste celui qui est enregistré (Brouillon pour un nouvel événement). */
function sansPublication_(ev) {
  ev = ev || {};
  var ancien = ev.id ? lireEvenements_().filter(function (x) { return x.id === ev.id; })[0] : null;
  ev.statut = ancien ? ancien.statut : 'Brouillon';
  return ev;
}
function tousDroits_() { var o = {}; DROITS.forEach(function (d) { o[d[0]] = true; }); return o; }
function acces_(d) {
  if (d.cle && cleValide_(d.cle)) return { id: 'cle', nom: 'Lien personnel', droits: tousDroits_() };
  if (d.jeton) return accesParJeton_(String(d.jeton));
  var pin = String(d.pin || '');
  if (!pin) throw new Error('Code PIN requis.');
  if (!/^\d{4,8}$/.test(pin)) throw new Error('Code PIN incorrect.');
  var cache = CacheService.getScriptCache(), echecs = Number(cache.get('pin_echecs') || 0);
  if (echecs >= 15) throw new Error('Trop d\'essais de code PIN : réessayez dans dix minutes.');
  var comptes = comptes_(), c = null;
  for (var i = 0; i < comptes.length; i++) if (comptes[i].hash === hashPin_(pin, comptes[i].id)) { c = comptes[i]; break; }
  if (!c) { cache.put('pin_echecs', String(echecs + 1), 600); throw new Error('Code PIN incorrect.'); }
  cache.remove('pin_echecs');
  var acces = { id: c.id, nom: c.nom, droits: c.droits || {} };
  if (d.appareil && d.appareil.id) { // on retient l'appareil : un jeton remplace le code PIN pour la suite
    var jeton = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    var l = appareils_().filter(function (a) { return a.id !== d.appareil.id; });
    l.push({ id: String(d.appareil.id).slice(0, 40), compte: c.id, nom: String(d.appareil.nom || 'Appareil').slice(0, 80), hash: hashPin_(jeton, 'appareil'), cree: maintenant_(), dernier: maintenant_(), ts: Date.now() });
    ecrireAppareils_(l);
    acces.jeton = jeton; acces.appareil = d.appareil.id;
  }
  return acces;
}
// ----- Appareils connectés : un jeton par appareil, lié à un compte -----
function appareils_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(RESA.cleAppareils) || '[]') || []; } catch (e) { return []; }
}
function ecrireAppareils_(l) { PropertiesService.getScriptProperties().setProperty(RESA.cleAppareils, JSON.stringify(l)); }
function accesParJeton_(jeton) {
  var h = hashPin_(jeton, 'appareil'), l = appareils_(), a = l.filter(function (x) { return x.hash === h; })[0];
  if (!a) throw new Error('Cet appareil a été déconnecté : redonnez le code PIN.');
  var dernier = Number(a.ts) || 0;
  if (dernier && Date.now() - dernier > RESA.dureeAppareil * 864e5) { ecrireAppareils_(l.filter(function (x) { return x !== a; })); throw new Error('Cet appareil n\'a plus servi depuis longtemps : redonnez le code PIN.'); }
  var c = comptes_().filter(function (x) { return x.id === a.compte; })[0];
  if (!c) { ecrireAppareils_(l.filter(function (x) { return x !== a; })); throw new Error('Ce compte n\'existe plus : redonnez le code PIN.'); }
  if (Date.now() - dernier > 36e5) { a.dernier = maintenant_(); a.ts = Date.now(); ecrireAppareils_(l); }
  return { id: c.id, nom: c.nom, droits: c.droits || {}, appareil: a.id };
}
function adminListerAppareils(cle) {
  verifierCle_(cle);
  var noms = {}; comptes_().forEach(function (c) { noms[c.id] = c.nom; });
  return appareils_().map(function (a) { return { id: a.id, compte: noms[a.compte] || '(compte supprimé)', nom: a.nom, cree: a.cree, dernier: a.dernier }; }).reverse();
}
function adminDeconnecterAppareil(cle, id) {
  verifierCle_(cle);
  ecrireAppareils_(appareils_().filter(function (a) { return a.id !== id; }));
  return adminListerAppareils(cle);
}
/** « Quitter » dans l'appli : l'appareil courant oublie son jeton côté script aussi. */
function adminQuitterAppareil(cle, idAppareil) {
  if (idAppareil) ecrireAppareils_(appareils_().filter(function (a) { return a.id !== idAppareil; }));
  return true;
}
function hashPin_(pin, id) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin + '|' + id + '|petit-festival', Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function comptes_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(RESA.cleComptes) || '[]') || []; } catch (e) { return []; }
}
function ecrireComptes_(l) { PropertiesService.getScriptProperties().setProperty(RESA.cleComptes, JSON.stringify(l)); }
function adminListerComptes(cle) {
  verifierCle_(cle);
  return { comptes: comptes_().map(function (c) { return { id: c.id, nom: c.nom, droits: c.droits, cree: c.cree }; }), droits: DROITS, lien: GESTION_URL };
}
/** Crée ou modifie un compte : { id?, nom, pin?, droits:{...} }. Le PIN n'est gardé que haché. */
function adminEnregistrerCompte(cle, c) {
  verifierCle_(cle);
  var l = comptes_(), nom = String((c && c.nom) || '').trim(), pin = String((c && c.pin) || '').trim();
  if (!nom) throw new Error('Le nom manque.');
  var droits = {}; DROITS.forEach(function (d) { droits[d[0]] = !!(c.droits && c.droits[d[0]]); });
  var existant = c.id ? l.filter(function (x) { return x.id === c.id; })[0] : null;
  if (!existant && !pin) throw new Error('Choisissez un code PIN (4 à 8 chiffres).');
  if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('Le code PIN doit faire 4 à 8 chiffres.');
  if (pin) l.forEach(function (x) { if (x.id !== (existant && existant.id) && x.hash === hashPin_(pin, x.id)) throw new Error('Ce code PIN est déjà pris par ' + x.nom + ' : choisissez-en un autre.'); });
  if (existant) {
    existant.nom = nom; existant.droits = droits; if (pin) existant.hash = hashPin_(pin, existant.id);
  } else {
    var id = nouvelId_('C');
    l.push({ id: id, nom: nom, droits: droits, hash: hashPin_(pin, id), cree: maintenant_() });
  }
  ecrireComptes_(l);
  return adminListerComptes(cle);
}
function adminSupprimerCompte(cle, id) {
  verifierCle_(cle);
  ecrireComptes_(comptes_().filter(function (x) { return x.id !== id; }));
  ecrireAppareils_(appareils_().filter(function (a) { return a.compte !== id; }));
  return adminListerComptes(cle);
}
/** Pointage à l'entrée : la personne est arrivée (ou pas). */
function adminPointer(cle, id, arrive) {
  verifierCle_(cle);
  var feuille = onglet_(RESA.ongletReservations, COL_RES);
  var n = ligneDe_(feuille, id);
  if (!n) throw new Error('Réservation introuvable.');
  feuille.getRange(n, CHAMPS_RES.indexOf('arrivee') + 1).setValue(arrive ? 'Oui' : '');
  return adminCharger(cle);
}

function json_(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Côté public ----------

function evenementsPublics_() {
  var aujourdhui = Utilities.formatDate(new Date(), 'Europe/Zurich', 'yyyy-MM-dd');
  var pris = placesPrises_();
  return lireEvenements_()
    .filter(function (ev) { return (ev.statut === 'Ouvert' || ev.statut === 'Fermé') && ev.date >= aujourdhui; })
    .map(function (ev) { return versPublic_(ev, pris[ev.id] || 0); })
    .sort(function (a, b) { return (a.date + a.debut) < (b.date + b.debut) ? -1 : 1; });
}

function versPublic_(ev, prises) {
  var places = Number(ev.places) || 0;
  return {
    id: ev.id, titre: ev.titre, spectacle: ev.spectacle, date: ev.date, debut: ev.debut, fin: ev.fin,
    compagnie: ev.compagnie, duree: ev.duree, age: ev.age,
    lieu: ev.lieu, adresse: ev.adresse, description: ev.description, long: ev.long, distribution: ev.distribution, video: ev.video, tarif: ev.tarif, image: ev.image,
    reservable: ev.statut === 'Ouvert' && (places === 0 || prises < places),
    complet: places > 0 && prises >= places,
    restantes: places > 0 ? Math.max(0, places - prises) : null,
    attente: ev.statut === 'Ouvert' && ev.attente === 'Oui',
  };
}

/** Vérifie et enregistre une réservation. Renvoie {ok, ...} ou {ok:false, erreur}. */
function reserver_(d) {
  if (d.site) return { ok: true }; // champ piège à robots rempli : on fait semblant
  var nom = String(d.nom || '').trim().slice(0, 120);
  var email = String(d.email || '').trim().slice(0, 200);
  var telephone = String(d.telephone || '').trim().slice(0, 40);
  var message = String(d.message || '').trim().slice(0, 1000);
  var places = Math.floor(Number(d.places));
  if (!nom) return { ok: false, erreur: 'Indiquez votre nom.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, erreur: 'L\'adresse e-mail ne semble pas correcte.' };
  if (!(places >= 1 && places <= RESA.maxParReservation)) {
    return { ok: false, erreur: 'Choisissez entre 1 et ' + RESA.maxParReservation + ' places.' };
  }

  var verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    var ev = lireEvenements_().filter(function (x) { return x.id === d.evenement; })[0];
    if (!ev || ev.statut !== 'Ouvert') return { ok: false, erreur: 'Cet événement n\'est pas ouvert à la réservation.' };
    var max = Number(ev.places) || 0;
    var prises = placesPrises_()[ev.id] || 0;
    var attente = false;
    if (max > 0 && prises + places > max) {
      var reste = Math.max(0, max - prises);
      if (d.attente && ev.attente === 'Oui') attente = true; // complet, mais liste d'attente ouverte
      else return { ok: false, erreur: reste ? 'Il ne reste que ' + reste + ' place(s).' : 'Désolé, c\'est complet.', restantes: reste, attente: ev.attente === 'Oui' };
    }
    var resa = {
      id: nouvelId_('R'), evenement: ev.id, titreEvenement: ev.titre, recue: maintenant_(),
      nom: nom, email: email, telephone: telephone, places: places, message: message, statut: attente ? 'Liste d\'attente' : 'Confirmée',
    };
    ajouterLigne_(onglet_(RESA.ongletReservations, COL_RES), CHAMPS_RES, resa);
    SpreadsheetApp.flush();
  } finally {
    verrou.releaseLock();
  }
  var mailEnvoye = true;
  try {
    if (attente) envoyerAttente_(ev, resa); else envoyerConfirmation_(ev, resa);
  } catch (err) { // quota d'e-mails dépassé… la réservation est quand même enregistrée
    mailEnvoye = false;
    console.error('E-mail non envoyé pour ' + resa.id + ' : ' + err);
  }
  if (attente) return { ok: true, id: resa.id, attente: true, mailEnvoye: mailEnvoye, restantes: 0 };
  return { ok: true, id: resa.id, mailEnvoye: mailEnvoye, restantes: max > 0 ? max - prises - places : null };
}

// ---------- E-mails ----------

function envoyerType_(type, ev, resa, r) {
  r = r || reglages_();
  var valeurs = valeursMail_(ev, resa), m = MAIL.composer(type, r, valeurs);
  MailApp.sendEmail({ to: resa.email, subject: m.sujet, body: m.texte, htmlBody: m.html, name: r.nomFestival, replyTo: r.copieA || undefined });
  return valeurs;
}
function envoyerConfirmation_(ev, resa) {
  var r = reglages_();
  var valeurs = envoyerType_('confirmation', ev, resa, r);
  if (r.copieA) {
    MailApp.sendEmail({
      to: r.copieA,
      subject: 'Nouvelle réservation : ' + ev.titre + ' (' + resa.places + ' pl.)',
      body: resa.nom + ' · ' + resa.email + (resa.telephone ? ' · ' + resa.telephone : '') + '\n' +
        resa.places + ' place(s) pour « ' + ev.titre + ' », ' + valeurs.date + ' à ' + valeurs.heure + '\n' +
        (resa.message ? '\nMessage : ' + resa.message + '\n' : ''),
      name: 'Réservations · ' + r.nomFestival,
      replyTo: resa.email,
    });
  }
}

function envoyerAnnulation_(ev, resa) { envoyerType_('annulation', ev, resa); }

function envoyerAttente_(ev, resa) {
  var r = reglages_();
  envoyerType_('attente', ev, resa, r);
  if (r.copieA) MailApp.sendEmail({ to: r.copieA, subject: '[Liste d\'attente] ' + ev.titre + ' : ' + resa.nom + ' (' + resa.places + ')', body: resa.nom + ' · ' + resa.email + ' · ' + resa.places + ' place(s)', name: r.nomFestival });
}

/** Une place s'est libérée : la personne en liste d'attente passe en « Confirmée » (e-mail de confirmation si demandé). */
function adminConfirmerReservation(cle, id, prevenir) {
  verifierCle_(cle);
  var feuille = onglet_(RESA.ongletReservations, COL_RES);
  var n = ligneDe_(feuille, id);
  if (!n) throw new Error('Réservation introuvable.');
  var resa = objetDeLigne_(feuille.getRange(n, 1, 1, COL_RES.length).getValues()[0], CHAMPS_RES);
  resa.places = Number(resa.places) || 1;
  feuille.getRange(n, CHAMPS_RES.indexOf('statut') + 1).setValue('Confirmée');
  var ev = lireEvenements_().filter(function (x) { return x.id === resa.evenement; })[0];
  if (prevenir && ev && resa.email) envoyerConfirmation_(ev, resa);
  return adminCharger(cle);
}

function valeursMail_(ev, resa) {
  var r = reglages_(), nom = String(resa.nom || '').trim();
  return {
    nom: nom, prenom: nom.split(/\s+/)[0] || '', places: resa.places, titre: ev.titre, date: dateLongue_(ev.date),
    heure: ev.debut || '', lieu: [ev.lieu, ev.adresse].filter(String).join(', '), adresse: ev.adresse || '', tarif: ev.tarif || '',
    numero: resa.id || '', email: resa.email || '', telephone: resa.telephone || '', message: resa.message || '',
    festival: r.nomFestival, site: String(r.siteUrl || '').replace(/\/apercu\/?$/, '').replace(/\/$/, ''),
  };
}

function remplir_(modele, valeurs) { return MAIL.remplir(modele, valeurs); }

function texteVersHtml_(texte) {
  var sur = texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#111">' +
    sur.split(/\n\n+/).map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('') + '</div>';
}

function dateLongue_(iso) {
  if (!iso) return '';
  var jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var p = iso.split('-').map(Number);
  var j = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return jours[j] + ' ' + texteDate_(iso);
}

// ---------- Application de gestion (appelée par Admin.html) ----------

function adminCharger(cle) {
  verifierCle_(cle);
  var pris = placesPrises_();
  return {
    evenements: lireEvenements_().map(function (ev) {
      ev.prises = pris[ev.id] || 0;
      return ev;
    }),
    reservations: lireReservations_(),
    reglages: reglages_(),
    spectacles: titresSpectacles_(),
    statuts: STATUTS_EV,
  };
}

function adminEnregistrerEvenement(cle, ev) {
  verifierCle_(cle);
  if (!String(ev.titre || '').trim()) throw new Error('Le titre manque.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) throw new Error('La date manque.');
  if (STATUTS_EV.indexOf(ev.statut) < 0) ev.statut = 'Brouillon';
  ev.places = Math.max(0, Math.floor(Number(ev.places) || 0));
  var feuille = onglet_(RESA.ongletEvenements, COL_EV);
  var verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    if (ev.id) {
      var n = ligneDe_(feuille, ev.id);
      if (!n) throw new Error('Événement introuvable.');
      var ancien = objetDeLigne_(feuille.getRange(n, 1, 1, COL_EV.length).getValues()[0], CHAMPS_EV);
      ev.cree = ancien.cree;
      ecrireLigne_(feuille, n, CHAMPS_EV, ev);
    } else {
      ev.id = nouvelId_('E');
      ev.cree = maintenant_();
      ajouterLigne_(feuille, CHAMPS_EV, ev);
    }
  } finally {
    verrou.releaseLock();
  }
  return adminCharger(cle);
}

function adminSupprimerEvenement(cle, id) {
  verifierCle_(cle);
  var actives = lireReservations_().filter(function (r) { return r.evenement === id && r.statut !== 'Annulée'; });
  if (actives.length) throw new Error('Il y a ' + actives.length + ' réservation(s) : passez plutôt l\'événement en « Annulé ».');
  var feuille = onglet_(RESA.ongletEvenements, COL_EV);
  var n = ligneDe_(feuille, id);
  if (n) feuille.deleteRow(n);
  return adminCharger(cle);
}

/** Réservation ajoutée à la main (par téléphone…). Pas de limite de places, e-mail seulement si demandé. */
function adminAjouterReservation(cle, d) {
  verifierCle_(cle);
  var ev = lireEvenements_().filter(function (x) { return x.id === d.evenement; })[0];
  if (!ev) throw new Error('Événement introuvable.');
  if (!String(d.nom || '').trim()) throw new Error('Le nom manque.');
  var resa = {
    id: nouvelId_('R'), evenement: ev.id, titreEvenement: ev.titre, recue: maintenant_(),
    nom: String(d.nom).trim(), email: String(d.email || '').trim(), telephone: String(d.telephone || '').trim(),
    places: Math.max(1, Math.floor(Number(d.places) || 1)), message: String(d.message || '').trim(), statut: 'Confirmée',
  };
  ajouterLigne_(onglet_(RESA.ongletReservations, COL_RES), CHAMPS_RES, resa);
  if (d.envoyerMail && resa.email) envoyerConfirmation_(ev, resa);
  return adminCharger(cle);
}

function adminAnnulerReservation(cle, id, prevenir) {
  verifierCle_(cle);
  var feuille = onglet_(RESA.ongletReservations, COL_RES);
  var n = ligneDe_(feuille, id);
  if (!n) throw new Error('Réservation introuvable.');
  var resa = objetDeLigne_(feuille.getRange(n, 1, 1, COL_RES.length).getValues()[0], CHAMPS_RES);
  feuille.getRange(n, CHAMPS_RES.indexOf('statut') + 1).setValue('Annulée');
  var ev = lireEvenements_().filter(function (x) { return x.id === resa.evenement; })[0];
  if (prevenir && ev && resa.email) envoyerAnnulation_(ev, resa);
  return adminCharger(cle);
}

/**
 * Photo recadrée dans l'appli (JPEG en base64) : enregistrée dans un dossier du Drive, rendue visible
 * par lien, et renvoyée sous forme d'adresse d'image utilisable par le site.
 */
function adminEnregistrerImage(cle, d) {
  verifierCle_(cle);
  var base64 = String(d.base64 || '').replace(/^data:[^,]*,/, '');
  if (!base64 || base64.length > 8e6) throw new Error('Photo manquante ou trop lourde.');
  var nom = String(d.nom || 'photo').replace(/[^\w\u00C0-\u017F .-]+/g, ' ').trim().slice(0, 80) || 'photo';
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', nom + '.jpg');
  var fichier = dossierPhotos_().createFile(blob);
  fichier.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  if (d.spectacle || d.credit || d.legende) adminEnregistrerVisuel(cle, { cle: fichier.getId(), spectacle: d.spectacle, credit: d.credit, legende: d.legende });
  return { url: 'https://drive.google.com/thumbnail?id=' + fichier.getId() + '&sz=w1600', id: fichier.getId(), nom: fichier.getName() };
}

// Galerie de l'appli : toutes les photos du dossier Drive, les plus récentes d'abord, avec leurs infos (spectacle, légende, crédit).
function adminListerPhotos(cle) {
  verifierCle_(cle);
  var it = dossierPhotos_().getFiles(), l = [], infos = visuels_();
  while (it.hasNext()) {
    var f = it.next();
    if (String(f.getMimeType()).indexOf('image/') !== 0) continue;
    var id = f.getId(), v = infos[id] || {};
    l.push({ id: id, nom: f.getName().replace(/\.[a-z]+$/i, ''), url: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600', date: f.getDateCreated().getTime(),
      spectacle: v.spectacle || '', legende: v.legende || '', credit: v.credit || '' });
  }
  l.sort(function (a, b) { return b.date - a.date; });
  return { photos: l, infos: infos };
}
// Infos d'un visuel (fichier Drive par id, ou fichier du site par nom de fichier) : spectacle, légende, crédit.
function visuels_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('RESA_VISUELS') || '{}') || {}; } catch (e) { return {}; }
}
function adminEnregistrerVisuel(cle, d) {
  verifierCle_(cle);
  var infos = visuels_(), k = String(d.cle || '').slice(0, 120);
  if (!k) throw new Error('Visuel inconnu.');
  infos[k] = { spectacle: String(d.spectacle || '').slice(0, 120), legende: String(d.legende || '').slice(0, 200), credit: String(d.credit || '').slice(0, 120) };
  PropertiesService.getScriptProperties().setProperty('RESA_VISUELS', JSON.stringify(infos));
  return adminListerPhotos(cle);
}

// Renvoie une photo du Drive en base64 pour la recadrer dans l'appli (le navigateur ne peut pas la lire directement).
function adminLireImage(cle, id) {
  verifierCle_(cle);
  var f = DriveApp.getFileById(String(id)), b = f.getBlob();
  if (b.getBytes().length > 12e6) throw new Error('Photo trop lourde pour être recadrée ici.');
  return { base64: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()), nom: f.getName() };
}

function adminSupprimerPhoto(cle, id) {
  verifierCle_(cle);
  var f = DriveApp.getFileById(String(id));
  if (f.getParents().hasNext() && f.getParents().next().getId() !== dossierPhotos_().getId()) throw new Error('Cette photo n\'est pas dans le dossier du festival.');
  f.setTrashed(true);
  return true;
}

function dossierPhotos_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(RESA.cleDossierPhotos);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var existants = DriveApp.getFoldersByName(RESA.dossierPhotos);
  var dossier = existants.hasNext() ? existants.next() : DriveApp.createFolder(RESA.dossierPhotos);
  props.setProperty(RESA.cleDossierPhotos, dossier.getId());
  return dossier;
}

function adminEnregistrerReglages(cle, r) {
  verifierCle_(cle);
  var propre = {};
  Object.keys(REGLAGES_DEFAUT).forEach(function (k) { propre[k] = String(r[k] == null ? REGLAGES_DEFAUT[k] : r[k]); });
  PropertiesService.getScriptProperties().setProperty(RESA.cleReglages, JSON.stringify(propre));
  return adminCharger(cle);
}

function adminEssaiMail(cle, type, brouillon) {
  verifierCle_(cle);
  var r = reglages_();
  if (brouillon && typeof brouillon === 'object') Object.keys(REGLAGES_DEFAUT).forEach(function (k) { if (k in brouillon) r[k] = String(brouillon[k]); }); // réglages pas encore enregistrés
  if (!r.copieA) throw new Error('Indiquez d\'abord l\'adresse qui reçoit les copies, puis enregistrez.');
  var ev = lireEvenements_().filter(function (e) { return e.statut === 'Ouvert' || e.statut === 'Fermé'; })[0] ||
    { titre: 'Événement d\'essai', date: Utilities.formatDate(new Date(), 'Europe/Zurich', 'yyyy-MM-dd'), debut: '20:00', lieu: 'Théâtricul', adresse: 'Rue de Genève 64, Chêne-Bourg', tarif: '' };
  var resa = { id: 'R-ESSAI', nom: 'Camille Dupont', email: r.copieA, places: 2, telephone: '' };
  var m = MAIL.composer(type || 'confirmation', r, valeursMail_(ev, resa));
  MailApp.sendEmail({ to: r.copieA, subject: '[Essai] ' + m.sujet, body: m.texte, htmlBody: m.html, name: r.nomFestival });
  return 'E-mail d\'essai (' + (MAIL.TYPES[type || 'confirmation'] || {}).nom + ') envoyé à ' + r.copieA;
}

// ---------- Clé de l'application ----------

/** Menu de la feuille : crée la clé si besoin et affiche le lien personnel de l'application. */
function lienAppli() {
  var ui = SpreadsheetApp.getUi();
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    ui.alert('Application pas encore déployée',
      'Dans Extensions > Apps Script : Déployer > Nouveau déploiement > Application web ' +
      '(Exécuter en tant que : moi ; Accès : tout le monde). Puis revenez ici.', ui.ButtonSet.OK);
    return;
  }
  var props = PropertiesService.getScriptProperties();
  var cle = props.getProperty(RESA.cleAdmin);
  if (!cle) {
    cle = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty(RESA.cleAdmin, cle);
  }
  onglet_(RESA.ongletEvenements, COL_EV);
  onglet_(RESA.ongletReservations, COL_RES);
  var lien = GESTION_URL + '?cle=' + cle + '&exec=' + encodeURIComponent(url);
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px">' +
    '<p><b>Adresse pour le site</b> (à donner à Claude, elle n\'est pas secrète) :</p>' +
    '<input style="width:100%" readonly value="' + url + '" onclick="this.select()">' +
    '<p><b>Votre lien personnel vers l\'application</b> (ne le partagez pas : il ouvre la gestion sans mot de passe) :</p>' +
    '<input style="width:100%" readonly value="' + lien + '" onclick="this.select()">' +
    '<p><a href="' + lien + '" target="_blank">Ouvrir l\'application</a></p></div>')
    .setWidth(520).setHeight(260);
  ui.showModalDialog(html, 'Réservations');
}

/** Menu de la feuille : remplace la clé (l'ancien lien personnel ne marche plus). */
function changerCleAppli() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Changer la clé ?', 'L\'ancien lien personnel ne marchera plus.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().deleteProperty(RESA.cleAdmin);
  lienAppli();
}

function cleValide_(cle) {
  var vraie = PropertiesService.getScriptProperties().getProperty(RESA.cleAdmin);
  return !!vraie && typeof cle === 'string' && cle === vraie;
}

function verifierCle_(cle) {
  if (!cleValide_(cle)) throw new Error('Lien de l\'application invalide ou remplacé.');
}

// ---------- Lecture / écriture des onglets ----------

function lireEvenements_() {
  var f = onglet_(RESA.ongletEvenements, COL_EV);
  if (f.getLastRow() < 2) return [];
  return f.getRange(2, 1, f.getLastRow() - 1, COL_EV.length).getDisplayValues()
    .map(function (l) { return objetDeLigne_(l, CHAMPS_EV); })
    .filter(function (ev) { return ev.id; });
}

function lireReservations_() {
  var f = onglet_(RESA.ongletReservations, COL_RES);
  if (f.getLastRow() < 2) return [];
  return f.getRange(2, 1, f.getLastRow() - 1, COL_RES.length).getDisplayValues()
    .map(function (l) {
      var r = objetDeLigne_(l, CHAMPS_RES);
      r.places = Number(r.places) || 0;
      return r;
    })
    .filter(function (r) { return r.id; });
}

/** Places réservées (non annulées) par événement. */
function placesPrises_() {
  var pris = {};
  lireReservations_().forEach(function (r) {
    if (r.statut !== 'Annulée' && r.statut !== 'Liste d\'attente') pris[r.evenement] = (pris[r.evenement] || 0) + r.places;
  });
  return pris;
}

/** Spectacles déjà saisis (pour les proposer dans l'appli ; on peut aussi écrire un nouveau titre). */
function titresSpectacles_() {
  var vus = {};
  lireEvenements_().forEach(function (ev) { if (ev.spectacle) vus[ev.spectacle] = true; });
  return Object.keys(vus).sort();
}

function onglet_(nom, colonnes) {
  var classeur = SpreadsheetApp.getActive();
  var f = classeur.getSheetByName(nom);
  if (!f) {
    f = classeur.insertSheet(nom);
    f.getRange(1, 1, 1, colonnes.length).setValues([colonnes]).setFontWeight('bold');
    f.setFrozenRows(1);
    f.getRange('A:Z').setNumberFormat('@'); // tout en texte : pas de date ou d'heure transformée par la feuille
  } else if (colonnes && f.getLastColumn() < colonnes.length) { // nouvelle colonne (ex. « Arrivée ») : on complète l'en-tête
    f.getRange(1, 1, 1, colonnes.length).setValues([colonnes]).setFontWeight('bold');
  }
  return f;
}

function objetDeLigne_(ligne, champs) {
  var o = {};
  champs.forEach(function (c, i) { o[c] = ligne[i] === undefined ? '' : String(ligne[i]); });
  return o;
}

function ligneDe_(feuille, id) {
  if (feuille.getLastRow() < 2) return 0;
  var ids = feuille.getRange(2, 1, feuille.getLastRow() - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}

function ajouterLigne_(feuille, champs, objet) {
  feuille.appendRow(versLigne_(champs, objet));
}

function ecrireLigne_(feuille, n, champs, objet) {
  feuille.getRange(n, 1, 1, champs.length).setValues([versLigne_(champs, objet)]);
}

/** Valeurs à écrire, en texte. Un texte qui commence par = + - @ (« +41… ») est protégé par une apostrophe
 *  pour que la feuille ne le prenne jamais pour une formule (le formulaire est public). */
function versLigne_(champs, objet) {
  return champs.map(function (c) {
    var v = objet[c] == null ? '' : String(objet[c]);
    return /^[=+\-@]/.test(v) ? "'" + v : v;
  });
}

function nouvelId_(prefixe) {
  return prefixe + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function maintenant_() {
  return Utilities.formatDate(new Date(), 'Europe/Zurich', 'yyyy-MM-dd HH:mm');
}

function reglages_() {
  var brut = PropertiesService.getScriptProperties().getProperty(RESA.cleReglages);
  var r = {};
  var lu = brut ? JSON.parse(brut) : {};
  Object.keys(REGLAGES_DEFAUT).forEach(function (k) { r[k] = k in lu ? lu[k] : REGLAGES_DEFAUT[k]; });
  return r;
}

// E-mails de réservation : composition partagée entre le script (envoi) et l'appli (aperçu en direct).
// Aucune dépendance Apps Script ici : ce fichier est aussi inséré dans Admin.html par assembler.py.
var MAIL = (function () {
  var VARIABLES = [
    ['nom', 'Prénom et nom', 'Camille Dupont'], ['prenom', 'Prénom', 'Camille'], ['places', 'Nombre de places', '2'],
    ['titre', 'Titre du spectacle', 'Hurler sous l\'eau'], ['date', 'Date (en toutes lettres)', 'vendredi 4 décembre 2026'], ['heure', 'Heure', '19:45'],
    ['lieu', 'Lieu et adresse', 'Théâtricul, Rue de Genève 64, Chêne-Bourg'], ['adresse', 'Adresse seule', 'Rue de Genève 64, Chêne-Bourg'],
    ['tarif', 'Tarif', 'Prix libre, 10 francs conseillés'], ['numero', 'Numéro de réservation', 'R-7F3K2'], ['email', 'E-mail de la personne', 'camille@example.ch'],
    ['telephone', 'Téléphone de la personne', '079 000 00 00'], ['message', 'Message laissé', ''], ['festival', 'Nom du festival', 'Le Petit Festival au Théâtricul'], ['site', 'Adresse du site', 'https://petit-festival.ch']
  ];
  var TYPES = {
    confirmation: { nom: 'Confirmation de réservation', sujet: 'sujet', message: 'message', billet: true },
    annulation: { nom: 'Annulation', sujet: 'sujetAnnulation', message: 'messageAnnulation', billet: false },
    attente: { nom: 'Liste d\'attente', sujet: 'sujetAttente', message: 'messageAttente', billet: false }
  };
  function echapper(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function remplir(modele, valeurs) {
    return String(modele == null ? '' : modele).replace(/\{(\w+)\}/g, function (tout, cle) { return cle in valeurs ? String(valeurs[cle] == null ? '' : valeurs[cle]) : tout; })
      .replace(/[ \t]+\n/g, '\n');
  }
  // Texte → paragraphes HTML ; **gras**, *italique*, liens cliquables.
  function enLigne(t) {
    return echapper(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<i>$2</i>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#c81f74">$1</a>');
  }
  function texteVersHtml(texte) {
    return String(texte || '').trim().split(/\n\s*\n/).map(function (p) { return '<p style="margin:0 0 14px">' + enLigne(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }
  var STYLE = 'font-family:Georgia,\'Times New Roman\',serif;font-size:16px;line-height:1.55;color:#1b1733;max-width:600px;margin:0 auto;';
  // Billet : récapitulatif encadré, à présenter à l'entrée.
  function billetHtml(v) {
    var ligne = function (l, t) { return t ? '<tr><td style="padding:4px 12px 4px 0;color:#5b5570;font:13px/1.4 Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;vertical-align:top">' + l + '</td><td style="padding:4px 0;font-size:16px;vertical-align:top">' + echapper(t) + '</td></tr>' : ''; };
    return '<div style="margin:20px 0;border:2px solid #1b1733;background:#f7f0e1;box-shadow:5px 5px 0 #6b2cff">' +
      '<div style="background:#1b1733;color:#f7f3ff;padding:10px 16px;font:700 13px/1.4 Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em">' + echapper(v.festival || 'Billet') + ' <span style="float:right;color:#ff1fb4">Billet</span></div>' +
      '<div style="padding:16px 18px"><div style="font:700 24px/1.15 Georgia,serif;margin:0 0 10px">' + echapper(v.titre || '') + '</div><table style="border-collapse:collapse">' +
      ligne('Date', v.date) + ligne('Heure', v.heure) + ligne('Lieu', v.lieu) + ligne('Au nom de', v.nom) + ligne('Places', v.places) + (v.tarif ? ligne('Tarif', v.tarif) : '') + ligne('N°', v.numero) +
      '</table><p style="margin:12px 0 0;font:13px/1.4 Arial,sans-serif;color:#5b5570">Présentez ce billet (sur votre téléphone, c\'est parfait) à l\'entrée. Paiement sur place.</p></div></div>';
  }
  // Mail complet d'un type donné, d'après les réglages r et les valeurs v.
  function composer(type, r, v) {
    var t = TYPES[type] || TYPES.confirmation;
    var sujet = remplir(r[t.sujet] || '', v), corps = remplir(r[t.message] || '', v), pied = remplir(r.piedDePage || '', v);
    var avecBillet = t.billet && String(r.billet || '') === 'Oui';
    var html = '<div style="' + STYLE + '">' + texteVersHtml(corps) + (avecBillet ? billetHtml(v) : '') +
      (pied.trim() ? '<div style="margin-top:28px;padding-top:14px;border-top:1px solid #dccfb4;font-size:13px;line-height:1.5;color:#5b5570">' + texteVersHtml(pied).replace(/margin:0 0 14px/g, 'margin:0 0 6px') + '</div>' : '') + '</div>';
    var texte = corps + (avecBillet ? '\n\n— Billet —\n' + [v.titre, v.date + (v.heure ? ' à ' + v.heure : ''), v.lieu, 'Au nom de ' + v.nom + ' · ' + v.places + ' place(s)', 'N° ' + v.numero].filter(Boolean).join('\n') : '') + (pied.trim() ? '\n\n--\n' + pied : '');
    return { sujet: sujet, texte: texte, html: html };
  }
  function exemple() { var v = {}; VARIABLES.forEach(function (x) { v[x[0]] = x[2]; }); return v; }
  return { VARIABLES: VARIABLES, TYPES: TYPES, remplir: remplir, texteVersHtml: texteVersHtml, billetHtml: billetHtml, composer: composer, exemple: exemple, echapper: echapper };
})();

// ---------- Mise à jour automatique du script depuis GitHub ----------
// Le code de référence est a-coller.gs dans le dépôt GitHub. Toutes les heures (et sur demande depuis l'appli),
// le script compare sa version à celle du dépôt ; si elle diffère, il remplace son propre code, crée une version
// et met à jour le déploiement de l'application web. Plus rien à coller à la main.
// Une seule fois : activer l'API Apps Script sur https://script.google.com/home/usersettings, coller le manifeste
// appsscript.json (autorisations), puis menu Festival → « Activer la mise à jour automatique ».

var VERSION_CODE = '4050dafb8eab';
var MAJ = {
  source: 'https://raw.githubusercontent.com/sevanegu-pixel/festival-reservations/main/apps-script/a-coller.gs',
  manifeste: 'https://raw.githubusercontent.com/sevanegu-pixel/festival-reservations/main/apps-script/appsscript.json',
  api: 'https://script.googleapis.com/v1/projects/',
  fonctionTrigger: 'verifierMiseAJour'
};

/** Menu de la feuille : autorise le script (API Apps Script) et pose le déclencheur horaire. */
function activerMiseAJour() {
  var ui = SpreadsheetApp.getUi();
  try {
    installerTriggerMiseAJour_();
    var r = verifierMiseAJour();
    ui.alert('Mise à jour automatique activée', r + '\n\nLe script vérifiera GitHub toutes les heures. Plus besoin de coller du code.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Pas encore possible', String(e.message || e) + '\n\nVérifiez : 1) l\'API Apps Script est activée sur script.google.com/home/usersettings ; 2) le fichier appsscript.json du projet contient les autorisations (voir le dépôt GitHub).', ui.ButtonSet.OK);
  }
}

function installerTriggerMiseAJour_() {
  var deja = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === MAJ.fonctionTrigger; });
  if (!deja) ScriptApp.newTrigger(MAJ.fonctionTrigger).timeBased().everyHours(1).create();
}

/** Depuis l'appli (droit « comptes ») : met à jour tout de suite. */
function adminMettreAJour(cle) {
  verifierCle_(cle);
  installerTriggerMiseAJour_();
  return verifierMiseAJour();
}

/** Compare la version du dépôt à la version en service ; met à jour si besoin. Renvoie un texte. */
function verifierMiseAJour() {
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(5000)) return 'Une mise à jour est déjà en cours.';
  try {
    var code = UrlFetchApp.fetch(MAJ.source + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (code.getResponseCode() !== 200) throw new Error('GitHub ne répond pas (' + code.getResponseCode() + ').');
    var source = code.getContentText('UTF-8');
    var m = /var VERSION_CODE = '([0-9a-f]+)'/.exec(source);
    if (!m) throw new Error('Le fichier du dépôt n\'a pas de numéro de version.');
    var nouvelle = m[1];
    if (nouvelle === VERSION_CODE) return 'Le script est à jour (version ' + VERSION_CODE + ').';

    var manifeste = UrlFetchApp.fetch(MAJ.manifeste + '?t=' + Date.now(), { muteHttpExceptions: true });
    var id = ScriptApp.getScriptId(), entete = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
    var actuel = appelApi_('GET', MAJ.api + id + '/content', null, entete);
    var fichiers = [];
    actuel.files.forEach(function (f) {
      if (f.type === 'JSON' && f.name === 'appsscript') fichiers.push({ name: 'appsscript', type: 'JSON', source: manifeste.getResponseCode() === 200 ? manifeste.getContentText('UTF-8') : f.source });
    });
    if (!fichiers.length) throw new Error('Manifeste introuvable.');
    fichiers.push({ name: 'Code', type: 'SERVER_JS', source: source });
    appelApi_('PUT', MAJ.api + id + '/content', { files: fichiers }, entete);

    var version = appelApi_('POST', MAJ.api + id + '/versions', { description: 'Mise à jour automatique ' + nouvelle }, entete);
    var url = ScriptApp.getService().getUrl(), d = /\/s\/([\w-]+)\/exec/.exec(url || '');
    if (d) {
      appelApi_('PUT', MAJ.api + id + '/deployments/' + d[1],
        { deploymentConfig: { scriptId: id, versionNumber: version.versionNumber, manifestFileName: 'appsscript', description: 'Mise à jour automatique ' + nouvelle } }, entete);
    }
    PropertiesService.getScriptProperties().setProperty('RESA_MAJ', nouvelle + ' le ' + maintenant_());
    return 'Script mis à jour : version ' + VERSION_CODE + ' → ' + nouvelle + (d ? ' (déploiement renouvelé).' : ' (pas encore déployé en application web).');
  } finally {
    verrou.releaseLock();
  }
}

function appelApi_(methode, url, corps, entete) {
  var r = UrlFetchApp.fetch(url, { method: methode, headers: entete, contentType: 'application/json', payload: corps ? JSON.stringify(corps) : undefined, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) {
    var t = r.getContentText();
    if (/has not been used|is disabled|PERMISSION_DENIED/.test(t)) throw new Error('L\'API Apps Script n\'est pas activée pour ce compte Google : ouvrez script.google.com/home/usersettings et activez « API Google Apps Script ».');
    throw new Error('API Apps Script : ' + r.getResponseCode() + ' ' + t.slice(0, 300));
  }
  return JSON.parse(r.getContentText() || '{}');
}

var ADMIN_HTML = "<!doctype html>\n<html lang=\"fr\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link href=\"https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Barlow:wght@400;500;600&display=swap\" rel=\"stylesheet\">\n<style>\n:root{--fond:#0b0a10;--carte:#17141f;--ligne:#2c2640;--texte:#f4f1ff;--doux:#b9aee6;--lav:#ff5a5f;--lav2:#ff8f92;--rouge:#ff7a8a;--vert:#7ee0b0}\n*{box-sizing:border-box}\nhtml,body{margin:0;background:var(--fond);color:var(--texte);font:16px/1.45 Barlow,system-ui,sans-serif}\nheader{position:sticky;top:0;z-index:5;background:var(--fond);border-bottom:1px solid var(--ligne);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}\nh1{font:700 22px/1.1 \"Bricolage Grotesque\",sans-serif;margin:0;flex:1;min-width:180px}\nh1 small{display:block;font:500 13px Barlow,sans-serif;color:var(--doux);letter-spacing:.04em;text-transform:uppercase}\nh2{font:700 20px \"Bricolage Grotesque\",sans-serif;margin:24px 0 10px}\nnav button,.btn{font:600 15px Barlow,sans-serif;border:1px solid var(--lav);background:transparent;color:var(--lav2);border-radius:999px;padding:8px 14px;cursor:pointer}\nnav button.on,.btn.plein{background:var(--lav);color:#0b0a10;border-color:var(--lav)}\n.btn.petit{padding:4px 10px;font-size:13px}\na.btn{text-decoration:none;display:inline-block}\n.btn.danger{border-color:var(--rouge);color:var(--rouge)}\n.btn:disabled{opacity:.5;cursor:default}\nmain{max-width:980px;margin:0 auto;padding:8px 16px 80px}\n.liste{display:grid;gap:10px}\n.ev{display:grid;grid-template-columns:64px 1fr auto;gap:14px;align-items:center;background:var(--carte);border:1px solid var(--ligne);border-radius:10px;padding:12px;cursor:pointer;text-align:left;color:inherit;font:inherit;width:100%}\n.ev:hover{border-color:var(--lav)}\n.jour{text-align:center;border-right:1px solid var(--ligne);padding-right:10px}\n.jour b{display:block;font:700 26px/1 \"Bricolage Grotesque\",sans-serif}\n.jour span{font-size:12px;text-transform:uppercase;color:var(--doux)}\n.ev h3{margin:0 0 2px;font-size:17px}\n.ev p{margin:0;color:var(--doux);font-size:14px}\n.jauge{min-width:92px;text-align:right;font-size:14px}\n.jauge .barre{height:5px;background:var(--ligne);border-radius:3px;margin-top:5px;overflow:hidden}\n.jauge .barre i{display:block;height:100%;background:var(--lav)}\n.badge{display:inline-block;font-size:12px;border-radius:999px;padding:1px 8px;margin-left:6px;border:1px solid var(--ligne);color:var(--doux);vertical-align:2px}\n.badge.Ouvert{border-color:var(--vert);color:var(--vert)}\n.badge.Annulé{border-color:var(--rouge);color:var(--rouge)}\n.statutRapide{width:auto;font-size:13px;padding:4px 6px;margin-top:6px;border-radius:999px}\n.galerie{margin:14px 0 0}\n.galerie h4{margin:12px 0 4px;font:600 14px Barlow,sans-serif;color:var(--doux)}\n.galerie details{margin-top:10px}\n.galerie summary{cursor:pointer;color:var(--lav2);font-weight:600;font-size:14px}\n.photo .etiquette{position:absolute;right:6px;top:4px;font:600 11px Barlow,sans-serif;background:rgba(11,10,16,.8);color:var(--vert);border-radius:999px;padding:1px 7px}\n.photo .etiquette.drive{color:var(--doux)}\n.photo .outils{flex-wrap:wrap;gap:0 2px}\n.photo.portrait img{object-fit:contain;background:#000}\n.groupe{margin-top:18px}\n.groupe h3{margin:0 0 6px;font:700 17px \"Bricolage Grotesque\",sans-serif}\n.pin{max-width:360px;margin:40px auto;text-align:center}\n.pin img{width:96px;height:96px;border-radius:22px}\n.pin input{font:700 34px/1 \"Bricolage Grotesque\",sans-serif;text-align:center;letter-spacing:.3em;padding:14px 10px;margin:16px 0 12px}\n.pin .btn{width:100%;padding:12px}\n.compte{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--ligne)}\n.compte:last-child{border:0}\n.compte .qui{flex:1;min-width:200px}\n.compte .qui b{font-size:16px}\n.compte .qui p{margin:3px 0 0;color:var(--doux);font-size:13px}\n.compte .actions{margin:0}\n.coches label{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:var(--texte);margin:6px 0;cursor:pointer}\n.coches input{width:auto;margin-top:3px}\n.bandeau{background:var(--carte);border:1px solid var(--lav);border-radius:10px;padding:10px 14px;margin:10px 0;font-size:14px}\n.bandeau a{color:var(--lav2)}\nnav button.discret{border-color:var(--ligne);color:var(--doux)}\n.arrivee{width:auto;transform:scale(1.3);margin:4px}\ntr.arrivee td{color:var(--vert)}\n.vide{color:var(--doux);font-style:italic}\nform .grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}\nform .grille>div{display:flex;flex-direction:column;justify-content:flex-end}form .grille>div label{margin-top:auto}form .grille>div .aide{margin-top:4px}\nlabel{display:block;font-size:13px;color:var(--doux);margin-bottom:4px}\ninput,select,textarea{width:100%;font:inherit;color:var(--texte);background:#100e17;border:1px solid var(--ligne);border-radius:8px;padding:9px 10px}\ninput:focus,select:focus,textarea:focus{outline:2px solid var(--lav);border-color:var(--lav)}\ntextarea{min-height:110px;resize:vertical}\n.large{grid-column:1/-1}\n.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}\n.panneau{background:var(--carte);border:1px solid var(--ligne);border-radius:12px;padding:16px;margin-top:12px}\ntable{width:100%;border-collapse:collapse;font-size:14px}\nth,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--ligne);vertical-align:top}\nth{color:var(--doux);font-weight:500}\ntr.annulee td{opacity:.45;text-decoration:line-through}\ntr.annulee td:last-child{text-decoration:none}\n.tableau{overflow-x:auto}\n.aide{font-size:13px;color:var(--doux);margin:4px 0 0}\n#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--lav);color:#0b0a10;font-weight:600;padding:10px 16px;border-radius:999px;display:none;z-index:20;max-width:92vw}\n#toast.erreur{background:var(--rouge)}\n#charge{position:fixed;top:0;left:0;height:3px;width:100%;background:var(--lav);display:none;z-index:30;animation:c 1s infinite linear}\n@keyframes c{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}\n/* Photos et recadrage */\n.photos{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0 8px}\n#photos .photo{width:180px}\n.photo{position:relative;width:150px;aspect-ratio:3/2;background:#100e17;border:1px solid var(--ligne);border-radius:8px;overflow:hidden}\n.photo img{width:100%;height:100%;object-fit:cover;display:block}\n.photo .outils{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;background:rgba(11,10,16,.8);padding:3px 4px}\n.photo .outils button,.photo .outils a{background:none;border:0;color:var(--texte);font:600 12px Barlow,sans-serif;cursor:pointer;padding:3px 5px;text-decoration:none}\n.photo .outils button:hover,.photo .outils a:hover{color:var(--lav2)}\n.photo .num{position:absolute;left:6px;top:4px;font:700 12px Barlow,sans-serif;background:var(--lav);color:#0b0a10;border-radius:999px;padding:1px 7px}\n.photos .ajout{width:150px;aspect-ratio:3/2;border:1px dashed var(--lav);border-radius:8px;background:none;color:var(--lav2);font:600 14px Barlow,sans-serif;cursor:pointer}\n#recadrage{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:40;display:none;align-items:center;justify-content:center;padding:12px}\n#recadrage.ouvert{display:flex}\n#recadrage .boite{background:var(--carte);border:1px solid var(--ligne);border-radius:14px;padding:16px;width:min(96vw,640px)}\n#recadrage canvas{display:block;width:100%;aspect-ratio:3/2;background:#000;border-radius:8px;cursor:grab;touch-action:none}\n#recadrage .reglage{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:14px;color:var(--doux)}\n#recadrage input[type=range]{flex:1;padding:0}\n/* Aperçu du site */\n.apercu{margin-top:12px}\n.apercu .onglets{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}\n@media (max-width:560px){.ev{grid-template-columns:52px 48px 1fr}.mini,.vide-mini{width:48px;height:48px}.jauge{grid-column:2;text-align:left}.jauge .barre{width:120px}}\n.tuiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tuile{background:var(--carte);border:1px solid var(--ligne);border-radius:12px;padding:14px}.tuile b{display:block;font:700 30px/1 \"Bricolage Grotesque\"}.tuile span{font-size:13px;color:var(--doux)}.tuile.chaud{border-color:var(--lav)}\n.btn.ok{background:var(--vert);border-color:var(--vert);color:#0b0a10}\n.afaire{margin:0;padding-left:18px}.afaire a{color:var(--lav2)}\n.ev{grid-template-columns:64px 56px 1fr auto}.mini{width:56px;height:56px;object-fit:cover;border-radius:8px}.vide-mini{display:grid;place-items:center;width:56px;height:56px;border-radius:8px;background:var(--ligne);font-weight:700}\n.barreEv{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.barreEv h2{flex:1;margin:0}\n.editeur.avecApercu{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,44%);gap:16px}.voletApercu{position:sticky;top:70px;align-self:start}.voletApercu iframe{height:80vh}\n.zones{display:grid;grid-template-columns:minmax(200px,1fr) 2fr;gap:14px}.photo.principale{width:260px}\nh3.section{margin:14px 0 0;font:700 18px \"Bricolage Grotesque\"}\n.barreTexte{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px}.barreTexte button{font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--ligne);background:var(--carte);color:var(--texte);cursor:pointer}\n.coche{display:flex;gap:8px;align-items:center;color:var(--texte)}.coche input{width:auto}\n.photo .legende{position:absolute;left:6px;bottom:30px;font-size:11px;background:rgba(11,10,16,.8);padding:1px 6px;border-radius:6px}\n.groupe.aClasser h3{color:var(--lav2)}\n.classer{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}.classer img{width:180px;border-radius:8px}\ntr.attente td{color:var(--doux)}\n@media (max-width:960px){.editeur.avecApercu{display:block}.voletApercu{position:static}.voletApercu iframe{height:60vh}}\n/* Boîte de dialogue interne (remplace les fenêtres du navigateur) */\n#dialogue{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:45;display:none;align-items:center;justify-content:center;padding:16px}\n#dialogue.ouvert{display:flex}\n#dialogue .boite{background:var(--carte);border:1px solid var(--ligne);border-radius:14px;padding:18px;width:min(94vw,440px);box-shadow:0 20px 60px rgba(0,0,0,.5)}\n#dialogue h3{margin:0 0 8px;font:700 18px \"Bricolage Grotesque\"}\n#dialogue p{margin:0 0 10px;color:var(--doux);white-space:pre-line}\n#dialogue .actions{justify-content:flex-end;margin-top:14px}\n/* Barre de tri et de filtre des événements */\n.barreTri{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}\n.barreTri select,.barreTri input{width:auto;min-width:150px;padding:7px 10px;font-size:14px}\n.barreTri input{flex:1;min-width:160px}\n.barreTri .compte{font-size:13px;color:var(--doux);margin-left:auto}\n/* Éditeur de texte mis en forme */\n.editeurTexte{min-height:110px;background:#100e17;border:1px solid var(--ligne);border-radius:8px;padding:9px 12px;line-height:1.5;outline:none}\n.editeurTexte:focus{border-color:var(--lav)}\n.editeurTexte:empty:before{content:attr(data-vide);color:var(--doux)}\n.editeurTexte p{margin:0 0 .7em}.editeurTexte p:last-child{margin-bottom:0}\n.editeurTexte h3{margin:.4em 0 .4em;font:700 17px \"Bricolage Grotesque\"}\n.editeurTexte blockquote{margin:.4em 0;padding:2px 12px;border-left:3px solid var(--lav);color:var(--doux);font-style:italic}\n.editeurTexte ul{margin:.3em 0;padding-left:22px}\n.barreTexte button.on{background:var(--lav);color:#0b0a10;border-color:var(--lav)}\n/* Aperçu : vrai rendu ordinateur, mis à l'échelle, ou largeur téléphone */\n.apercu .cadre{overflow:hidden;height:min(78vh,900px);border:1px solid var(--ligne);border-radius:12px;background:#120f24}\n.apercu iframe{display:block;width:1200px;height:900px;border:0;border-radius:0;transform-origin:0 0;background:#120f24}\n.apercu.tel .cadre{display:flex;justify-content:center;background:#0b0a10}\n.apercu.tel iframe{width:390px;height:100%;max-width:100%;margin:0;transform:none}\n.aide.alerte{color:var(--jaune,#ffd23f)}\n/* Vignette « envoi en cours » */\n.photo.envoi{display:grid;place-items:center;color:var(--doux);font-size:13px;border-style:dashed}\n.photo.envoi i{display:block;width:22px;height:22px;border:3px solid var(--ligne);border-top-color:var(--lav);border-radius:50%;animation:tourne .8s linear infinite;margin:0 auto 6px}\n@keyframes tourne{to{transform:rotate(360deg)}}\n/* Réglages : e-mails avec variables à insérer et aperçu en direct */\n.ongletsMail{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 10px}\n.ongletsMail button{background:var(--carte);border:1px solid var(--ligne);color:var(--texte);border-radius:999px;padding:7px 14px;font:600 14px Barlow,sans-serif;cursor:pointer}\n.ongletsMail button.on{background:var(--lav);border-color:var(--lav);color:#0b0a10}\n.editeurMail{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,46%);gap:16px;align-items:start}\n.editeurMail textarea{min-height:220px;font-size:15px}\n.puces{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 10px}\n.puces span{font-size:12px;color:var(--doux);align-self:center;margin-right:4px}\n.puces button{font:600 12px Barlow,sans-serif;background:var(--carte);border:1px dashed var(--lav);color:var(--lav2);border-radius:999px;padding:3px 9px;cursor:pointer}\n.puces button:hover{background:var(--lav);color:#0b0a10}\n.apercuMail{border:1px solid var(--ligne);border-radius:12px;overflow:hidden;position:sticky;top:70px}\n.apercuMail .entete{padding:10px 14px;background:var(--carte);border-bottom:1px solid var(--ligne);font-size:13px;color:var(--doux);line-height:1.5}\n.apercuMail .entete b{color:var(--texte)}\n.apercuMail .corps{background:#fff;color:#1b1733;padding:18px;max-height:70vh;overflow:auto}\n.apercuMail .corps a{color:#c81f74}\n@media (max-width:960px){.editeurMail{display:block}.apercuMail{position:static;margin-top:14px}}\n</style>\n</head>\n<body>\n<div id=\"charge\"></div>\n<header>\n  <h1><small id=\"nomFestival\">Festival</small>Réservations</h1>\n  <nav><button data-vue=\"accueil\" class=\"on\">Accueil</button> <button data-vue=\"evenements\">Événements</button> <button data-vue=\"photos\" data-droit=\"photos\">Visuels</button> <button data-vue=\"reglages\" data-droit=\"reglages,comptes\">Réglages</button> <button type=\"button\" class=\"discret\" id=\"quitter\" title=\"Changer de compte\">Quitter</button></nav>\n</header>\n<main id=\"vue\"><p class=\"vide\">Chargement…</p></main>\n<input type=\"file\" id=\"fichierPhoto\" accept=\"image/*\" multiple hidden>\n<input type=\"file\" id=\"fichiersGalerie\" accept=\"image/*\" multiple hidden>\n<div id=\"recadrage\"><div class=\"boite\"><canvas id=\"cv\"></canvas><div class=\"reglage\">Zoom <input type=\"range\" id=\"zoom\" min=\"1\" max=\"4\" step=\"0.01\" value=\"1\"> <button type=\"button\" class=\"btn petit\" id=\"tourner\">Tourner</button> <button type=\"button\" class=\"btn petit\" id=\"recentrer\">Recentrer</button> <label class=\"coche\"><input type=\"checkbox\" id=\"reperes\" checked> Repères</label></div>\n<p class=\"aide\">Déplacez la photo pour choisir le cadrage. Le cadre correspond aux photos du programme.</p>\n<div class=\"actions\"><button type=\"button\" class=\"btn plein\" id=\"recadrerOk\">Utiliser cette photo</button><button type=\"button\" class=\"btn\" id=\"recadrerNon\">Annuler</button></div></div></div>\n<div id=\"toast\"></div>\n<div id=\"dialogue\" role=\"dialog\" aria-modal=\"true\"><div class=\"boite\"><h3 id=\"dlgTitre\"></h3><p id=\"dlgTexte\"></p><input id=\"dlgChamp\" hidden><div class=\"actions\"><button type=\"button\" class=\"btn\" id=\"dlgNon\">Annuler</button><button type=\"button\" class=\"btn plein\" id=\"dlgOui\">OK</button></div></div></div>\n\n<script>\nvar CLE = <?!= JSON.stringify(cle) ?>;\n// E-mails de réservation : composition partagée entre le script (envoi) et l'appli (aperçu en direct).\n// Aucune dépendance Apps Script ici : ce fichier est aussi inséré dans Admin.html par assembler.py.\nvar MAIL = (function () {\n  var VARIABLES = [\n    ['nom', 'Prénom et nom', 'Camille Dupont'], ['prenom', 'Prénom', 'Camille'], ['places', 'Nombre de places', '2'],\n    ['titre', 'Titre du spectacle', 'Hurler sous l\\'eau'], ['date', 'Date (en toutes lettres)', 'vendredi 4 décembre 2026'], ['heure', 'Heure', '19:45'],\n    ['lieu', 'Lieu et adresse', 'Théâtricul, Rue de Genève 64, Chêne-Bourg'], ['adresse', 'Adresse seule', 'Rue de Genève 64, Chêne-Bourg'],\n    ['tarif', 'Tarif', 'Prix libre, 10 francs conseillés'], ['numero', 'Numéro de réservation', 'R-7F3K2'], ['email', 'E-mail de la personne', 'camille@example.ch'],\n    ['telephone', 'Téléphone de la personne', '079 000 00 00'], ['message', 'Message laissé', ''], ['festival', 'Nom du festival', 'Le Petit Festival au Théâtricul'], ['site', 'Adresse du site', 'https://petit-festival.ch']\n  ];\n  var TYPES = {\n    confirmation: { nom: 'Confirmation de réservation', sujet: 'sujet', message: 'message', billet: true },\n    annulation: { nom: 'Annulation', sujet: 'sujetAnnulation', message: 'messageAnnulation', billet: false },\n    attente: { nom: 'Liste d\\'attente', sujet: 'sujetAttente', message: 'messageAttente', billet: false }\n  };\n  function echapper(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;'); }\n  function remplir(modele, valeurs) {\n    return String(modele == null ? '' : modele).replace(/\\{(\\w+)\\}/g, function (tout, cle) { return cle in valeurs ? String(valeurs[cle] == null ? '' : valeurs[cle]) : tout; })\n      .replace(/[ \\t]+\\n/g, '\\n');\n  }\n  // Texte → paragraphes HTML ; **gras**, *italique*, liens cliquables.\n  function enLigne(t) {\n    return echapper(t).replace(/\\*\\*(.+?)\\*\\*/g, '<b>$1</b>').replace(/(^|[^*])\\*([^*\\n]+?)\\*/g, '$1<i>$2</i>')\n      .replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href=\"$1\" style=\"color:#c81f74\">$1</a>');\n  }\n  function texteVersHtml(texte) {\n    return String(texte || '').trim().split(/\\n\\s*\\n/).map(function (p) { return '<p style=\"margin:0 0 14px\">' + enLigne(p).replace(/\\n/g, '<br>') + '</p>'; }).join('');\n  }\n  var STYLE = 'font-family:Georgia,\\'Times New Roman\\',serif;font-size:16px;line-height:1.55;color:#1b1733;max-width:600px;margin:0 auto;';\n  // Billet : récapitulatif encadré, à présenter à l'entrée.\n  function billetHtml(v) {\n    var ligne = function (l, t) { return t ? '<tr><td style=\"padding:4px 12px 4px 0;color:#5b5570;font:13px/1.4 Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;vertical-align:top\">' + l + '</td><td style=\"padding:4px 0;font-size:16px;vertical-align:top\">' + echapper(t) + '</td></tr>' : ''; };\n    return '<div style=\"margin:20px 0;border:2px solid #1b1733;background:#f7f0e1;box-shadow:5px 5px 0 #6b2cff\">' +\n      '<div style=\"background:#1b1733;color:#f7f3ff;padding:10px 16px;font:700 13px/1.4 Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em\">' + echapper(v.festival || 'Billet') + ' <span style=\"float:right;color:#ff1fb4\">Billet</span></div>' +\n      '<div style=\"padding:16px 18px\"><div style=\"font:700 24px/1.15 Georgia,serif;margin:0 0 10px\">' + echapper(v.titre || '') + '</div><table style=\"border-collapse:collapse\">' +\n      ligne('Date', v.date) + ligne('Heure', v.heure) + ligne('Lieu', v.lieu) + ligne('Au nom de', v.nom) + ligne('Places', v.places) + (v.tarif ? ligne('Tarif', v.tarif) : '') + ligne('N°', v.numero) +\n      '</table><p style=\"margin:12px 0 0;font:13px/1.4 Arial,sans-serif;color:#5b5570\">Présentez ce billet (sur votre téléphone, c\\'est parfait) à l\\'entrée. Paiement sur place.</p></div></div>';\n  }\n  // Mail complet d'un type donné, d'après les réglages r et les valeurs v.\n  function composer(type, r, v) {\n    var t = TYPES[type] || TYPES.confirmation;\n    var sujet = remplir(r[t.sujet] || '', v), corps = remplir(r[t.message] || '', v), pied = remplir(r.piedDePage || '', v);\n    var avecBillet = t.billet && String(r.billet || '') === 'Oui';\n    var html = '<div style=\"' + STYLE + '\">' + texteVersHtml(corps) + (avecBillet ? billetHtml(v) : '') +\n      (pied.trim() ? '<div style=\"margin-top:28px;padding-top:14px;border-top:1px solid #dccfb4;font-size:13px;line-height:1.5;color:#5b5570\">' + texteVersHtml(pied).replace(/margin:0 0 14px/g, 'margin:0 0 6px') + '</div>' : '') + '</div>';\n    var texte = corps + (avecBillet ? '\\n\\n— Billet —\\n' + [v.titre, v.date + (v.heure ? ' à ' + v.heure : ''), v.lieu, 'Au nom de ' + v.nom + ' · ' + v.places + ' place(s)', 'N° ' + v.numero].filter(Boolean).join('\\n') : '') + (pied.trim() ? '\\n\\n--\\n' + pied : '');\n    return { sujet: sujet, texte: texte, html: html };\n  }\n  function exemple() { var v = {}; VARIABLES.forEach(function (x) { v[x[0]] = x[2]; }); return v; }\n  return { VARIABLES: VARIABLES, TYPES: TYPES, remplir: remplir, texteVersHtml: texteVersHtml, billetHtml: billetHtml, composer: composer, exemple: exemple, echapper: echapper };\n})();\n\nvar VERSION_APPLI = '4050dafb8eab', PIN = '', JETON = '', COMPTE = null, D = null, vue = 'accueil', ouvert = null;\nfunction lireLocal(k) { try { return localStorage.getItem('festival_resa_' + k) || ''; } catch (e) { return ''; } }\nfunction garderLocal(k, v) { try { if (v) localStorage.setItem('festival_resa_' + k, v); else localStorage.removeItem('festival_resa_' + k); } catch (e) {} }\n// Cet appareil : un identifiant gardé dans le navigateur + un nom lisible (pour la liste des appareils connectés).\nvar APPAREIL = (function () {\n  var id = lireLocal('appareil'); if (!id) { id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)); garderLocal('appareil', id); }\n  var ua = navigator.userAgent || '', os = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Ordinateur';\n  var nav = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Safari/.test(ua) ? 'Safari' : '';\n  var appli = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;\n  return { id: id, nom: os + (nav ? ' · ' + nav : '') + (appli ? ' · appli installée' : '') };\n})();\nfunction droit(k) { return !COMPTE || !!COMPTE.droits[k]; }\nfunction deconnexion() { garderLocal('pin', ''); garderLocal('cle', ''); garderLocal('jeton', ''); PIN = ''; JETON = ''; COMPTE = null; D = null; location.reload(); }\n// Écran d'entrée par code PIN (appli GitHub Pages ; l'écran Apps Script, lui, s'ouvre par le lien personnel).\nfunction ecranPin(message) {\n  $('#vue').innerHTML = '<form class=\"pin\" id=\"formPin\"><img src=\"icone_192.png\" alt=\"\"><h2>Code PIN</h2>' +\n    (message ? '<p class=\"aide\" style=\"color:var(--rouge)\">' + esc(message) + '</p>' : '<p class=\"aide\">Le code que le festival vous a donné.</p>') +\n    '<input id=\"pinSaisie\" type=\"password\" inputmode=\"numeric\" autocomplete=\"one-time-code\" pattern=\"[0-9]*\" maxlength=\"8\" placeholder=\"••••\" autofocus required>' +\n    '<button class=\"btn plein\" type=\"submit\">Entrer</button></form>';\n  $('#formPin').onsubmit = function (ev) {\n    ev.preventDefault(); PIN = $('#pinSaisie').value.replace(/\\D/g, '');\n    appel('adminCharger', [], function (res) { PIN = ''; recharger(res); });\n  };\n}\nvar MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];\n\nfunction $(s, r) { return (r || document).querySelector(s); }\nfunction esc(t) { return String(t == null ? '' : t).replace(/[&<>\"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]; }); }\nfunction toast(t, err) { var b = $('#toast'); b.textContent = t; b.className = err ? 'erreur' : ''; b.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { b.style.display = 'none'; }, err ? 6000 : 2500); }\nfunction aujourdhui() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }\n\n// Boîtes de dialogue de l'appli (pas celles du navigateur). confirmer(texte, ok, options) ; demander(texte, ok, options)\nfunction dialogue(o) {\n  var d = $('#dialogue'), ch = $('#dlgChamp');\n  $('#dlgTitre').textContent = o.titre || ''; $('#dlgTitre').hidden = !o.titre; $('#dlgTexte').textContent = o.texte || '';\n  ch.hidden = !o.champ; ch.value = o.champ ? (o.defaut || '') : ''; ch.placeholder = o.placeholder || '';\n  $('#dlgOui').textContent = o.oui || 'OK'; $('#dlgNon').textContent = o.non || 'Annuler'; $('#dlgNon').hidden = o.non === false;\n  $('#dlgOui').className = 'btn ' + (o.danger ? 'danger' : 'plein');\n  d.classList.add('ouvert');\n  function fermer() { d.classList.remove('ouvert'); d.onkeydown = null; }\n  $('#dlgOui').onclick = function () { fermer(); if (o.ok) o.ok(o.champ ? ch.value : true); };\n  $('#dlgNon').onclick = function () { fermer(); if (o.annuler) o.annuler(); };\n  d.onclick = function (ev) { if (ev.target === d) $('#dlgNon').click(); };\n  d.onkeydown = function (ev) { if (ev.key === 'Escape') $('#dlgNon').click(); if (ev.key === 'Enter' && o.champ) { ev.preventDefault(); $('#dlgOui').click(); } };\n  setTimeout(function () { (o.champ ? ch : $('#dlgOui')).focus(); }, 30);\n}\nfunction confirmer(texte, ok, o) { o = o || {}; dialogue({ titre: o.titre, texte: texte, oui: o.oui || 'Oui', non: o.non || 'Annuler', danger: o.danger, ok: ok, annuler: o.annuler }); }\nfunction demander(texte, ok, o) { o = o || {}; dialogue({ titre: o.titre, texte: texte, champ: true, defaut: o.defaut, placeholder: o.placeholder, oui: o.oui || 'OK', ok: function (v) { if (o.vide || v.trim()) ok(v.trim()); } }); }\n\nfunction appel(fn, args, ok) {\n  $('#charge').style.display = 'block';\n  var r = google.script.run.withSuccessHandler(function (res) { $('#charge').style.display = 'none'; ok(res); })\n    .withFailureHandler(function (e) { $('#charge').style.display = 'none'; toast(e.message || String(e), true); });\n  r[fn].apply(r, [CLE].concat(args || []));\n}\nfunction recharger(res) {\n  D = res; COMPTE = res.compte || null; $('#nomFestival').textContent = D.reglages.nomFestival || 'Festival';\n  if (res.jeton) { JETON = res.jeton; garderLocal('jeton', JETON); garderLocal('pin', ''); } // cet appareil est reconnu : plus de code PIN à redonner\n  document.querySelectorAll('nav [data-droit]').forEach(function (b) { b.hidden = !b.dataset.droit.split(',').some(droit); });\n  $('#quitter').hidden = !COMPTE || (COMPTE.id === 'cle' && !JETON);\n  if ((vue === 'photos' && !droit('photos')) || (vue === 'reglages' && !droit('reglages') && !droit('comptes'))) { vue = 'evenements'; ouvert = null; document.querySelectorAll('nav button[data-vue]').forEach(function (x) { x.classList.toggle('on', x.dataset.vue === vue); }); }\n  afficher();\n}\n\n$('#quitter').onclick = function () { confirmer('Quitter ce compte sur cet appareil ? Il faudra redonner le code PIN.', function () { if (JETON) appel('adminQuitterAppareil', [], deconnexion); else deconnexion(); }, { oui: 'Quitter' }); };\ndocument.querySelectorAll('nav button[data-vue]').forEach(function (b) {\n  b.onclick = function () { vue = b.dataset.vue; ouvert = null; document.querySelectorAll('nav button').forEach(function (x) { x.classList.toggle('on', x === b); }); afficher(); };\n});\n\n// ---------- Tableau de bord (page d'accueil) ----------\nfunction afficherAccueil() {\n  var today = aujourdhui(), dans7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);\n  var evs = D.evenements.slice().sort(function (a, b) { return (a.date + a.debut) < (b.date + b.debut) ? -1 : 1; });\n  var publics = evs.filter(function (e) { return e.statut === 'Ouvert' || e.statut === 'Fermé'; });\n  var avenir = publics.filter(function (e) { return e.date >= today; });\n  var resas = D.reservations.filter(function (r) { return r.statut !== 'Annulée'; });\n  var confirmees = resas.filter(function (r) { return r.statut !== 'Liste d\\'attente'; });\n  var attente = resas.filter(function (r) { return r.statut === 'Liste d\\'attente'; });\n  var places = confirmees.reduce(function (s, r) { return s + (Number(r.places) || 0); }, 0);\n  var capacite = avenir.reduce(function (s, e) { return s + (Number(e.places) || 0); }, 0);\n  var prisesAvenir = avenir.reduce(function (s, e) { return s + (Number(e.prises) || 0); }, 0);\n  var complets = avenir.filter(function (e) { return Number(e.places) && e.prises >= Number(e.places); });\n  function tuile(n, l, c) { return '<div class=\"tuile' + (c ? ' ' + c : '') + '\"><b>' + n + '</b><span>' + l + '</span></div>'; }\n  var h = '<h2>Tableau de bord</h2><div class=\"tuiles\">' +\n    tuile(places, 'place' + (places > 1 ? 's' : '') + ' réservée' + (places > 1 ? 's' : '')) +\n    tuile(avenir.length, 'spectacle' + (avenir.length > 1 ? 's' : '') + ' à venir') +\n    tuile(capacite ? Math.round(100 * prisesAvenir / capacite) + ' %' : '–', 'de remplissage à venir') +\n    tuile(complets.length, 'complet' + (complets.length > 1 ? 's' : ''), complets.length ? 'chaud' : '') +\n    (attente.length ? tuile(attente.length, 'en liste d\\'attente', 'chaud') : '') + '</div>';\n  var proches = avenir.filter(function (e) { return e.date <= dans7; });\n  h += '<h2>' + (proches.length ? 'Ces 7 prochains jours' : 'Prochains spectacles') + '</h2>' + liste(proches.length ? proches : avenir.slice(0, 5));\n  if (droit('reservations') && resas.length) {\n    var dernieres = D.reservations.slice().reverse().slice(0, 8);\n    h += '<h2>Dernières réservations</h2><div class=\"panneau\"><div class=\"tableau\"><table><tr><th>Reçue</th><th>Nom</th><th>Spectacle</th><th>Places</th><th>Statut</th></tr>' +\n      dernieres.map(function (r) { return '<tr class=\"' + (r.statut === 'Annulée' ? 'annulee' : '') + '\"><td>' + esc(r.recue) + '</td><td>' + esc(r.nom) + '</td><td>' + esc(r.titreEvenement) + '</td><td>' + r.places + '</td><td>' + esc(r.statut) + '</td></tr>'; }).join('') + '</table></div></div>';\n  }\n  var afaire = [];\n  evs.filter(function (e) { return e.date >= today; }).forEach(function (e) {\n    var manques = [];\n    if (e.statut === 'Brouillon') manques.push('encore en brouillon');\n    if (!e.image && !(window.SPECTACLES && photosSitePour(e.spectacle || e.titre).length)) manques.push('pas de visuel');\n    if (!e.description && !(window.SPECTACLES && ficheSite(e.spectacle || e.titre).court)) manques.push('pas d\\'accroche');\n    if (!e.tarif && !(window.SPECTACLES && ficheSite(e.spectacle || e.titre).tarif)) manques.push('pas de tarif');\n    if (manques.length) afaire.push({ e: e, manques: manques });\n  });\n  attente.forEach(function (r) { var e = evs.filter(function (x) { return x.id === r.evenement; })[0]; if (e && e.prises < (Number(e.places) || 0)) afaire.push({ e: e, manques: ['une place s\\'est libérée : ' + r.nom + ' attend (' + r.places + ')'] }); });\n  if (droit('evenements') || droit('reservations')) {\n    h += '<h2>À faire</h2><div class=\"panneau\">' + (afaire.length ? '<ul class=\"afaire\">' + afaire.map(function (a) {\n      return '<li><a href=\"#\" data-ouvrir=\"' + esc(a.e.id) + '\"><b>' + esc(a.e.titre) + '</b> · ' + esc(a.e.date.split('-').reverse().join('.')) + '</a> — ' + esc(a.manques.join(', ')) + '</li>';\n    }).join('') + '</ul>' : '<p class=\"vide\">Rien à signaler : tout est en ordre.</p>') + '</div>';\n  }\n  $('#vue').innerHTML = h;\n  document.querySelectorAll('[data-ouvrir]').forEach(function (a) { a.onclick = function (ev) { ev.preventDefault(); ouvrirEvenement(a.dataset.ouvrir); }; });\n  activerListe();\n  if (!window.SPECTACLES && siteUrl()) chargerSite(function () { if (vue === 'accueil' && !ouvert) afficherAccueil(); });\n}\nfunction ouvrirEvenement(id) { vue = 'evenements'; ouvert = id; document.querySelectorAll('nav button[data-vue]').forEach(function (x) { x.classList.toggle('on', x.dataset.vue === 'evenements'); }); afficher(); scrollTo(0, 0); }\nfunction ficheSite(titre) { var SP = window.SPECTACLES || {}, k = Object.keys(SP).filter(function (k) { return normTitre(k) === normTitre(titre); })[0]; return k ? SP[k] : {}; }\nfunction photosSitePour(titre) { var s = ficheSite(titre); return s.photos || (s.photo ? [{ src: s.photo, credit: s.credit }] : []); }\nfunction miniature(e) {\n  var u = String(e.image || '').split(/\\s*[\\n,]\\s*/).filter(Boolean)[0];\n  if (!u && window.SPECTACLES && siteUrl()) { var l = photosSitePour(e.spectacle || e.titre); if (l.length) u = siteUrl() + l[0].src; }\n  return u ? '<img class=\"mini\" src=\"' + esc(u) + '\" alt=\"\" loading=\"lazy\">' : '<span class=\"mini vide-mini\">' + esc((e.titre || '?').charAt(0)) + '</span>';\n}\nfunction activerListe() {\n  document.querySelectorAll('.ev').forEach(function (b) { b.onclick = function () { ouvrirEvenement(b.dataset.id); }; });\n  document.querySelectorAll('.statutRapide').forEach(function (s) {\n    s.onclick = function (ev) { ev.stopPropagation(); };\n    s.onchange = function (ev) {\n      ev.stopPropagation();\n      var e = D.evenements.filter(function (x) { return x.id === s.dataset.id; })[0]; if (!e) return;\n      var o = {}; Object.keys(e).forEach(function (k) { o[k] = e[k]; }); o.statut = s.value;\n      appel('adminEnregistrerEvenement', [o], function (res) { recharger(res); toast('« ' + e.titre + ' » : ' + s.value); });\n    };\n  });\n}\n\nvar TRI_EV = { statut: '', ordre: 'date', q: '' };\nfunction afficher() {\n  if (!D) return;\n  if (vue === 'reglages') return afficherReglages();\n  if (vue === 'photos') return afficherPhotos();\n  if (ouvert) return afficherEvenement(ouvert);\n  if (vue === 'accueil') return afficherAccueil();\n  var today = aujourdhui(), q = normTitre(TRI_EV.q);\n  var evs = D.evenements.filter(function (e) {\n    if (TRI_EV.statut === 'Complet') { var pl = Number(e.places) || 0; if (!(pl && e.prises >= pl)) return false; }\n    else if (TRI_EV.statut && e.statut !== TRI_EV.statut) return false;\n    if (q && normTitre([e.titre, e.spectacle, e.compagnie, e.lieu].join(' ')).indexOf(q) < 0) return false;\n    return true;\n  }).sort(function (a, b) {\n    if (TRI_EV.ordre === 'titre') return (a.titre || '').localeCompare(b.titre || '', 'fr');\n    if (TRI_EV.ordre === 'remplissage') { var ra = Number(a.places) ? a.prises / Number(a.places) : -1, rb = Number(b.places) ? b.prises / Number(b.places) : -1; return rb - ra || (a.date + a.debut < b.date + b.debut ? -1 : 1); }\n    if (TRI_EV.ordre === 'recent') return (b.cree || '') < (a.cree || '') ? -1 : 1;\n    return (a.date + a.debut) < (b.date + b.debut) ? -1 : 1;\n  });\n  var parDate = TRI_EV.ordre === 'date' || !TRI_EV.ordre;\n  var avenir = parDate ? evs.filter(function (e) { return e.date >= today; }) : evs;\n  var passes = parDate ? evs.filter(function (e) { return e.date < today; }).reverse() : [];\n  var h = droit('evenements') ? '<div class=\"actions\"><button class=\"btn plein\" id=\"nouveau\">+ Nouvel événement</button></div>' : '';\n  h += '<div class=\"barreTri\"><select id=\"triStatut\" aria-label=\"Filtrer par statut\"><option value=\"\">Tous les statuts</option>' + D.statuts.map(function (s) { return '<option' + (s === TRI_EV.statut ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '<option value=\"Complet\"' + (TRI_EV.statut === 'Complet' ? ' selected' : '') + '>Complets</option></select>' +\n    '<select id=\"triOrdre\" aria-label=\"Trier\"><option value=\"date\">Par date</option><option value=\"titre\"' + (TRI_EV.ordre === 'titre' ? ' selected' : '') + '>Par titre</option><option value=\"remplissage\"' + (TRI_EV.ordre === 'remplissage' ? ' selected' : '') + '>Par remplissage</option><option value=\"recent\"' + (TRI_EV.ordre === 'recent' ? ' selected' : '') + '>Derniers créés</option></select>' +\n    '<input id=\"triQ\" type=\"search\" placeholder=\"Chercher un titre, une compagnie…\" value=\"' + esc(TRI_EV.q) + '\"><span class=\"compte\">' + evs.length + ' / ' + D.evenements.length + '</span></div>';\n  if (D.version && VERSION_APPLI !== '4050dafb8eab' && D.version !== VERSION_APPLI && droit('comptes')) h += '<div class=\"bandeau\">Le script Google (version ' + esc(D.version) + ') n\\'est pas celui de l\\'appli (' + esc(VERSION_APPLI) + '). <button type=\"button\" class=\"btn petit plein\" id=\"majScript\">Mettre à jour le script</button> <span class=\"aide\" style=\"display:inline\">Ça prend quelques secondes ; sinon, il se met à jour tout seul dans l\\'heure.</span></div>';\n  if (COMPTE && COMPTE.id === 'cle' && droit('comptes') && !PIN) h += '<div class=\"bandeau\" id=\"bandeauPin\">Vous êtes entrée avec le lien personnel. Créez votre code PIN et ceux des bénévoles dans <a href=\"#\" id=\"versComptes\">Réglages → Comptes</a> : ensuite l\\'appli s\\'ouvre avec le code, sur n\\'importe quel appareil.</div>';\n  h += parDate ? '<h2>À venir</h2>' + liste(avenir) + '<h2>Passés</h2>' + liste(passes) : liste(avenir);\n  $('#vue').innerHTML = h;\n  $('#triStatut').onchange = function () { TRI_EV.statut = this.value; afficher(); };\n  $('#triOrdre').onchange = function () { TRI_EV.ordre = this.value; afficher(); };\n  $('#triQ').oninput = function () { TRI_EV.q = this.value; var pos = this.selectionStart; afficher(); var c = $('#triQ'); c.focus(); c.setSelectionRange(pos, pos); };\n  if ($('#nouveau')) $('#nouveau').onclick = function () { ouvert = 'nouveau'; afficher(); };\n  if ($('#majScript')) $('#majScript').onclick = function () { $('#majScript').disabled = true; toast('Mise à jour en cours…'); appel('adminMettreAJour', [], function (t) { toast(t); setTimeout(function () { appel('adminCharger', [], recharger); }, 1500); }); };\n  if ($('#versComptes')) $('#versComptes').onclick = function (ev) { ev.preventDefault(); $('nav [data-vue=reglages]').click(); setTimeout(function () { var c = $('#comptes'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }, 300); };\n  activerListe();\n  if (!window.SPECTACLES && siteUrl()) chargerSite(function () { if (vue === 'evenements' && !ouvert) afficher(); });\n}\n\nfunction liste(evs) {\n  if (!evs.length) return '<p class=\"vide\">Aucun événement.</p>';\n  return '<div class=\"liste\">' + evs.map(function (e) {\n    var p = e.date.split('-'), places = Number(e.places) || 0;\n    var pc = places ? Math.min(100, Math.round(100 * e.prises / places)) : 0, complet = places && e.prises >= places;\n    var attente = D.reservations.filter(function (r) { return r.evenement === e.id && r.statut === 'Liste d\\'attente'; }).length;\n    return '<button class=\"ev\" data-id=\"' + esc(e.id) + '\"><div class=\"jour\"><b>' + Number(p[2]) + '</b><span>' + MOIS[Number(p[1]) - 1] + ' ' + p[0] + '</span></div>' + miniature(e) +\n      '<div><h3>' + esc(e.titre) + '<span class=\"badge ' + esc(e.statut) + '\">' + esc(e.statut) + '</span>' + (complet ? '<span class=\"badge Annulé\">Complet</span>' : '') + '</h3>' +\n      '<p>' + esc([e.debut && (e.debut + (e.fin ? '–' + e.fin : '')), e.lieu].filter(Boolean).join(' · ')) + (attente ? ' · ' + attente + ' en liste d\\'attente' : '') + '</p></div>' +\n      '<div class=\"jauge\">' + e.prises + (places ? ' / ' + places : '') + ' place' + (e.prises > 1 || places > 1 ? 's' : '') +\n      (places ? '<div class=\"barre\"><i style=\"width:' + pc + '%\"></i></div>' : '') +\n      (droit('publier') ? '<select class=\"statutRapide\" data-id=\"' + esc(e.id) + '\" aria-label=\"Statut\">' + D.statuts.map(function (s) { return '<option' + (s === e.statut ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' : '<div><span class=\"badge ' + esc(e.statut) + '\">' + esc(e.statut) + '</span></div>') + '</div></button>';\n  }).join('') + '</div>';\n}\n\nfunction champ(nom, label, val, type, attrs) {\n  return '<div' + (type === 'textarea' ? ' class=\"large\"' : '') + '><label for=\"f-' + nom + '\">' + label + '</label>' +\n    (type === 'textarea' ? '<textarea id=\"f-' + nom + '\" name=\"' + nom + '\">' + esc(val) + '</textarea>'\n      : '<input id=\"f-' + nom + '\" name=\"' + nom + '\" type=\"' + (type || 'text') + '\" value=\"' + esc(val) + '\" ' + (attrs || '') + '>') + '</div>';\n}\n// Zone de texte avec une petite barre de mise en forme (gras, italique, sous-titre, citation, liste).\nfunction champTexte(nom, label, val, aide, vide) {\n  return '<div class=\"large\"><label for=\"f-' + nom + '-ed\">' + label + '</label>' +\n    '<div class=\"barreTexte\" data-pour=\"f-' + nom + '\"><button type=\"button\" data-mf=\"bold\" title=\"Gras (Ctrl+B)\"><b>G</b></button><button type=\"button\" data-mf=\"italic\" title=\"Italique (Ctrl+I)\"><i>I</i></button>' +\n    '<button type=\"button\" data-mf=\"h3\" title=\"Sous-titre\">Sous-titre</button><button type=\"button\" data-mf=\"blockquote\" title=\"Citation\">« Citation »</button><button type=\"button\" data-mf=\"ul\" title=\"Liste à puces\">• Liste</button><button type=\"button\" data-mf=\"p\" title=\"Texte normal\">Normal</button></div>' +\n    '<div class=\"editeurTexte\" id=\"f-' + nom + '-ed\" contenteditable=\"true\" data-vide=\"' + esc(vide || 'Tapez votre texte ici…') + '\">' + mdVersHtml(val) + '</div>' +\n    '<textarea id=\"f-' + nom + '\" name=\"' + nom + '\" hidden>' + esc(val) + '</textarea>' + (aide ? '<p class=\"aide\">' + aide + '</p>' : '') + '</div>';\n}\n// Le texte est gardé dans la feuille en « markdown léger » (**gras**, *italique*, ## sous-titre, > citation, - liste) :\n// c'est ce que le site sait afficher. L'éditeur montre le rendu et convertit dans les deux sens.\nfunction enligne(t) { return esc(t).replace(/\\*\\*(.+?)\\*\\*/g, '<b>$1</b>').replace(/(^|[^*])\\*([^*\\n]+?)\\*/g, '$1<i>$2</i>'); }\nfunction mdVersHtml(md) {\n  var out = '', lignes = String(md || '').replace(/\\r/g, '').split('\\n'), i = 0, par = [];\n  function videPar() { if (par.length) { out += '<p>' + par.map(enligne).join('<br>') + '</p>'; par = []; } }\n  while (i < lignes.length) {\n    var l = lignes[i];\n    if (/^## /.test(l)) { videPar(); out += '<h3>' + enligne(l.slice(3)) + '</h3>'; i++; }\n    else if (/^> /.test(l)) { videPar(); var c = []; while (i < lignes.length && /^> /.test(lignes[i])) c.push(enligne(lignes[i].slice(2))), i++; out += '<blockquote>' + c.join('<br>') + '</blockquote>'; }\n    else if (/^- /.test(l)) { videPar(); var li = []; while (i < lignes.length && /^- /.test(lignes[i])) li.push('<li>' + enligne(lignes[i].slice(2)) + '</li>'), i++; out += '<ul>' + li.join('') + '</ul>'; }\n    else if (!l.trim()) { videPar(); i++; }\n    else { par.push(l); i++; }\n  }\n  videPar(); return out;\n}\nfunction htmlVersMd(racine) {\n  function texte(n) { // contenu en ligne d'un bloc\n    var s = '';\n    n.childNodes.forEach(function (c) {\n      if (c.nodeType === 3) s += c.nodeValue.replace(/\\s+/g, ' ');\n      else if (c.nodeName === 'BR') s += '\\n';\n      else if (c.nodeName === 'B' || c.nodeName === 'STRONG' || (c.style && c.style.fontWeight && +c.style.fontWeight >= 600)) { var t = texte(c).trim(); if (t) s += '**' + t + '**'; }\n      else if (c.nodeName === 'I' || c.nodeName === 'EM' || (c.style && c.style.fontStyle === 'italic')) { var t2 = texte(c).trim(); if (t2) s += '*' + t2 + '*'; }\n      else if (/^(P|DIV|H[1-6]|BLOCKQUOTE|UL|OL|LI)$/.test(c.nodeName)) s += '\\n' + texte(c) + '\\n';\n      else s += texte(c);\n    });\n    return s;\n  }\n  var blocs = [], enLigne = null; // texte et balises en ligne posés directement à la racine : regroupés en un paragraphe\n  function finEnLigne() { if (enLigne) { var t = texte(enLigne).replace(/^\\n+|\\n+$/g, '').trim(); if (t) blocs.push(t); enLigne = null; } }\n  racine.childNodes.forEach(function (n) {\n    var nom = n.nodeName;\n    if (n.nodeType === 3 || /^(B|STRONG|I|EM|SPAN|A|U|BR|FONT)$/.test(nom)) { if (!enLigne) enLigne = document.createElement('div'); enLigne.appendChild(n.cloneNode(true)); return; }\n    finEnLigne();\n    if (/^H[1-6]$/.test(nom)) blocs.push('## ' + texte(n).trim().replace(/\\n+/g, ' '));\n    else if (nom === 'BLOCKQUOTE') blocs.push(texte(n).trim().split(/\\n+/).map(function (l) { return '> ' + l.trim(); }).join('\\n'));\n    else if (nom === 'UL' || nom === 'OL') blocs.push(Array.prototype.map.call(n.querySelectorAll('li'), function (li) { return '- ' + texte(li).trim().replace(/\\n+/g, ' '); }).join('\\n'));\n    else if (nom === 'BR') return;\n    else { var t = texte(n).replace(/^\\n+|\\n+$/g, '').replace(/\\n{2,}/g, '\\n'); if (t.trim()) blocs.push(t); }\n  });\n  finEnLigne();\n  return blocs.join('\\n\\n').replace(/[ \\t]+\\n/g, '\\n').trim();\n}\nfunction miseEnFormeInit(racine) {\n  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}\n  (racine || document).querySelectorAll('.editeurTexte').forEach(function (ed) {\n    var ta = $('#' + ed.id.replace(/-ed$/, ''));\n    function sync() { ta.value = htmlVersMd(ed); }\n    ed.addEventListener('input', sync);\n    ed.addEventListener('focus', function () { if (!ed.innerHTML.trim()) { ed.innerHTML = '<p><br></p>'; var r = document.createRange(); r.setStart(ed.firstChild, 0); r.collapse(true); var s = getSelection(); s.removeAllRanges(); s.addRange(r); } });\n    ed.addEventListener('blur', function () { sync(); if (ta.value !== htmlVersMd(ed)) return; });\n    ed.addEventListener('paste', function (ev) { ev.preventDefault(); var t = (ev.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });\n    ed.addEventListener('keydown', function (ev) {\n      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'b') { ev.preventDefault(); document.execCommand('bold'); sync(); }\n      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'i') { ev.preventDefault(); document.execCommand('italic'); sync(); }\n    });\n    ed.addEventListener('keyup', function () { etatBarre(ed); });\n    ed.addEventListener('mouseup', function () { etatBarre(ed); });\n  });\n  function etatBarre(ed) {\n    var barre = ed.parentNode.querySelector('.barreTexte'); if (!barre) return;\n    var bloc = (document.queryCommandValue('formatBlock') || '').toLowerCase();\n    barre.querySelectorAll('button').forEach(function (b) {\n      var m = b.dataset.mf, on = false;\n      try { on = m === 'bold' ? document.queryCommandState('bold') : m === 'italic' ? document.queryCommandState('italic') : m === 'ul' ? document.queryCommandState('insertUnorderedList') : m === 'h3' ? bloc === 'h3' : m === 'blockquote' ? bloc === 'blockquote' : false; } catch (e) {}\n      b.classList.toggle('on', !!on);\n    });\n  }\n  (racine || document).querySelectorAll('.barreTexte button').forEach(function (b) {\n    b.onmousedown = function (ev) { ev.preventDefault(); }; // garder la sélection dans l'éditeur\n    b.onclick = function () {\n      var ed = $('#' + b.parentNode.dataset.pour + '-ed'), m = b.dataset.mf; ed.focus();\n      if (m === 'bold' || m === 'italic') document.execCommand(m);\n      else if (m === 'ul') document.execCommand('insertUnorderedList');\n      else if (m === 'h3' || m === 'blockquote') { var bloc = (document.queryCommandValue('formatBlock') || '').toLowerCase(); document.execCommand('formatBlock', false, bloc === m ? 'p' : m); }\n      else document.execCommand('formatBlock', false, 'p');\n      ed.dispatchEvent(new Event('input', { bubbles: true })); etatBarre(ed);\n    };\n  });\n}\n\n// Durée ↔ heure de fin\nfunction minutesDe(duree) { var m = /(\\d+)\\s*h\\s*(\\d+)?/i.exec(duree); if (m) return Number(m[1]) * 60 + Number(m[2] || 0); m = /(\\d+)\\s*(min|mn|')?/.exec(duree); return m ? Number(m[1]) : 0; }\nfunction texteDuree(min) { if (!min) return ''; var h = Math.floor(min / 60), m = min % 60; return h ? h + ' h' + (m ? ' ' + ('0' + m).slice(-2) : '') : m + ' min'; }\nfunction heurePlus(debut, min) { var p = debut.split(':'); if (p.length < 2) return ''; var t = (Number(p[0]) * 60 + Number(p[1]) + min) % 1440; return ('0' + Math.floor(t / 60)).slice(-2) + ':' + ('0' + (t % 60)).slice(-2); }\nfunction ecartMinutes(debut, fin) { var a = debut.split(':'), b = fin.split(':'); if (a.length < 2 || b.length < 2) return 0; var t = (Number(b[0]) * 60 + Number(b[1])) - (Number(a[0]) * 60 + Number(a[1])); return t < 0 ? t + 1440 : t; }\n\nvar MODIFIE = false;\nwindow.addEventListener('beforeunload', function (ev) { if (MODIFIE) { ev.preventDefault(); ev.returnValue = ''; } });\n\nfunction afficherEvenement(id) {\n  var nouveau = id === 'nouveau' || id === 'copie';\n  var e = id === 'nouveau' ? { statut: 'Brouillon', places: '45', lieu: 'Théâtricul', adresse: 'Chêne-Bourg' } : (id === 'copie' ? afficherEvenement.copie : D.evenements.filter(function (x) { return x.id === id; })[0]);\n  if (!e) { ouvert = null; return afficher(); }\n  if (nouveau && !droit('evenements')) { ouvert = null; return afficher(); }\n  var peutModifier = droit('evenements'), peutResa = droit('reservations');\n  MODIFIE = false;\n  var h = '<div class=\"barreEv\"><button class=\"btn\" id=\"retour\">← Tous les événements</button><h2>' + (nouveau ? 'Nouvel événement' : 'Modifier · ' + esc(e.titre)) + '</h2>' +\n    (peutModifier ? '<button class=\"btn plein\" type=\"submit\" form=\"form\" id=\"enregistrerHaut\">Enregistrer</button>' : '') +\n    (siteUrl() ? '<button class=\"btn\" type=\"button\" id=\"voirApercu\">Aperçu</button>' : '') + '</div>';\n  h += '<div class=\"editeur\" id=\"editeur\"><div class=\"colonne\">';\n  h += '<form id=\"form\" class=\"panneau\"><div class=\"grille\">' +\n    champ('titre', 'Titre affiché', e.titre, 'text', 'required list=\"spectacles\"') +\n    '<datalist id=\"spectacles\">' + D.spectacles.map(function (s) { return '<option value=\"' + esc(s) + '\">'; }).join('') + '</datalist>' +\n    champ('spectacle', 'Spectacle (pour regrouper les séances)', e.spectacle, 'text', 'list=\"spectacles\" placeholder=\"Vide = même que le titre\"') +\n    champ('compagnie', 'Compagnie / artistes', e.compagnie) +\n    champ('date', 'Date', e.date, 'date', 'required') +\n    champ('debut', 'Début', e.debut, 'time') +\n    champ('fin', 'Fin (calculée depuis la durée)', e.fin, 'time') +\n    champ('duree', 'Durée (ou calculée depuis la fin)', e.duree, 'text', 'placeholder=\"50 min\"') +\n    champ('age', 'Âge', e.age, 'text', 'placeholder=\"Dès 6 ans, tout public…\"') +\n    champ('lieu', 'Lieu', e.lieu) +\n    champ('adresse', 'Adresse', e.adresse) +\n    champ('tarif', 'Tarif (texte)', e.tarif, 'text', 'placeholder=\"Prix libre, paiement sur place\"') +\n    champ('places', 'Nombre de places (vide = illimité)', e.places, 'number', 'min=\"0\"') +\n    '<div><label>Quand c\\'est complet</label><label class=\"coche\"><input type=\"checkbox\" name=\"attente\" value=\"Oui\"' + (e.attente === 'Oui' ? ' checked' : '') + '> ouvrir une liste d\\'attente</label><p class=\"aide\">Le site affiche « Complet » et bloque les réservations ; avec la liste d\\'attente, les gens peuvent s\\'inscrire et vous les confirmez ici quand une place se libère.</p></div>' +\n    (droit('publier') ? '<div><label for=\"f-statut\">Statut</label><select id=\"f-statut\" name=\"statut\">' +\n      D.statuts.map(function (s) { return '<option' + (s === e.statut ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +\n      '<p class=\"aide\">Ouvert : réservable. Fermé : affiché sans réservation. Brouillon et Annulé : cachés du site.</p></div>'\n      : '<div><label>Statut</label><p><span class=\"badge ' + esc(e.statut) + '\">' + esc(e.statut || 'Brouillon') + '</span></p><p class=\"aide\">Seul un compte avec le droit « Publier » peut le changer.</p></div>') +\n    '<div class=\"large\"><h3 class=\"section\">Visuels</h3>' +\n    '<div class=\"zones\"><div class=\"zone\"><label>Visuel principal</label><div class=\"photos\" id=\"photoPrincipale\"></div><p class=\"aide\">Programme et accueil (format 3:2), haut de la fiche (plus large, recadré au centre) et miniature.</p></div>' +\n    '<div class=\"zone\"><label>Galerie de la fiche (dans l\\'ordre)</label><div class=\"photos\" id=\"photos\"></div><p class=\"aide\">Vignettes sous le grand visuel de la fiche. ← → pour l\\'ordre, ★ pour en faire le visuel principal.</p></div></div>' +\n    '<textarea id=\"f-image\" name=\"image\" hidden>' + esc(e.image) + '</textarea>' +\n    '<div class=\"zone\" style=\"margin-top:12px\"><label for=\"f-video\">Vidéo (lien YouTube ou Vimeo, facultatif)</label><div style=\"display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap\"><input id=\"f-video\" name=\"video\" type=\"url\" value=\"' + esc(e.video || '') + '\" placeholder=\"https://youtu.be/… ou https://vimeo.com/…\" style=\"flex:1;min-width:220px\"><div id=\"apercuVideo\"></div></div><p class=\"aide\">Elle s\\'affiche dans la fiche, sous « En vidéo », avant les vidéos déjà connues du site.</p></div>' +\n    '<p class=\"aide\">« Ajouter » prend un visuel sur l\\'ordinateur ou le téléphone et le cadre ; vous pouvez aussi <button type=\"button\" class=\"btn petit\" id=\"urlPhoto\">coller une adresse</button>. Les visuels déjà dans l\\'appli sont juste en dessous.</p>' +\n    '<div class=\"galerie\" id=\"galerie\"></div></div>' +\n    '<div class=\"large\"><h3 class=\"section\">Textes</h3></div>' +\n    champTexte('description', 'Accroche (programme, accueil, haut de la fiche)', e.description, 'Une à trois phrases. Si vide, le site garde le texte déjà écrit dans ses fiches.') +\n    champTexte('long', 'Texte long (fiche, derrière « Lire la suite »)', e.long, 'Mettez en forme avec la barre au-dessus (gras, italique, sous-titre, citation, liste) : le site affiche le texte tel quel.') +\n    champTexte('distribution', 'Distribution et crédits (bas de la fiche)', e.distribution, 'Ex. : De et avec … Mise en scène : … Photos : …') +\n    '</div>' + (peutModifier ? '<div class=\"actions\"><button class=\"btn plein\" type=\"submit\">Enregistrer</button>' +\n    (nouveau ? '' : '<button class=\"btn\" type=\"button\" id=\"dupliquer\">Dupliquer (autre date)</button><button class=\"btn danger\" type=\"button\" id=\"supprimer\">Supprimer</button>') +\n    '</div>' : '<p class=\"aide\">Votre compte peut consulter cet événement, pas le modifier.</p>') + '</form>';\n\n  var actives = [];\n  if (!nouveau) {\n    var resas = D.reservations.filter(function (r) { return r.evenement === e.id; });\n    actives = resas.filter(function (r) { return r.statut !== 'Annulée' && r.statut !== 'Liste d\\'attente'; });\n    var enAttente = resas.filter(function (r) { return r.statut === 'Liste d\\'attente'; });\n    var total = actives.reduce(function (s, r) { return s + r.places; }, 0);\n    var arrivees = actives.filter(function (r) { return r.arrivee; }).reduce(function (s, r) { return s + r.places; }, 0);\n    h += '<h2>Réservations · ' + total + (Number(e.places) ? ' / ' + e.places : '') + ' places' + (arrivees ? ' · ' + arrivees + ' arrivée' + (arrivees > 1 ? 's' : '') : '') + (enAttente.length ? ' · ' + enAttente.length + ' en liste d\\'attente' : '') + '</h2><div class=\"panneau\">';\n    if (!peutResa) h += '<p class=\"aide\">' + total + ' place' + (total > 1 ? 's' : '') + ' réservée' + (total > 1 ? 's' : '') + '. Votre compte ne voit pas le détail des réservations.</p></div>';\n    else if (!resas.length) h += '<p class=\"vide\">Pas encore de réservation.</p>';\n    else h += '<div class=\"tableau\"><table><tr><th>Arrivé·e</th><th>Nom</th><th>Places</th><th>Contact</th><th>Message</th><th>Reçue</th><th></th></tr>' +\n      resas.map(function (r) {\n        var att = r.statut === 'Liste d\\'attente', ann = r.statut === 'Annulée';\n        return '<tr class=\"' + (ann ? 'annulee' : (r.arrivee ? 'arrivee' : '')) + (att ? ' attente' : '') + '\"><td>' + (ann || att ? (att ? '<span class=\"badge\">Liste d\\'attente</span>' : '') : '<input type=\"checkbox\" class=\"arrivee\" data-pointer=\"' + esc(r.id) + '\"' + (r.arrivee ? ' checked' : '') + ' aria-label=\"Arrivé·e\">') + '</td><td>' + esc(r.nom) + '</td><td>' + r.places + '</td><td>' +\n          (r.email ? '<a style=\"color:var(--lav2)\" href=\"mailto:' + esc(r.email) + '\">' + esc(r.email) + '</a>' : '') + (r.telephone ? '<br>' + esc(r.telephone) : '') +\n          '</td><td>' + esc(r.message) + '</td><td>' + esc(r.recue) + '</td><td>' +\n          (ann ? 'Annulée' : (att ? '<button class=\"btn petit plein\" data-confirmer=\"' + esc(r.id) + '\">Confirmer</button> ' : '') + '<button class=\"btn petit danger\" data-annuler=\"' + esc(r.id) + '\">Annuler</button>') + '</td></tr>';\n      }).join('') + '</table></div>';\n    if (peutResa) h += '<div class=\"actions\">' + (actives.length ? '<button class=\"btn\" id=\"copier\">Copier les e-mails</button>' : '') + '</div>';\n    if (peutResa) h += '<h2>Ajouter une réservation à la main</h2><form id=\"ajout\"><div class=\"grille\">' +\n      (champ('nom', 'Nom', '', 'text', 'required') + champ('email', 'E-mail', '', 'email') + champ('telephone', 'Téléphone', '') +\n      champ('places', 'Places', '1', 'number', 'min=\"1\"')).replace(/(id|for)=\"f-/g, '$1=\"a-') +\n      '<div><label><input type=\"checkbox\" name=\"envoyerMail\" style=\"width:auto\"> envoyer l\\'e-mail de confirmation</label></div>' +\n      '</div><div class=\"actions\"><button class=\"btn plein\" type=\"submit\">Ajouter</button></div></form></div>';\n  }\n  h += '</div>'; // .colonne\n  if (siteUrl()) h += '<aside class=\"voletApercu\" id=\"voletApercu\" hidden>' + apercuSite(e, nouveau) + '</aside>';\n  h += '</div>'; // .editeur\n  $('#vue').innerHTML = h;\n  $('#retour').onclick = function () { function partir() { MODIFIE = false; ouvert = null; afficher(); } if (MODIFIE) confirmer('Des modifications ne sont pas enregistrées. Quitter quand même ?', partir, { oui: 'Quitter sans enregistrer', non: 'Rester' }); else partir(); };\n  function apercuVideo() { var u = $('#f-video').value.trim(), m = /(?:youtu\\.be\\/|v=|\\/shorts\\/|\\/embed\\/)([\\w-]{11})/.exec(u), z = $('#apercuVideo'); if (!z) return; z.innerHTML = m ? '<img src=\"https://i.ytimg.com/vi/' + m[1] + '/mqdefault.jpg\" alt=\"\" style=\"width:120px;border-radius:8px\">' : (/vimeo\\.com\\/\\d+/.test(u) ? '<span class=\"aide\">Vimeo ✓</span>' : (u ? '<span class=\"aide alerte\">Lien non reconnu (YouTube ou Vimeo attendu)</span>' : '')); }\n  $('#f-video').addEventListener('input', apercuVideo); apercuVideo();\n  if (peutModifier) { photosInit(); miseEnFormeInit(); }\n  else { $('#form').querySelectorAll('input,select,textarea').forEach(function (x) { x.disabled = true; }); photosAfficher(true); $('#galerie').remove(); document.querySelectorAll('.barreTexte').forEach(function (b) { b.remove(); }); document.querySelectorAll('.editeurTexte').forEach(function (x) { x.contentEditable = 'false'; }); }\n  apercuInit(e, nouveau);\n  document.querySelectorAll('[data-pointer]').forEach(function (c) { c.onchange = function () { appel('adminPointer', [c.dataset.pointer, c.checked], function (res) { recharger(res); }); }; });\n  // Fin ↔ durée, et suivi des modifications\n  var fDebut = $('#f-debut'), fFin = $('#f-fin'), fDuree = $('#f-duree'), finAuto = !e.fin, dureeAuto = !e.duree;\n  function majFin() { var m = minutesDe(fDuree.value); if (fDebut.value && m && (finAuto || !fFin.value)) { fFin.value = heurePlus(fDebut.value, m); finAuto = true; } }\n  function majDuree() { var m = ecartMinutes(fDebut.value, fFin.value); if (fDebut.value && fFin.value && m && (dureeAuto || !fDuree.value)) { fDuree.value = texteDuree(m); dureeAuto = true; } }\n  fDuree.addEventListener('input', function () { dureeAuto = !fDuree.value; majFin(); });\n  fFin.addEventListener('input', function () { finAuto = !fFin.value; majDuree(); });\n  fDebut.addEventListener('input', function () { if (finAuto || !fFin.value) majFin(); else majDuree(); });\n  $('#form').addEventListener('input', function () { MODIFIE = true; envoyerBrouillon(e, nouveau); });\n  $('#form').addEventListener('change', function () { MODIFIE = true; envoyerBrouillon(e, nouveau); });\n  if (!peutModifier) return;\n  $('#form').onsubmit = function (ev) {\n    ev.preventDefault();\n    var o = { id: nouveau ? '' : e.id, attente: '' };\n    new FormData(ev.target).forEach(function (v, k) { o[k] = v; });\n    if (!o.titre || !o.date) { toast(!o.titre ? 'Donnez un titre à l\\'événement.' : 'Donnez une date à l\\'événement : sans date, il n\\'apparaît nulle part.', true); (!o.titre ? $('#f-titre') : $('#f-date')).focus(); return; }\n    var boutons = [$('#enregistrerHaut'), $('#form button[type=submit]')].filter(Boolean);\n    boutons.forEach(function (b) { b.disabled = true; b.dataset.texte = b.textContent; b.textContent = 'Enregistrement…'; });\n    appel('adminEnregistrerEvenement', [o], function (res) {\n      MODIFIE = false; var etaitNouveau = nouveau, y = scrollY;\n      recharger(res);\n      if (etaitNouveau) { var cree = res.evenements.filter(function (x) { return x.titre === o.titre && x.date === o.date && x.debut === o.debut; }).pop(); ouvert = cree ? cree.id : null; afficher(); }\n      else { afficher(); scrollTo(0, y); }\n      [$('#enregistrerHaut'), $('#form button[type=submit]')].forEach(function (b) { if (!b) return; var t = b.textContent; b.textContent = 'Enregistré ✓'; b.classList.add('ok'); setTimeout(function () { b.textContent = t; b.classList.remove('ok'); }, 2500); });\n      toast('Enregistré ✓ ' + (o.statut === 'Ouvert' || o.statut === 'Fermé' ? 'Le site est à jour.' : 'Statut « ' + o.statut + ' » : pas encore visible sur le site.'));\n    });\n  };\n  if (nouveau) return;\n  if (!peutResa && $('#ajout')) $('#ajout').remove();\n  $('#dupliquer').onclick = function () {\n    var c = {}; Object.keys(e).forEach(function (k) { c[k] = e[k]; }); c.id = ''; c.date = '';\n    afficherEvenement.copie = c; ouvert = 'copie'; afficher(); toast('Copie : choisissez la nouvelle date');\n  };\n  $('#supprimer').onclick = function () {\n    confirmer('Supprimer « ' + e.titre + ' » ? Les réservations liées restent dans la feuille.', function () {\n      appel('adminSupprimerEvenement', [e.id], function (res) { ouvert = null; MODIFIE = false; recharger(res); toast('Supprimé'); });\n    }, { oui: 'Supprimer', danger: true });\n  };\n  document.querySelectorAll('[data-annuler]').forEach(function (b) {\n    b.onclick = function () {\n      function faire(prevenir) { appel('adminAnnulerReservation', [b.dataset.annuler, prevenir], function (res) { recharger(res); toast('Réservation annulée'); }); }\n      dialogue({ titre: 'Annuler cette réservation ?', texte: 'La personne peut être prévenue par e-mail.', oui: 'Annuler et prévenir', non: 'Annuler sans e-mail', ok: function () { faire(true); }, annuler: function () { confirmer('Annuler la réservation sans prévenir la personne ?', function () { faire(false); }, { oui: 'Oui, annuler', non: 'Ne rien faire' }); } });\n    };\n  });\n  document.querySelectorAll('[data-confirmer]').forEach(function (b) {\n    b.onclick = function () {\n      confirmer('Passer cette inscription de la liste d\\'attente à « Confirmée » et envoyer l\\'e-mail de confirmation ?', function () {\n        appel('adminConfirmerReservation', [b.dataset.confirmer, true], function (res) { recharger(res); toast('Réservation confirmée'); });\n      }, { titre: 'Confirmer la réservation', oui: 'Confirmer et envoyer' });\n    };\n  });\n  var cp = $('#copier');\n  if (cp) cp.onclick = function () {\n    var mails = actives.map(function (r) { return r.email; }).filter(Boolean).join(', ');\n    (navigator.clipboard ? navigator.clipboard.writeText(mails) : Promise.reject()).then(function () { toast('E-mails copiés'); }, function () { demander('Copiez ces adresses :', function () {}, { defaut: mails, oui: 'Fermer', vide: true }); });\n  };\n  if ($('#ajout')) $('#ajout').onsubmit = function (ev) {\n    ev.preventDefault();\n    var o = { evenement: e.id };\n    new FormData(ev.target).forEach(function (v, k) { o[k] = v; });\n    o.envoyerMail = !!o.envoyerMail;\n    appel('adminAjouterReservation', [o], function (res) { recharger(res); toast('Réservation ajoutée'); });\n  };\n}\n\nfunction pucesVariables(pour) {\n  return '<div class=\"puces\" data-pour=\"' + pour + '\"><span>Insérer :</span>' + MAIL.VARIABLES.map(function (v) { return '<button type=\"button\" data-var=\"' + v[0] + '\" title=\"' + esc(v[1]) + '\">' + v[0] + '</button>'; }).join('') + '</div>';\n}\nfunction dateLongueFr(iso) { if (!iso) return ''; var p = iso.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); return ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][d.getUTCDay()] + ' ' + Number(p[2]) + ' ' + ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][+p[1] - 1] + ' ' + p[0]; }\nfunction afficherReglages() {\n  var r = D.reglages, h = '';\n  if (droit('reglages')) h += '<h2>Réglages</h2><form id=\"regl\" class=\"panneau\"><div class=\"grille\">' +\n    champ('nomFestival', 'Nom du festival (signature des e-mails)', r.nomFestival) +\n    champ('siteUrl', 'Adresse du site (pour les aperçus)', r.siteUrl, 'url') +\n    champ('copieA', 'Adresse qui reçoit une copie de chaque réservation', r.copieA, 'email') + '</div>' +\n    '<h3 class=\"section\">E-mails envoyés au public</h3><p class=\"aide\">Trois e-mails automatiques, un pied de page commun et un billet dans la confirmation. Cliquez une variable pour l\\'insérer là où est le curseur ; l\\'aperçu à droite se met à jour en direct avec des données d\\'exemple.</p>' +\n    '<div class=\"ongletsMail\" id=\"ongletsMail\">' + Object.keys(MAIL.TYPES).map(function (k, i) { return '<button type=\"button\" data-type=\"' + k + '\"' + (i ? '' : ' class=\"on\"') + '>' + MAIL.TYPES[k].nom + '</button>'; }).join('') + '<button type=\"button\" data-type=\"pied\">Pied de page</button><button type=\"button\" data-type=\"billet\">Billet</button></div>' +\n    '<div class=\"editeurMail\"><div id=\"volMail\">' +\n    Object.keys(MAIL.TYPES).map(function (k) { var t = MAIL.TYPES[k]; return '<div data-panneau=\"' + k + '\"' + (k === 'confirmation' ? '' : ' hidden') + '>' + champ(t.sujet, 'Sujet', r[t.sujet] || '') + '<div class=\"large\" style=\"margin-top:10px\"><label for=\"f-' + t.message + '\">Message</label>' + pucesVariables('f-' + t.message) + '<textarea id=\"f-' + t.message + '\" name=\"' + t.message + '\">' + esc(r[t.message] || '') + '</textarea></div>' +\n      (k === 'confirmation' ? '<p class=\"aide\">Envoyé à la réservation, quand vous confirmez une inscription en liste d\\'attente, et à une réservation ajoutée à la main si la case est cochée.</p>' : k === 'annulation' ? '<p class=\"aide\">Envoyé quand vous annulez une réservation en choisissant « prévenir ».</p>' : '<p class=\"aide\">Envoyé quand quelqu\\'un s\\'inscrit sur la liste d\\'attente d\\'un événement complet.</p>') + '</div>'; }).join('') +\n    '<div data-panneau=\"pied\" hidden><div class=\"large\"><label for=\"f-piedDePage\">Pied de page (sous chaque e-mail)</label>' + pucesVariables('f-piedDePage') + '<textarea id=\"f-piedDePage\" name=\"piedDePage\">' + esc(r.piedDePage || '') + '</textarea></div><p class=\"aide\">Signature, adresse, lien du site… Laissez vide pour aucun pied de page.</p></div>' +\n    '<div data-panneau=\"billet\" hidden><label class=\"coche\"><input type=\"checkbox\" name=\"billet\" value=\"Oui\"' + (String(r.billet || '') === 'Oui' ? ' checked' : '') + '> Joindre un billet récapitulatif dans l\\'e-mail de confirmation</label><p class=\"aide\">Un encadré aux couleurs du site : spectacle, date, heure, lieu, nom, places, numéro de réservation. Les gens le montrent sur leur téléphone à l\\'entrée. Il reprend automatiquement vos textes et le tarif de l\\'événement.</p></div>' +\n    '</div><div class=\"apercuMail\" id=\"apercuMail\"></div></div>' +\n    '<p class=\"aide\" style=\"margin-top:12px\">Le texte accepte **gras** et *italique* ; les adresses https:// deviennent des liens. Variables : ' + MAIL.VARIABLES.map(function (v) { return '{' + v[0] + '}'; }).join(' ') + '</p>' +\n    '<div class=\"actions\"><button class=\"btn plein\" type=\"submit\">Enregistrer</button><button class=\"btn\" type=\"button\" id=\"essai\">M\\'envoyer cet e-mail en essai</button></div></form>';\n  if (droit('comptes')) h += '<h2 id=\"comptes\">Comptes et codes PIN</h2><div class=\"panneau\" id=\"zoneComptes\"><p class=\"vide\">Chargement…</p></div>' +\n    '<h2>Appareils connectés</h2><div class=\"panneau\" id=\"zoneAppareils\"><p class=\"vide\">Chargement…</p></div>';\n  $('#vue').innerHTML = h;\n  if ($('#regl')) {\n    $('#regl').onsubmit = function (ev) {\n      ev.preventDefault();\n      var o = {}; new FormData(ev.target).forEach(function (v, k) { o[k] = v; }); if (!o.billet) o.billet = '';\n      appel('adminEnregistrerReglages', [o], function (res) { recharger(res); toast('Réglages enregistrés ✓'); });\n    };\n    var typeMail = 'confirmation', typeVu = 'confirmation';\n    function brouillonReglages() { var o = {}; new FormData($('#regl')).forEach(function (v, k) { o[k] = v; }); if (!o.billet) o.billet = ''; return o; }\n    function rendreMail() {\n      var o = brouillonReglages(), t = typeVu === 'pied' || typeVu === 'billet' ? 'confirmation' : typeVu, v = MAIL.exemple();\n      var ev = (D.evenements || []).filter(function (e) { return e.statut === 'Ouvert' || e.statut === 'Fermé'; })[0];\n      if (ev) { v.titre = ev.titre; v.date = dateLongueFr(ev.date); v.heure = ev.debut || ''; v.lieu = [ev.lieu, ev.adresse].filter(Boolean).join(', '); v.adresse = ev.adresse || ''; v.tarif = ev.tarif || ''; }\n      v.festival = o.nomFestival || v.festival; v.site = String(o.siteUrl || '').replace(/\\/apercu\\/?$/, '').replace(/\\/$/, '') || v.site;\n      if (typeVu === 'billet') o.billet = 'Oui';\n      var m = MAIL.composer(t, o, v);\n      $('#apercuMail').innerHTML = '<div class=\"entete\"><b>De :</b> ' + esc(o.nomFestival || '') + ' &lt;réservations&gt;<br><b>À :</b> ' + esc(v.email) + '<br><b>Objet :</b> <b>' + esc(m.sujet) + '</b></div><div class=\"corps\">' + m.html + '</div>';\n    }\n    function pucesInit() {\n      document.querySelectorAll('.puces button').forEach(function (b) {\n        b.onmousedown = function (ev) { ev.preventDefault(); };\n        b.onclick = function () {\n          var ta = $('#' + b.parentNode.dataset.pour), v = '{' + b.dataset.var + '}', d = ta.selectionStart || 0, f = ta.selectionEnd || 0;\n          ta.value = ta.value.slice(0, d) + v + ta.value.slice(f); ta.selectionStart = ta.selectionEnd = d + v.length; ta.focus(); rendreMail();\n        };\n      });\n    }\n    document.querySelectorAll('#ongletsMail button').forEach(function (b) {\n      b.onclick = function () {\n        typeVu = b.dataset.type; typeMail = MAIL.TYPES[typeVu] ? typeVu : 'confirmation';\n        document.querySelectorAll('#ongletsMail button').forEach(function (x) { x.classList.toggle('on', x === b); });\n        document.querySelectorAll('#volMail [data-panneau]').forEach(function (p) { p.hidden = p.dataset.panneau !== typeVu; });\n        rendreMail();\n      };\n    });\n    $('#regl').addEventListener('input', rendreMail); $('#regl').addEventListener('change', rendreMail);\n    pucesInit(); rendreMail();\n    $('#essai').onclick = function () { $('#essai').disabled = true; appel('adminEssaiMail', [typeMail, brouillonReglages()], function (t) { $('#essai').disabled = false; toast(t); }); };\n  }\n  if ($('#zoneComptes')) appel('adminListerComptes', [], function (r) { comptesAfficher(r); appel('adminListerAppareils', [], appareilsAfficher); });\n}\nfunction appareilsAfficher(l) {\n  var z = $('#zoneAppareils'); if (!z) return;\n  if (!l.length) { z.innerHTML = '<p class=\"vide\">Aucun appareil pour l\\'instant (le lien personnel n\\'en crée pas).</p>'; return; }\n  z.innerHTML = '<p class=\"aide\">Chaque appareil qui a donné un code PIN reste connecté (sans redemander le code) jusqu\\'à ce qu\\'on le déconnecte ici, ou après six mois sans utilisation.</p><div class=\"tableau\"><table><tr><th>Compte</th><th>Appareil</th><th>Première fois</th><th>Dernière fois</th><th></th></tr>' +\n    l.map(function (a) { return '<tr><td>' + esc(a.compte) + '</td><td>' + esc(a.nom) + (COMPTE && a.id === COMPTE.appareil ? ' <span class=\"badge Ouvert\">celui-ci</span>' : '') + '</td><td>' + esc(a.cree) + '</td><td>' + esc(a.dernier) + '</td><td><button type=\"button\" class=\"btn petit danger\" data-deco=\"' + esc(a.id) + '\">Déconnecter</button></td></tr>'; }).join('') + '</table></div>';\n  z.querySelectorAll('[data-deco]').forEach(function (b) { b.onclick = function () {\n    confirmer('Déconnecter cet appareil ? Il devra redonner un code PIN.', function () {\n      appel('adminDeconnecterAppareil', [b.dataset.deco], function (r) { appareilsAfficher(r); toast('Appareil déconnecté'); if (COMPTE && b.dataset.deco === COMPTE.appareil) deconnexion(); });\n    }, { oui: 'Déconnecter' });\n  }; });\n}\n\n// ---------- Comptes : un code PIN par personne, avec ses droits ----------\nfunction comptesAfficher(res) {\n  var z = $('#zoneComptes'); if (!z) return;\n  var lien = res.lien || location.href.split('?')[0].replace(/gestion\\.html$/, '');\n  var h = '<p class=\"aide\">Chaque personne reçoit le lien de l\\'appli et son code PIN ; l\\'appli s\\'ouvre avec le code, puis se met sur l\\'écran d\\'accueil du téléphone. Commencez par votre propre compte, avec tous les droits.</p>';\n  if (!res.comptes.length) h += '<p class=\"vide\">Aucun compte pour l\\'instant.</p>';\n  res.comptes.forEach(function (c) {\n    var dr = res.droits.filter(function (d) { return c.droits && c.droits[d[0]]; }).map(function (d) { return d[1].split(' :')[0]; });\n    h += '<div class=\"compte\"><div class=\"qui\"><b>' + esc(c.nom) + '</b><p>' + (dr.length === res.droits.length ? 'Tous les droits' : (dr.join(', ') || 'Aucun droit')) + '</p></div>' +\n      '<div class=\"actions\"><button type=\"button\" class=\"btn petit plein\" data-partager=\"' + esc(c.id) + '\">Partager l\\'appli</button><button type=\"button\" class=\"btn petit\" data-modifier=\"' + esc(c.id) + '\">Modifier</button><button type=\"button\" class=\"btn petit danger\" data-supprimer=\"' + esc(c.id) + '\">Supprimer</button></div></div>';\n  });\n  h += '<div class=\"actions\"><button type=\"button\" class=\"btn plein\" id=\"nouveauCompte\">+ Nouveau compte</button></div><div id=\"formCompte\"></div>';\n  z.innerHTML = h;\n  function formulaire(c) {\n    c = c || { nom: '', droits: {} };\n    $('#formCompte').innerHTML = '<form id=\"fCompte\" class=\"panneau\"><h3 style=\"margin:0 0 10px\">' + (c.id ? 'Modifier « ' + esc(c.nom) + ' »' : 'Nouveau compte') + '</h3><div class=\"grille\">' +\n      champ('c-nom', 'Prénom ou nom', c.nom, 'text', 'required placeholder=\"Ex. Léa (billetterie)\"').replace(/f-c-nom/g, 'c-nom') +\n      '<div><label for=\"c-pin\">Code PIN (4 à 8 chiffres' + (c.id ? ', vide = inchangé' : '') + ')</label><div style=\"display:flex;gap:6px\"><input id=\"c-pin\" name=\"pin\" inputmode=\"numeric\" pattern=\"[0-9]{4,8}\" maxlength=\"8\" autocomplete=\"off\"' + (c.id ? '' : ' required') + '><button type=\"button\" class=\"btn petit\" id=\"proposerPin\">Proposer</button></div></div>' +\n      '</div><div class=\"coches\" style=\"margin-top:10px\">' + res.droits.map(function (d) { return '<label><input type=\"checkbox\" name=\"d-' + d[0] + '\"' + (c.droits && c.droits[d[0]] ? ' checked' : '') + '> <span><b>' + esc(d[1].split(' :')[0]) + '</b> :' + esc(d[1].split(' :').slice(1).join(' :')) + '</span></label>'; }).join('') + '</div>' +\n      '<div class=\"actions\"><button class=\"btn plein\" type=\"submit\">' + (c.id ? 'Enregistrer' : 'Créer le compte') + '</button><button class=\"btn\" type=\"button\" id=\"annulerCompte\">Annuler</button></div></form>';\n    $('#proposerPin').onclick = function () { var p = ''; for (var i = 0; i < 6; i++) p += Math.floor(Math.random() * 10); $('#c-pin').value = p; $('#c-pin').type = 'text'; };\n    $('#annulerCompte').onclick = function () { $('#formCompte').innerHTML = ''; };\n    $('#fCompte').onsubmit = function (ev) {\n      ev.preventDefault();\n      var o = { id: c.id || '', nom: $('#c-nom').value, pin: $('#c-pin').value.trim(), droits: {} };\n      res.droits.forEach(function (d) { o.droits[d[0]] = $('#fCompte [name=\"d-' + d[0] + '\"]').checked; });\n      appel('adminEnregistrerCompte', [o], function (r2) {\n        comptesAfficher(r2); toast(c.id ? 'Compte modifié' : 'Compte créé');\n        if (o.pin) { var nc = r2.comptes.filter(function (x) { return x.nom === o.nom; }).pop(); if (nc) partager(nc, o.pin, lien); }\n      });\n    };\n    $('#formCompte').scrollIntoView({ behavior: 'smooth', block: 'nearest' });\n  }\n  $('#nouveauCompte').onclick = function () { formulaire(); };\n  z.querySelectorAll('[data-modifier]').forEach(function (b) { b.onclick = function () { formulaire(res.comptes.filter(function (x) { return x.id === b.dataset.modifier; })[0]); }; });\n  z.querySelectorAll('[data-supprimer]').forEach(function (b) { b.onclick = function () {\n    var c = res.comptes.filter(function (x) { return x.id === b.dataset.supprimer; })[0];\n    confirmer('Supprimer le compte de « ' + c.nom + ' » ? Son code PIN ne marchera plus.', function () {\n      appel('adminSupprimerCompte', [c.id], function (r2) { comptesAfficher(r2); toast('Compte supprimé'); });\n    }, { oui: 'Supprimer', danger: true });\n  }; });\n  z.querySelectorAll('[data-partager]').forEach(function (b) { b.onclick = function () {\n    var c = res.comptes.filter(function (x) { return x.id === b.dataset.partager; })[0];\n    demander('Le code PIN de ' + c.nom + ' n\\'est pas gardé en clair : tapez-le pour l\\'inclure dans le message, ou laissez vide pour envoyer seulement le lien.', function (pin) { partager(c, pin, lien); }, { titre: 'Partager l\\'appli', vide: true, oui: 'Continuer', placeholder: 'Code PIN (facultatif)' });\n  }; });\n}\nfunction partager(c, pin, lien) {\n  var texte = 'Bonjour ' + c.nom + ' ! Voici l\\'appli « ' + (D.reglages.nomFestival || 'Festival') + ' » : ' + lien + (pin ? '\\nTon code PIN : ' + pin : '') +\n    '\\nOuvre le lien, entre le code, puis ajoute l\\'appli à l\\'écran d\\'accueil (Safari : Partager → « Sur l\\'écran d\\'accueil » ; Android : menu ⋮ → « Ajouter à l\\'écran d\\'accueil »).';\n  var h = '<div class=\"panneau\" id=\"boitePartage\"><h3 style=\"margin:0 0 8px\">Envoyer à ' + esc(c.nom) + '</h3><textarea readonly style=\"min-height:130px\" id=\"textePartage\">' + esc(texte) + '</textarea><div class=\"actions\">' +\n    (navigator.share ? '<button type=\"button\" class=\"btn plein\" id=\"partagerNatif\">Partager…</button>' : '') +\n    '<a class=\"btn\" target=\"_blank\" rel=\"noopener\" href=\"https://wa.me/?text=' + encodeURIComponent(texte) + '\">WhatsApp</a>' +\n    '<a class=\"btn\" href=\"mailto:?subject=' + encodeURIComponent('Appli « ' + (D.reglages.nomFestival || 'Festival') + ' »') + '&body=' + encodeURIComponent(texte) + '\">E-mail</a>' +\n    '<button type=\"button\" class=\"btn\" id=\"copierPartage\">Copier</button><button type=\"button\" class=\"btn\" id=\"fermerPartage\">Fermer</button></div>' +\n    '<p class=\"aide\">Le code PIN ne s\\'affiche qu\\'ici : notez-le ou envoyez-le tout de suite.</p></div>';\n  $('#formCompte').innerHTML = h; $('#boitePartage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });\n  if ($('#partagerNatif')) $('#partagerNatif').onclick = function () { navigator.share({ text: texte }).catch(function () {}); };\n  $('#copierPartage').onclick = function () { var t = $('#textePartage'); t.select(); try { navigator.clipboard.writeText(texte); } catch (e) { document.execCommand('copy'); } toast('Copié'); };\n  $('#fermerPartage').onclick = function () { $('#formCompte').innerHTML = ''; };\n}\n\n// ---------- Visuels d'un événement : principal + galerie, ordre, recadrage ----------\nfunction listePhotos() { return $('#f-image').value.split(/\\s*[\\n,]\\s*/).filter(Boolean); }\nfunction ecrirePhotos(l) { $('#f-image').value = l.join('\\n'); MODIFIE = true; photosAfficher(); galerieAfficher(); $('#f-image').dispatchEvent(new Event('input', { bubbles: true })); }\nfunction photosAfficher(lectureSeule) {\n  var l = listePhotos(), zp = $('#photoPrincipale'), zg = $('#photos');\n  function carte(u, i) {\n    if (lectureSeule) return '<div class=\"photo\"><img src=\"' + esc(u) + '\" alt=\"\"></div>';\n    return '<div class=\"photo' + (i ? '' : ' principale') + '\"><img src=\"' + esc(u) + '\" alt=\"\" loading=\"lazy\">' + (i ? '<span class=\"num\">' + i + '</span>' : '') + '<div class=\"outils\">' +\n      (i ? '<button type=\"button\" data-bouger=\"' + i + ',-1\" title=\"Avancer\"' + (i > 1 ? '' : ' disabled') + '>←</button><button type=\"button\" data-bouger=\"' + i + ',1\" title=\"Reculer\"' + (i < l.length - 1 ? '' : ' disabled') + '>→</button><button type=\"button\" data-premiere=\"' + i + '\" title=\"En faire le visuel principal\">★</button>' : '') +\n      '<button type=\"button\" data-recadrer=\"' + esc(u) + '\" data-index=\"' + i + '\">Recadrer</button>' +\n      '<button type=\"button\" data-retirer=\"' + i + '\">Retirer</button></div></div>';\n  }\n  zp.innerHTML = l.length ? carte(l[0], 0) : (lectureSeule ? '<p class=\"aide\">Pas de visuel.</p>' : '<button type=\"button\" class=\"ajout\" id=\"ajoutPrincipale\">+ Ajouter</button>');\n  zg.innerHTML = l.slice(1).map(function (u, i) { return carte(u, i + 1); }).join('') + (lectureSeule ? '' : '<button type=\"button\" class=\"ajout\" id=\"ajoutPhoto\">+ Ajouter</button>');\n  if (!lectureSeule && ENVOIS) vignetteEnvoi();\n  if (lectureSeule) return;\n  var z = $('#form');\n  z.querySelectorAll('[data-retirer]').forEach(function (b) { b.onclick = function () { var l = listePhotos(); l.splice(+b.dataset.retirer, 1); ecrirePhotos(l); }; });\n  z.querySelectorAll('[data-premiere]').forEach(function (b) { b.onclick = function () { var l = listePhotos(); l.unshift(l.splice(+b.dataset.premiere, 1)[0]); ecrirePhotos(l); }; });\n  z.querySelectorAll('[data-bouger]').forEach(function (b) { b.onclick = function () {\n    var a = b.dataset.bouger.split(','), i = +a[0], j = i + (+a[1]), l = listePhotos(); if (j < 1 || j >= l.length) return;\n    var x = l[i]; l[i] = l[j]; l[j] = x; ecrirePhotos(l);\n  }; });\n  z.querySelectorAll('[data-recadrer]').forEach(function (b) { b.onclick = function () {\n    var i = +b.dataset.index;\n    recadrerUrl(b.dataset.recadrer, ($('#f-titre').value || 'photo'), function (url) { var l = listePhotos(); l[i] = url; ecrirePhotos(l); toast('Visuel recadré : pensez à enregistrer'); });\n  }; });\n  ['#ajoutPhoto', '#ajoutPrincipale'].forEach(function (s) { if ($(s)) $(s).onclick = function () { $('#fichierPhoto').value = ''; $('#fichierPhoto').click(); }; });\n}\n\n// ---------- Visuels : tous (fichiers du site + dossier Drive), classés par spectacle ----------\nvar PHOTOS_DRIVE = null, INFOS_VISUELS = {};\nfunction chargerSite(ok) {\n  if (window.SPECTACLES || !siteUrl()) return ok();\n  var sc = document.createElement('script'); sc.src = siteUrl() + 'festival.js?' + Date.now(); sc.onload = ok; sc.onerror = function () { ok(); }; document.head.appendChild(sc);\n}\nfunction chargerDrive(ok, force) {\n  if (PHOTOS_DRIVE && !force) return ok();\n  appel('adminListerPhotos', [], function (r) { PHOTOS_DRIVE = Array.isArray(r) ? r : (r && r.photos) || []; INFOS_VISUELS = (r && !Array.isArray(r) && r.infos) || {}; ok(); });\n}\nfunction normTitre(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }\nvar TITRES_SUPP = [];\nfunction titresConnus() { var l = titresConnusBase(); TITRES_SUPP.forEach(function (t) { if (!l.some(function (x) { return normTitre(x) === normTitre(t); })) l.push(t); }); return l; }\nfunction titresConnusBase() {\n  var l = Object.keys(window.SPECTACLES || {}); (D.spectacles || []).forEach(function (s) { if (!l.some(function (k) { return normTitre(k) === normTitre(s); })) l.push(s); });\n  D.evenements.forEach(function (e) { var s = e.spectacle || e.titre; if (s && !l.some(function (k) { return normTitre(k) === normTitre(s); })) l.push(s); });\n  return l.sort(function (a, b) { return a.localeCompare(b, 'fr'); });\n}\nfunction titreDe(nom) { // « Titre · 3 » ou « Titre 3 » → titre connu\n  var n = normTitre(String(nom).split(' · ')[0]), l = titresConnus().slice().sort(function (a, b) { return b.length - a.length; });\n  for (var i = 0; i < l.length; i++) { var k = normTitre(l[i]); if (n === k || n.indexOf(k + ' ') === 0) return l[i]; }\n  return '';\n}\nfunction idDrive(u) { var m = /drive\\.google\\.com\\/(?:thumbnail\\?id=|uc\\?id=|file\\/d\\/)([\\w-]+)/.exec(u || ''); return m ? m[1] : ''; }\nfunction cleVisuel(p) { return p.origine === 'drive' ? p.id : p.url.split('/').pop(); }\n// Tous les visuels connus : { cle, titre, url, credit, legende, origine: 'site'|'drive', id, surSite }\nfunction toutesPhotos() {\n  var l = [], SP = window.SPECTACLES || {}, utilisees = {};\n  D.evenements.forEach(function (e) { String(e.image || '').split(/\\s*[\\n,]\\s*/).forEach(function (u) { if (u) utilisees[u.split('/').pop()] = true; }); });\n  function infos(p) { var v = INFOS_VISUELS[cleVisuel(p)]; if (v) { if (v.spectacle) p.titre = v.spectacle; if (v.credit) p.credit = v.credit; p.legende = v.legende || ''; } return p; }\n  Object.keys(SP).forEach(function (k) {\n    var s = SP[k], aff = (s.photos || (s.photo ? [{ src: s.photo, credit: s.credit }] : []));\n    aff.forEach(function (p) { l.push(infos({ titre: k, url: siteUrl() + p.src, credit: p.credit || '', origine: 'site', surSite: true })); });\n    (s.banque || []).forEach(function (p) { l.push(infos({ titre: k, url: siteUrl() + p.src, credit: p.credit || '', origine: 'site', surSite: false })); });\n  });\n  (PHOTOS_DRIVE || []).forEach(function (f) { l.push(infos({ titre: f.spectacle || titreDe(f.nom), nom: f.nom, url: f.url, credit: f.credit || '', legende: f.legende || '', origine: 'drive', id: f.id, surSite: !!utilisees[f.url.split('/').pop()] })); });\n  return l;\n}\nfunction cartePhoto(p, boutons) {\n  return '<div class=\"photo\" title=\"' + esc([p.legende, p.credit].filter(Boolean).join(' · ') || p.nom || '') + '\"><img src=\"' + esc(p.url) + '\" alt=\"\" loading=\"lazy\">' +\n    (p.surSite ? '<span class=\"etiquette\">Sur le site</span>' : '') + (p.legende ? '<span class=\"legende\">' + esc(p.legende) + '</span>' : '') +\n    '<div class=\"outils\">' + boutons + '</div></div>';\n}\nfunction galerieAfficher() {\n  var z = $('#galerie'); if (!z) return;\n  chargerSite(function () { chargerDrive(function () {\n    var cible = normTitre($('#f-spectacle').value || $('#f-titre').value), prises = listePhotos();\n    var toutes = toutesPhotos(), pour = toutes.filter(function (p) { return normTitre(p.titre) === cible; }), autres = toutes.filter(function (p) { return normTitre(p.titre) !== cible; });\n    function boutons(p) {\n      var deja = prises.some(function (u) { return u === p.url || u.split('/').pop() === p.url.split('/').pop(); });\n      return (deja ? '<span style=\"color:var(--vert);font-size:12px;padding:3px 5px\">✓ Utilisé</span>' : '<button type=\"button\" data-utiliser=\"' + esc(p.url) + '\">+ Utiliser</button>') +\n        '<button type=\"button\" data-recadrer-g=\"' + esc(p.url) + '\">Recadrer</button>';\n    }\n    var h = '<h4>Visuels disponibles pour « ' + esc($('#f-spectacle').value || $('#f-titre').value) + ' » (' + pour.length + ')</h4>';\n    h += pour.length ? '<div class=\"photos\">' + pour.map(function (p) { return cartePhoto(p, boutons(p)); }).join('') + '</div>'\n      : '<p class=\"aide\">Aucun visuel classé sous ce titre. Ajoutez-en dans l\\'onglet Visuels (ou classez-y ceux qui existent).</p>';\n    var groupes = {}; autres.forEach(function (p) { (groupes[p.titre || 'À classer'] = groupes[p.titre || 'À classer'] || []).push(p); });\n    h += '<details><summary>Les visuels des autres spectacles (' + autres.length + ')</summary>' + Object.keys(groupes).sort().map(function (k) {\n      return '<h4>' + esc(k) + '</h4><div class=\"photos\">' + groupes[k].map(function (p) { return cartePhoto(p, boutons(p)); }).join('') + '</div>';\n    }).join('') + '</details>';\n    z.innerHTML = h;\n    z.querySelectorAll('[data-utiliser]').forEach(function (b) { b.onclick = function () { ecrirePhotos(listePhotos().concat([b.dataset.utiliser])); }; });\n    z.querySelectorAll('[data-recadrer-g]').forEach(function (b) { b.onclick = function () {\n      recadrerUrl(b.dataset.recadrerG, ($('#f-titre').value || 'photo'), function (url) { ecrirePhotos(listePhotos().concat([url])); toast('Visuel recadré et ajouté : pensez à enregistrer'); });\n    }; });\n  }); });\n}\nfunction photosInit() {\n  if (!$('#photos')) return;\n  photosAfficher(); galerieAfficher();\n  $('#f-titre').addEventListener('change', galerieAfficher); $('#f-spectacle').addEventListener('change', galerieAfficher);\n  $('#urlPhoto').onclick = function () { demander('Adresse de l\\'image (https://…) :', function (u) { if (/^https?:\\/\\//.test(u)) ecrirePhotos(listePhotos().concat([u])); else toast('Adresse invalide', true); }, { placeholder: 'https://…' }); };\n  $('#fichierPhoto').onchange = function () {\n    var fichiers = Array.prototype.slice.call(this.files), titre = ($('#f-spectacle').value || $('#f-titre').value || 'photo'); if (!fichiers.length) return;\n    if (fichiers.length === 1) return recadrer(fichiers[0], function (base64) {\n      envoyerImage(titre, base64, function (r) { ecrirePhotos(listePhotos().concat([r.url])); toast('Visuel ajouté ✓ Pensez à enregistrer.'); });\n    });\n    // Plusieurs fichiers : on les ajoute tels quels (réduits), à recadrer ensuite si besoin\n    var n = 0; toast('Envoi de ' + fichiers.length + ' visuels…');\n    (function suivant() {\n      if (n >= fichiers.length) { toast(fichiers.length + ' visuels ajoutés ✓ Recadrez-les si besoin, puis enregistrez.'); return; }\n      reduire(fichiers[n++], function (base64) { envoyerImage(titre, base64, function (r) { ecrirePhotos(listePhotos().concat([r.url])); suivant(); }); });\n    })();\n  };\n}\nvar ENVOIS = 0;\nfunction vignetteEnvoi() { var zg = $('#photos'); if (!zg) return; zg.querySelectorAll('.photo.envoi').forEach(function (x) { x.remove(); }); for (var i = 0; i < ENVOIS; i++) zg.insertAdjacentHTML('beforeend', '<div class=\"photo envoi\"><div><i></i>Envoi…</div></div>'); }\nfunction envoyerImage(titre, base64, ok, extra) {\n  toast('Envoi du visuel…'); ENVOIS++; vignetteEnvoi();\n  var d = { nom: titre + ' · ' + new Date().toISOString().slice(0, 16).replace('T', ' '), base64: base64, spectacle: titre };\n  if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });\n  appel('adminEnregistrerImage', [d], function (r) { ENVOIS = Math.max(0, ENVOIS - 1); PHOTOS_DRIVE = null; ok(r); vignetteEnvoi(); });\n}\n// Récupère un visuel existant (site ou Drive) pour le recadrer, puis l'enregistre comme nouveau fichier.\nfunction recadrerUrl(url, titre, ok) {\n  var id = idDrive(url);\n  function suite(blob) { recadrer(blob, function (base64) { envoyerImage(titre, base64, function (r) { ok(r.url); }); }); }\n  function rate() { toast('Impossible de lire ce visuel pour le recadrer.', true); }\n  if (id) appel('adminLireImage', [id], function (r) { fetch(r.base64).then(function (x) { return x.blob(); }).then(suite).catch(rate); });\n  else fetch(url, { mode: 'cors' }).then(function (x) { if (!x.ok) throw 0; return x.blob(); }).then(suite).catch(rate);\n}\n// Réduit un visuel (max 1600 px) sans le recadrer, pour la bibliothèque.\nfunction reduire(fichier, ok) {\n  var charge = window.createImageBitmap ? createImageBitmap(fichier, { imageOrientation: 'from-image' }) : Promise.reject();\n  charge.catch(function () { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = URL.createObjectURL(fichier); }); })\n    .then(function (im) {\n      var k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);\n      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.85));\n    }).catch(function () { toast('Visuel illisible : ' + fichier.name, true); });\n}\n\n// ---------- Onglet Visuels : la bibliothèque complète, classable à la main ----------\nvar FILTRE_VISUELS = '';\nfunction afficherPhotos() {\n  $('#vue').innerHTML = '<p class=\"vide\">Chargement des visuels…</p>';\n  chargerSite(function () { chargerDrive(function () {\n    var toutes = toutesPhotos(), groupes = {}, titres = titresConnus();\n    toutes.forEach(function (p) { (groupes[p.titre || 'À classer'] = groupes[p.titre || 'À classer'] || []).push(p); });\n    var options = function (choisi) { return '<option value=\"\"' + (!choisi ? ' selected' : '') + '>— à classer —</option>' + titres.map(function (s) { return '<option' + (s === choisi ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '<option value=\"__nouveau__\">+ Nouveau spectacle…</option>'; };\n    function nouveauSpectacle(sel) { // « + Nouveau spectacle… » dans une liste : on demande le nom, on l'ajoute, on le sélectionne\n      sel.onchange = function () {\n        if (sel.value !== '__nouveau__') return;\n        var avant = sel.dataset.avant || '';\n        demander('Nom du nouveau spectacle (tel qu\\'il s\\'affichera) :', function (t) { TITRES_SUPP.push(t); titres = titresConnus(); var o = document.createElement('option'); o.textContent = t; sel.insertBefore(o, sel.lastElementChild); sel.value = t; sel.dataset.avant = t; }, { titre: 'Nouveau spectacle', placeholder: 'Ex. : Le Roi se meurt' });\n        sel.value = avant;\n      };\n      sel.onfocus = function () { if (sel.value !== '__nouveau__') sel.dataset.avant = sel.value; };\n    }\n    var h = '<h2>Visuels</h2>';\n    if (D.version && VERSION_APPLI !== '4050dafb8eab' && D.version !== VERSION_APPLI) h += '<div class=\"bandeau\">Le script Google n\\'est pas encore à la version de l\\'appli : les visuels ajoutés peuvent ne pas apparaître ici tant qu\\'il ne s\\'est pas mis à jour (automatique dans l\\'heure' + (droit('comptes') ? ', ou via le bouton sur l\\'Accueil' : '') + ').</div>';\n    h += '<div class=\"panneau\"><p>Photos, affiches, dessins : tout ce qui peut illustrer un spectacle. <b>1.</b> Choisissez le spectacle, <b>2.</b> ajoutez les fichiers. Ensuite, dans chaque événement, vous choisissez lesquels afficher et dans quel ordre.</p>' +\n      '<div class=\"grille\"><div><label for=\"g-titre\">1. Spectacle</label><select id=\"g-titre\">' + options($('#g-titre') ? $('#g-titre').value : '') + '</select></div>' +\n      '<div><label>2. Fichiers</label><button type=\"button\" class=\"btn plein\" id=\"ajoutGalerie\" style=\"width:100%\">+ Ajouter des visuels</button></div>' +\n      '<div><label for=\"g-filtre\">Afficher</label><select id=\"g-filtre\"><option value=\"\">Tous les spectacles</option>' + Object.keys(groupes).sort(function (a, b) { return a.localeCompare(b, 'fr'); }).map(function (k) { return '<option' + (k === FILTRE_VISUELS ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></div></div>' +\n      '<p class=\"aide\">Sur chaque visuel : « Classer » pour changer de spectacle ou ajouter une légende et un crédit, « Supprimer » pour le retirer de la bibliothèque. « Sur le site » = déjà affiché quelque part.</p></div>';\n    var cles = Object.keys(groupes).sort(function (a, b) { return a === 'À classer' ? -1 : b === 'À classer' ? 1 : a.localeCompare(b, 'fr'); });\n    cles.forEach(function (k) {\n      if (FILTRE_VISUELS && k !== FILTRE_VISUELS) return;\n      h += '<div class=\"groupe' + (k === 'À classer' ? ' aClasser' : '') + '\"><h3>' + esc(k) + ' <span class=\"badge\">' + groupes[k].length + '</span></h3><div class=\"photos\">' + groupes[k].map(function (p) {\n        return cartePhoto(p, '<button type=\"button\" data-classer=\"' + esc(cleVisuel(p)) + '\">Classer</button>' +\n          '<a href=\"' + esc(p.url) + '\" target=\"_blank\" rel=\"noopener\">Voir</a>' +\n          (p.origine === 'drive' ? '<button type=\"button\" data-suppr=\"' + esc(p.id) + '\">Supprimer</button>' : ''));\n      }).join('') + '</div></div>';\n    });\n    if (!toutes.length) h += '<p class=\"vide\">Aucun visuel pour l\\'instant.</p>';\n    h += '<div id=\"classement\"></div>';\n    $('#vue').innerHTML = h;\n    $('#g-filtre').onchange = function () { FILTRE_VISUELS = this.value; afficherPhotos(); };\n    nouveauSpectacle($('#g-titre'));\n    $('#ajoutGalerie').onclick = function () {\n      function choisir() { $('#fichiersGalerie').value = ''; $('#fichiersGalerie').click(); }\n      if ($('#g-titre').value) return choisir();\n      dialogue({ titre: 'Aucun spectacle choisi', texte: 'Les visuels iront dans « À classer » ; vous pourrez les classer ensuite. Pour un nouveau spectacle, choisissez « + Nouveau spectacle… » dans la liste.', oui: 'Continuer quand même', non: 'Choisir d\\'abord', ok: choisir, annuler: function () { $('#g-titre').focus(); } });\n    };\n    $('#fichiersGalerie').onchange = function () {\n      var fichiers = Array.prototype.slice.call(this.files), titre = $('#g-titre').value, n = 0;\n      if (!fichiers.length || titre === '__nouveau__') return;\n      var zone = document.createElement('div'); zone.className = 'groupe'; zone.innerHTML = '<h3>' + esc(titre || 'À classer') + ' · envoi en cours</h3><div class=\"photos\" id=\"envoisEnCours\"></div>';\n      $('#vue').insertBefore(zone, $('#vue').querySelector('.groupe') || $('#classement'));\n      fichiers.forEach(function (f, i) { $('#envoisEnCours').insertAdjacentHTML('beforeend', '<div class=\"photo envoi\" id=\"envoi-' + i + '\"><div><i></i>' + esc(f.name.slice(0, 18)) + '</div></div>'); });\n      toast('Envoi de ' + fichiers.length + ' visuel' + (fichiers.length > 1 ? 's' : '') + '… Ils apparaissent dans « ' + (titre || 'À classer') + ' » dès qu\\'ils sont arrivés.');\n      (function suivant() {\n        if (n >= fichiers.length) { toast(fichiers.length + ' visuel' + (fichiers.length > 1 ? 's' : '') + ' ajouté' + (fichiers.length > 1 ? 's' : '') + ' ✓'); return chargerDrive(afficherPhotos, true); }\n        var f = fichiers[n], i = n++;\n        reduire(f, function (base64) { appel('adminEnregistrerImage', [{ nom: (titre || 'visuel') + ' · ' + f.name.replace(/\\.[a-z0-9]+$/i, '').slice(0, 40), base64: base64, spectacle: titre }], function () { var t = $('#envoi-' + i); if (t) t.innerHTML = '<div>✓ ' + esc(f.name.slice(0, 18)) + '</div>'; suivant(); }); });\n      })();\n    };\n    document.querySelectorAll('[data-suppr]').forEach(function (b) { b.onclick = function () {\n      confirmer('Supprimer ce visuel de la bibliothèque ? S\\'il est affiché sur un événement, il disparaîtra du site.', function () {\n        appel('adminSupprimerPhoto', [b.dataset.suppr], function () { toast('Visuel supprimé'); chargerDrive(afficherPhotos, true); });\n      }, { oui: 'Supprimer', danger: true });\n    }; });\n    document.querySelectorAll('[data-classer]').forEach(function (b) { b.onclick = function () {\n      var p = toutes.filter(function (x) { return cleVisuel(x) === b.dataset.classer; })[0]; if (!p) return;\n      var z = $('#classement');\n      z.innerHTML = '<div class=\"panneau\" id=\"boiteClasser\"><h3 style=\"margin:0 0 10px\">Classer ce visuel</h3><div class=\"classer\"><img src=\"' + esc(p.url) + '\" alt=\"\"><form id=\"fClasser\"><div class=\"grille\">' +\n        '<div><label for=\"c-spectacle\">Spectacle</label><select id=\"c-spectacle\">' + options(p.titre) + '</select></div>' +\n        '<div><label for=\"c-legende\">Légende (facultatif)</label><input id=\"c-legende\" value=\"' + esc(p.legende || '') + '\" placeholder=\"Ex. : Scène finale, 2025\"></div>' +\n        '<div><label for=\"c-credit\">Crédit</label><input id=\"c-credit\" value=\"' + esc(p.credit || '') + '\" placeholder=\"Photo : Prénom Nom\"></div></div>' +\n        '<div class=\"actions\"><button class=\"btn plein\" type=\"submit\">Enregistrer</button><button class=\"btn\" type=\"button\" id=\"fermerClasser\">Annuler</button></div></form></div></div>';\n      z.scrollIntoView({ behavior: 'smooth', block: 'nearest' });\n      $('#fermerClasser').onclick = function () { z.innerHTML = ''; };\n      nouveauSpectacle($('#c-spectacle'));\n      $('#fClasser').onsubmit = function (ev) {\n        ev.preventDefault();\n        appel('adminEnregistrerVisuel', [{ cle: cleVisuel(p), spectacle: $('#c-spectacle').value, legende: $('#c-legende').value, credit: $('#c-credit').value }], function (r) {\n          if (r && !Array.isArray(r) && r.photos) { PHOTOS_DRIVE = r.photos; INFOS_VISUELS = r.infos || {}; } else PHOTOS_DRIVE = null; toast('Visuel classé'); afficherPhotos();\n        });\n      };\n    }; });\n  }); });\n}\n\n// ---------- Recadrage : cadre 3:2 du site, repères pour les autres emplacements, zoom, rotation ----------\nfunction recadrer(fichier, ok) {\n  var boite = $('#recadrage'), cv = $('#cv'), ctx = cv.getContext('2d'), zoom = $('#zoom'), reperes = $('#reperes');\n  var img, base, s, ox, oy, W = 900, H = 600, rotation = 0;\n  cv.width = W; cv.height = H;\n  var charge = window.createImageBitmap ? createImageBitmap(fichier, { imageOrientation: 'from-image' }).catch(function () { return chargerImage(fichier); }) : chargerImage(fichier);\n  charge.then(function (im) { img = im; recentrer(); boite.classList.add('ouvert'); });\n  function chargerImage(f) { return new Promise(function (res, rej) { var u = URL.createObjectURL(f), i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = u; }); }\n  function recentrer() { base = Math.max(W / img.width, H / img.height); s = base; zoom.value = 1; ox = (W - img.width * s) / 2; oy = (H - img.height * s) / 2; dessiner(); }\n  function tourner() { // 90° : on redessine l'image dans un canevas pivoté, puis on recentre\n    var c = document.createElement('canvas'); c.width = img.height; c.height = img.width;\n    var x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate(Math.PI / 2); x.drawImage(img, -img.width / 2, -img.height / 2);\n    img = c; recentrer();\n  }\n  function borner() { ox = Math.min(0, Math.max(W - img.width * s, ox)); oy = Math.min(0, Math.max(H - img.height * s, oy)); }\n  function dessiner() {\n    borner(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, ox, oy, img.width * s, img.height * s);\n    if (!reperes.checked) return;\n    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2;\n    ctx.strokeRect(1, H * 0.125, W - 2, H * 0.75); // haut de fiche (2:1), bande centrale\n    ctx.strokeRect((W - H) / 2, 1, H, H - 2); // miniature carrée (liste)\n    ctx.restore();\n    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.font = '600 15px Barlow, sans-serif';\n    ctx.fillRect(8, 8, 150, 22); ctx.fillStyle = '#fff'; ctx.fillText('Cadre : programme', 14, 24);\n    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(8, H * 0.125 + 8, 160, 22); ctx.fillStyle = '#fff'; ctx.fillText('— — haut de fiche', 14, H * 0.125 + 24);\n    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect((W - H) / 2 + 8, H - 30, 110, 22); ctx.fillStyle = '#fff'; ctx.fillText('— — miniature', (W - H) / 2 + 14, H - 14);\n    ctx.restore();\n  }\n  zoom.oninput = function () { var ns = base * zoom.value, cx = W / 2, cy = H / 2; ox = cx - (cx - ox) * ns / s; oy = cy - (cy - oy) * ns / s; s = ns; dessiner(); };\n  reperes.onchange = dessiner;\n  $('#tourner').onclick = tourner; $('#recentrer').onclick = recentrer;\n  var doigts = {}, pince = null;\n  cv.onpointerdown = function (ev) { doigts[ev.pointerId] = { x: ev.clientX, y: ev.clientY }; cv.setPointerCapture(ev.pointerId); var l = Object.keys(doigts); if (l.length === 1) pince = { x: ev.clientX, y: ev.clientY, ox: ox, oy: oy }; else pince = null; };\n  cv.onpointermove = function (ev) {\n    if (!doigts[ev.pointerId]) return;\n    var avant = doigts[ev.pointerId]; doigts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };\n    var l = Object.keys(doigts), k = W / cv.clientWidth;\n    if (l.length >= 2) { // pincement : zoom\n      var a = doigts[l[0]], b = doigts[l[1]], autre = l[0] === String(ev.pointerId) ? b : a, dAvant = Math.hypot(avant.x - autre.x, avant.y - autre.y), dApres = Math.hypot(ev.clientX - autre.x, ev.clientY - autre.y);\n      if (dAvant > 0) { var z = Math.min(4, Math.max(1, zoom.value * dApres / dAvant)); zoom.value = z; zoom.oninput(); }\n    } else if (pince) { ox = pince.ox + (ev.clientX - pince.x) * k; oy = pince.oy + (ev.clientY - pince.y) * k; dessiner(); }\n  };\n  cv.onpointerup = cv.onpointercancel = function (ev) { delete doigts[ev.pointerId]; pince = null; };\n  $('#recadrerOk').onclick = function () {\n    var out = document.createElement('canvas'), f = 1600 / W; out.width = 1600; out.height = 1067;\n    var c = out.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, out.width, out.height); c.drawImage(img, ox * f, oy * f, img.width * s * f, img.height * s * f);\n    boite.classList.remove('ouvert'); ok(out.toDataURL('image/jpeg', 0.85));\n  };\n  $('#recadrerNon').onclick = function () { boite.classList.remove('ouvert'); };\n}\n\n// ---------- Aperçu du site, en volet à côté de l'édition, qui suit les modifications ----------\nfunction siteUrl() { var u = (D.reglages.siteUrl || '').trim(); return u ? u.replace(/\\/?$/, '/') : ''; }\nfunction idApercu(e, nouveau) { return nouveau ? 'brouillon' : e.id; }\nfunction apercuSite(e, nouveau) {\n  var id = idApercu(e, nouveau);\n  return '<div class=\"apercu\" id=\"apercu\"><div class=\"onglets\">' +\n    '<button type=\"button\" class=\"btn petit on\" data-page=\"programme.html?frais=1#' + esc(id) + '\">Fiche</button>' +\n    '<button type=\"button\" class=\"btn petit\" data-page=\"programme.html?frais=1#jour-\" data-jour=\"1\">Journée</button>' +\n    '<button type=\"button\" class=\"btn petit\" data-page=\"programme.html?frais=1\">Programme</button>' +\n    '<button type=\"button\" class=\"btn petit\" data-page=\"?frais=1\">Accueil</button>' +\n    '<button type=\"button\" class=\"btn petit\" id=\"tel\">Téléphone</button>' +\n    '<a class=\"btn petit\" id=\"ouvrirSite\" href=\"' + esc(siteUrl() + 'programme.html#' + e.id) + '\" target=\"_blank\" rel=\"noopener\">Ouvrir</a>' +\n    '<button type=\"button\" class=\"btn petit discret\" id=\"fermerApercu\" title=\"Fermer l\\'aperçu\">×</button></div>' +\n    '<p class=\"aide\" id=\"aideApercu\">L\\'aperçu suit ce que vous tapez, même avant d\\'enregistrer' + (e.statut === 'Ouvert' || e.statut === 'Fermé' || nouveau ? '.' : '. Cet événement est « ' + esc(e.statut) + ' » : les visiteurs ne le voient pas tant qu\\'il n\\'est pas Ouvert ou Fermé.') + '</p>' +\n    '<div class=\"cadre\"><iframe id=\"cadreSite\" title=\"Aperçu du site\"></iframe></div></div>';\n}\nvar ENVOI_BROUILLON = null;\nfunction brouillonActuel(e, nouveau) {\n  var f = $('#form'); if (!f) return null;\n  var o = { id: idApercu(e, nouveau), attente: '' }; new FormData(f).forEach(function (v, k) { o[k] = v; });\n  if (!o.statut) o.statut = e.statut || 'Brouillon';\n  o.compagnie = o.compagnie || ''; o.prises = e.prises || 0;\n  return o;\n}\nfunction envoyerBrouillon(e, nouveau) {\n  var f = $('#cadreSite'); if (!f || $('#voletApercu').hidden) return;\n  clearTimeout(ENVOI_BROUILLON);\n  ENVOI_BROUILLON = setTimeout(function () {\n    var b = brouillonActuel(e, nouveau); if (!b || !f.contentWindow) return;\n    var aide = $('#aideApercu');\n    if (aide) { if (!b.date) { aide.textContent = 'Donnez une date à l\\'événement : sans date, il n\\'apparaît ni dans l\\'aperçu ni sur le site.'; aide.className = 'aide alerte'; } else if (aide.className === 'aide alerte') { aide.textContent = 'L\\'aperçu suit ce que vous tapez, même avant d\\'enregistrer.'; aide.className = 'aide'; } }\n    if (!b.date) return;\n    try { f.contentWindow.postMessage({ type: 'pf-brouillon', evenement: b }, '*'); } catch (err) {}\n  }, 350);\n}\nfunction apercuInit(e, nouveau) {\n  var a = $('#apercu'), volet = $('#voletApercu'), bouton = $('#voirApercu'); if (!a || !bouton) return;\n  var cadre = $('#cadreSite'), editeur = $('#editeur'), boiteCadre = a.querySelector('.cadre');\n  function pageDe(b) { return b.dataset.jour ? b.dataset.page + ($('#f-date') && $('#f-date').value || aujourdhui()) : b.dataset.page; }\n  function charger(page) { cadre.src = 'about:blank'; setTimeout(function () { cadre.src = siteUrl() + page; }, 30); }\n  function ajuster() { // rendu « ordinateur » (1200 px de large) réduit pour tenir dans le volet ; « téléphone » = 390 px sans réduction\n    if (a.classList.contains('tel')) { cadre.style.transform = ''; cadre.style.width = ''; cadre.style.height = ''; return; }\n    var w = boiteCadre.clientWidth, h = boiteCadre.clientHeight, k = Math.min(1, w / 1200);\n    cadre.style.width = '1200px'; cadre.style.transform = 'scale(' + k + ')'; cadre.style.height = Math.round(h / k) + 'px';\n  }\n  if (window.ResizeObserver) new ResizeObserver(ajuster).observe(boiteCadre); else addEventListener('resize', ajuster);\n  cadre.onload = function () { if (cadre.src !== 'about:blank') setTimeout(function () { envoyerBrouillon(e, nouveau); }, 400); };\n  function ouvrir() { volet.hidden = false; editeur.classList.add('avecApercu'); bouton.classList.add('on'); garderLocal('apercu', '1'); ajuster(); if (!cadre.src || cadre.src === 'about:blank') charger(pageDe(a.querySelector('[data-page].on'))); }\n  function fermer() { volet.hidden = true; editeur.classList.remove('avecApercu'); bouton.classList.remove('on'); garderLocal('apercu', ''); }\n  bouton.onclick = function () { volet.hidden ? ouvrir() : fermer(); };\n  $('#fermerApercu').onclick = fermer;\n  a.querySelectorAll('[data-page]').forEach(function (b) {\n    b.onclick = function () {\n      a.querySelectorAll('[data-page]').forEach(function (x) { x.classList.toggle('on', x === b); });\n      $('#ouvrirSite').href = siteUrl() + pageDe(b).replace('?frais=1', '');\n      charger(pageDe(b));\n    };\n  });\n  $('#tel').onclick = function () { a.classList.toggle('tel'); $('#tel').classList.toggle('on'); ajuster(); };\n  if (lireLocal('apercu') === '1' && window.innerWidth > 960) ouvrir();\n}\n\nappel('adminCharger', [], recharger);\n</script>\n</body>\n</html>\n";
