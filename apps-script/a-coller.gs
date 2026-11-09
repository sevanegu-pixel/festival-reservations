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
};

var COL_EV = ['id', 'Titre', 'Spectacle', 'Compagnie', 'Date', 'Début', 'Fin', 'Durée', 'Âge', 'Lieu', 'Adresse',
  'Description', 'Tarif', 'Places', 'Statut', 'Image', 'Créé le'];
var CHAMPS_EV = ['id', 'titre', 'spectacle', 'compagnie', 'date', 'debut', 'fin', 'duree', 'age', 'lieu', 'adresse',
  'description', 'tarif', 'places', 'statut', 'image', 'cree'];

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
  adminAjouterReservation: 'reservations', adminAnnulerReservation: 'reservations', adminPointer: 'reservations',
  adminEnregistrerReglages: 'reglages', adminEssaiMail: 'reglages',
  adminEnregistrerImage: 'photos', adminListerPhotos: 'photos', adminLireImage: 'photos', adminSupprimerPhoto: 'photos',
  adminListerComptes: 'comptes', adminEnregistrerCompte: 'comptes', adminSupprimerCompte: 'comptes', adminMettreAJour: 'comptes'
};
function adminApi_(d) {
  try {
    if (!(d.fn in FONCTION_DROIT)) throw new Error('Fonction inconnue.');
    var compte = acces_(d), droit = FONCTION_DROIT[d.fn];
    if (droit && !compte.droits[droit]) throw new Error('Votre compte (' + compte.nom + ') n\'a pas ce droit : ' + droit + '.');
    var args = Array.isArray(d.args) ? d.args : [];
    if (d.fn === 'adminEnregistrerEvenement' && !compte.droits.publier) args[0] = sansPublication_(args[0]);
    var cle = PropertiesService.getScriptProperties().getProperty(RESA.cleAdmin);
    var res = globalThis[d.fn].apply(null, [cle].concat(args));
    if (res && res.evenements && res.reglages) { // réponse adminCharger : on y joint le compte, et on cache les contacts à qui n'a pas le droit
      res.compte = { id: compte.id, nom: compte.nom, droits: compte.droits };
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
  var pin = String(d.pin || '');
  if (!pin) throw new Error('Code PIN requis.');
  if (!/^\d{4,8}$/.test(pin)) throw new Error('Code PIN incorrect.');
  var cache = CacheService.getScriptCache(), echecs = Number(cache.get('pin_echecs') || 0);
  if (echecs >= 15) throw new Error('Trop d\'essais de code PIN : réessayez dans dix minutes.');
  var comptes = comptes_(), c = null;
  for (var i = 0; i < comptes.length; i++) if (comptes[i].hash === hashPin_(pin, comptes[i].id)) { c = comptes[i]; break; }
  if (!c) { cache.put('pin_echecs', String(echecs + 1), 600); throw new Error('Code PIN incorrect.'); }
  cache.remove('pin_echecs');
  return { id: c.id, nom: c.nom, droits: c.droits || {} };
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
    lieu: ev.lieu, adresse: ev.adresse, description: ev.description, tarif: ev.tarif, image: ev.image,
    reservable: ev.statut === 'Ouvert' && (places === 0 || prises < places),
    complet: places > 0 && prises >= places,
    restantes: places > 0 ? Math.max(0, places - prises) : null,
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
    if (max > 0 && prises + places > max) {
      var reste = Math.max(0, max - prises);
      return { ok: false, erreur: reste ? 'Il ne reste que ' + reste + ' place(s).' : 'Désolé, c\'est complet.', restantes: reste };
    }
    var resa = {
      id: nouvelId_('R'), evenement: ev.id, titreEvenement: ev.titre, recue: maintenant_(),
      nom: nom, email: email, telephone: telephone, places: places, message: message, statut: 'Confirmée',
    };
    ajouterLigne_(onglet_(RESA.ongletReservations, COL_RES), CHAMPS_RES, resa);
    SpreadsheetApp.flush();
  } finally {
    verrou.releaseLock();
  }
  var mailEnvoye = true;
  try {
    envoyerConfirmation_(ev, resa);
  } catch (err) { // quota d'e-mails dépassé… la réservation est quand même enregistrée
    mailEnvoye = false;
    console.error('E-mail non envoyé pour ' + resa.id + ' : ' + err);
  }
  return { ok: true, id: resa.id, mailEnvoye: mailEnvoye, restantes: max > 0 ? max - prises - places : null };
}

// ---------- E-mails ----------

function envoyerConfirmation_(ev, resa) {
  var r = reglages_();
  var valeurs = valeursMail_(ev, resa);
  var texte = remplir_(r.message, valeurs);
  MailApp.sendEmail({
    to: resa.email,
    subject: remplir_(r.sujet, valeurs),
    body: texte,
    htmlBody: texteVersHtml_(texte),
    name: r.nomFestival,
    replyTo: r.copieA || undefined,
  });
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

function envoyerAnnulation_(ev, resa) {
  var r = reglages_();
  var valeurs = valeursMail_(ev, resa);
  var texte = remplir_(r.messageAnnulation, valeurs);
  MailApp.sendEmail({
    to: resa.email, subject: remplir_(r.sujetAnnulation, valeurs), body: texte, htmlBody: texteVersHtml_(texte),
    name: r.nomFestival, replyTo: r.copieA || undefined,
  });
}

function valeursMail_(ev, resa) {
  return {
    nom: resa.nom, places: resa.places, titre: ev.titre, date: dateLongue_(ev.date),
    heure: ev.debut || '', lieu: [ev.lieu, ev.adresse].filter(String).join(', '), tarif: ev.tarif || '',
    festival: reglages_().nomFestival,
  };
}

function remplir_(modele, valeurs) {
  return String(modele).replace(/\{(\w+)\}/g, function (tout, cle) { return cle in valeurs ? valeurs[cle] : tout; });
}

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
  return { url: 'https://drive.google.com/thumbnail?id=' + fichier.getId() + '&sz=w1600', id: fichier.getId(), nom: fichier.getName() };
}

// Galerie de l'appli : toutes les photos du dossier Drive, les plus récentes d'abord.
function adminListerPhotos(cle) {
  verifierCle_(cle);
  var it = dossierPhotos_().getFiles(), l = [];
  while (it.hasNext()) {
    var f = it.next();
    if (String(f.getMimeType()).indexOf('image/') !== 0) continue;
    l.push({ id: f.getId(), nom: f.getName().replace(/\.[a-z]+$/i, ''), url: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w1600', date: f.getDateCreated().getTime() });
  }
  l.sort(function (a, b) { return b.date - a.date; });
  return l;
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

function adminEssaiMail(cle) {
  verifierCle_(cle);
  var r = reglages_();
  if (!r.copieA) throw new Error('Indiquez d\'abord l\'adresse qui reçoit les copies, puis enregistrez.');
  var ev = { titre: 'Événement d\'essai', date: Utilities.formatDate(new Date(), 'Europe/Zurich', 'yyyy-MM-dd'),
    debut: '20:00', lieu: 'Théâtricul', adresse: 'Chêne-Bourg', tarif: '' };
  var resa = { nom: 'Prénom Nom', email: r.copieA, places: 2 };
  var v = valeursMail_(ev, resa);
  MailApp.sendEmail({ to: r.copieA, subject: '[Essai] ' + remplir_(r.sujet, v), body: remplir_(r.message, v),
    htmlBody: texteVersHtml_(remplir_(r.message, v)), name: r.nomFestival });
  return 'E-mail d\'essai envoyé à ' + r.copieA;
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
    if (r.statut !== 'Annulée') pris[r.evenement] = (pris[r.evenement] || 0) + r.places;
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

// ---------- Mise à jour automatique du script depuis GitHub ----------
// Le code de référence est a-coller.gs dans le dépôt GitHub. Toutes les heures (et sur demande depuis l'appli),
// le script compare sa version à celle du dépôt ; si elle diffère, il remplace son propre code, crée une version
// et met à jour le déploiement de l'application web. Plus rien à coller à la main.
// Une seule fois : activer l'API Apps Script sur https://script.google.com/home/usersettings, coller le manifeste
// appsscript.json (autorisations), puis menu Festival → « Activer la mise à jour automatique ».

var VERSION_CODE = 'd57d2a2ebebc';
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

var ADMIN_HTML = "<!doctype html>\n<html lang=\"fr\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link href=\"https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Barlow:wght@400;500;600&display=swap\" rel=\"stylesheet\">\n<style>\n:root{--fond:#0b0a10;--carte:#17141f;--ligne:#2c2640;--texte:#f4f1ff;--doux:#b9aee6;--lav:#ff5a5f;--lav2:#ff8f92;--rouge:#ff7a8a;--vert:#7ee0b0}\n*{box-sizing:border-box}\nhtml,body{margin:0;background:var(--fond);color:var(--texte);font:16px/1.45 Barlow,system-ui,sans-serif}\nheader{position:sticky;top:0;z-index:5;background:var(--fond);border-bottom:1px solid var(--ligne);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}\nh1{font:700 22px/1.1 \"Bricolage Grotesque\",sans-serif;margin:0;flex:1;min-width:180px}\nh1 small{display:block;font:500 13px Barlow,sans-serif;color:var(--doux);letter-spacing:.04em;text-transform:uppercase}\nh2{font:700 20px \"Bricolage Grotesque\",sans-serif;margin:24px 0 10px}\nnav button,.btn{font:600 15px Barlow,sans-serif;border:1px solid var(--lav);background:transparent;color:var(--lav2);border-radius:999px;padding:8px 14px;cursor:pointer}\nnav button.on,.btn.plein{background:var(--lav);color:#0b0a10;border-color:var(--lav)}\n.btn.petit{padding:4px 10px;font-size:13px}\na.btn{text-decoration:none;display:inline-block}\n.btn.danger{border-color:var(--rouge);color:var(--rouge)}\n.btn:disabled{opacity:.5;cursor:default}\nmain{max-width:980px;margin:0 auto;padding:8px 16px 80px}\n.liste{display:grid;gap:10px}\n.ev{display:grid;grid-template-columns:64px 1fr auto;gap:14px;align-items:center;background:var(--carte);border:1px solid var(--ligne);border-radius:10px;padding:12px;cursor:pointer;text-align:left;color:inherit;font:inherit;width:100%}\n.ev:hover{border-color:var(--lav)}\n.jour{text-align:center;border-right:1px solid var(--ligne);padding-right:10px}\n.jour b{display:block;font:700 26px/1 \"Bricolage Grotesque\",sans-serif}\n.jour span{font-size:12px;text-transform:uppercase;color:var(--doux)}\n.ev h3{margin:0 0 2px;font-size:17px}\n.ev p{margin:0;color:var(--doux);font-size:14px}\n.jauge{min-width:92px;text-align:right;font-size:14px}\n.jauge .barre{height:5px;background:var(--ligne);border-radius:3px;margin-top:5px;overflow:hidden}\n.jauge .barre i{display:block;height:100%;background:var(--lav)}\n.badge{display:inline-block;font-size:12px;border-radius:999px;padding:1px 8px;margin-left:6px;border:1px solid var(--ligne);color:var(--doux);vertical-align:2px}\n.badge.Ouvert{border-color:var(--vert);color:var(--vert)}\n.badge.Annulé{border-color:var(--rouge);color:var(--rouge)}\n.statutRapide{width:auto;font-size:13px;padding:4px 6px;margin-top:6px;border-radius:999px}\n.galerie{margin:14px 0 0}\n.galerie h4{margin:12px 0 4px;font:600 14px Barlow,sans-serif;color:var(--doux)}\n.galerie details{margin-top:10px}\n.galerie summary{cursor:pointer;color:var(--lav2);font-weight:600;font-size:14px}\n.photo .etiquette{position:absolute;right:6px;top:4px;font:600 11px Barlow,sans-serif;background:rgba(11,10,16,.8);color:var(--vert);border-radius:999px;padding:1px 7px}\n.photo .etiquette.drive{color:var(--doux)}\n.photo .outils{flex-wrap:wrap;gap:0 2px}\n.photo.portrait img{object-fit:contain;background:#000}\n.groupe{margin-top:18px}\n.groupe h3{margin:0 0 6px;font:700 17px \"Bricolage Grotesque\",sans-serif}\n.pin{max-width:360px;margin:40px auto;text-align:center}\n.pin img{width:96px;height:96px;border-radius:22px}\n.pin input{font:700 34px/1 \"Bricolage Grotesque\",sans-serif;text-align:center;letter-spacing:.3em;padding:14px 10px;margin:16px 0 12px}\n.pin .btn{width:100%;padding:12px}\n.compte{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--ligne)}\n.compte:last-child{border:0}\n.compte .qui{flex:1;min-width:200px}\n.compte .qui b{font-size:16px}\n.compte .qui p{margin:3px 0 0;color:var(--doux);font-size:13px}\n.compte .actions{margin:0}\n.coches label{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:var(--texte);margin:6px 0;cursor:pointer}\n.coches input{width:auto;margin-top:3px}\n.bandeau{background:var(--carte);border:1px solid var(--lav);border-radius:10px;padding:10px 14px;margin:10px 0;font-size:14px}\n.bandeau a{color:var(--lav2)}\nnav button.discret{border-color:var(--ligne);color:var(--doux)}\n.arrivee{width:auto;transform:scale(1.3);margin:4px}\ntr.arrivee td{color:var(--vert)}\n.vide{color:var(--doux);font-style:italic}\nform .grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}\nlabel{display:block;font-size:13px;color:var(--doux);margin-bottom:4px}\ninput,select,textarea{width:100%;font:inherit;color:var(--texte);background:#100e17;border:1px solid var(--ligne);border-radius:8px;padding:9px 10px}\ninput:focus,select:focus,textarea:focus{outline:2px solid var(--lav);border-color:var(--lav)}\ntextarea{min-height:110px;resize:vertical}\n.large{grid-column:1/-1}\n.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}\n.panneau{background:var(--carte);border:1px solid var(--ligne);border-radius:12px;padding:16px;margin-top:12px}\ntable{width:100%;border-collapse:collapse;font-size:14px}\nth,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--ligne);vertical-align:top}\nth{color:var(--doux);font-weight:500}\ntr.annulee td{opacity:.45;text-decoration:line-through}\ntr.annulee td:last-child{text-decoration:none}\n.tableau{overflow-x:auto}\n.aide{font-size:13px;color:var(--doux);margin:4px 0 0}\n#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--lav);color:#0b0a10;font-weight:600;padding:10px 16px;border-radius:999px;display:none;z-index:20;max-width:92vw}\n#toast.erreur{background:var(--rouge)}\n#charge{position:fixed;top:0;left:0;height:3px;width:100%;background:var(--lav);display:none;z-index:30;animation:c 1s infinite linear}\n@keyframes c{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}\n/* Photos et recadrage */\n.photos{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0 8px}\n#photos .photo{width:180px}\n.photo{position:relative;width:150px;aspect-ratio:3/2;background:#100e17;border:1px solid var(--ligne);border-radius:8px;overflow:hidden}\n.photo img{width:100%;height:100%;object-fit:cover;display:block}\n.photo .outils{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;background:rgba(11,10,16,.8);padding:3px 4px}\n.photo .outils button{background:none;border:0;color:var(--texte);font:600 12px Barlow,sans-serif;cursor:pointer;padding:3px 5px}\n.photo .outils button:hover{color:var(--lav2)}\n.photo .num{position:absolute;left:6px;top:4px;font:700 12px Barlow,sans-serif;background:var(--lav);color:#0b0a10;border-radius:999px;padding:1px 7px}\n.photos .ajout{width:150px;aspect-ratio:3/2;border:1px dashed var(--lav);border-radius:8px;background:none;color:var(--lav2);font:600 14px Barlow,sans-serif;cursor:pointer}\n#recadrage{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:40;display:none;align-items:center;justify-content:center;padding:12px}\n#recadrage.ouvert{display:flex}\n#recadrage .boite{background:var(--carte);border:1px solid var(--ligne);border-radius:14px;padding:16px;width:min(96vw,640px)}\n#recadrage canvas{display:block;width:100%;aspect-ratio:3/2;background:#000;border-radius:8px;cursor:grab;touch-action:none}\n#recadrage .reglage{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:14px;color:var(--doux)}\n#recadrage input[type=range]{flex:1;padding:0}\n/* Aperçu du site */\n.apercu{margin-top:12px}\n.apercu .onglets{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}\n.apercu iframe{width:100%;height:min(78vh,900px);border:1px solid var(--ligne);border-radius:12px;background:#120f24}\n.apercu .cadre{position:relative}\n.apercu.tel iframe{width:400px;max-width:100%;margin:0 auto;display:block}\n@media (max-width:560px){.ev{grid-template-columns:52px 1fr}.jauge{grid-column:2;text-align:left}.jauge .barre{width:120px}}\n</style>\n</head>\n<body>\n<div id=\"charge\"></div>\n<header>\n  <h1><small id=\"nomFestival\">Festival</small>Réservations</h1>\n  <nav><button data-vue=\"evenements\" class=\"on\">Événements</button> <button data-vue=\"photos\" data-droit=\"photos\">Photos</button> <button data-vue=\"reglages\" data-droit=\"reglages,comptes\">Réglages</button> <button type=\"button\" class=\"discret\" id=\"quitter\" title=\"Changer de compte\">Quitter</button></nav>\n</header>\n<main id=\"vue\"><p class=\"vide\">Chargement…</p></main>\n<input type=\"file\" id=\"fichierPhoto\" accept=\"image/*\" hidden>\n<input type=\"file\" id=\"fichiersGalerie\" accept=\"image/*\" multiple hidden>\n<div id=\"recadrage\"><div class=\"boite\"><canvas id=\"cv\"></canvas><div class=\"reglage\">Zoom <input type=\"range\" id=\"zoom\" min=\"1\" max=\"4\" step=\"0.01\" value=\"1\"></div>\n<p class=\"aide\">Déplacez la photo pour choisir le cadrage. Le cadre correspond aux photos du programme.</p>\n<div class=\"actions\"><button type=\"button\" class=\"btn plein\" id=\"recadrerOk\">Utiliser cette photo</button><button type=\"button\" class=\"btn\" id=\"recadrerNon\">Annuler</button></div></div></div>\n<div id=\"toast\"></div>\n\n<script>\nvar CLE = <?!= JSON.stringify(cle) ?>;\nvar VERSION_APPLI = 'd57d2a2ebebc', PIN = '', COMPTE = null, D = null, vue = 'evenements', ouvert = null;\nfunction droit(k) { return !COMPTE || !!COMPTE.droits[k]; }\nfunction deconnexion() { try { localStorage.removeItem('festival_resa_pin'); localStorage.removeItem('festival_resa_cle'); } catch (e) {} PIN = ''; COMPTE = null; D = null; location.reload(); }\n// Écran d'entrée par code PIN (appli GitHub Pages ; l'écran Apps Script, lui, s'ouvre par le lien personnel).\nfunction ecranPin(message) {\n  $('#vue').innerHTML = '<form class=\"pin\" id=\"formPin\"><img src=\"icone_192.png\" alt=\"\"><h2>Code PIN</h2>' +\n    (message ? '<p class=\"aide\" style=\"color:var(--rouge)\">' + esc(message) + '</p>' : '<p class=\"aide\">Le code que le festival vous a donné.</p>') +\n    '<input id=\"pinSaisie\" type=\"password\" inputmode=\"numeric\" autocomplete=\"one-time-code\" pattern=\"[0-9]*\" maxlength=\"8\" placeholder=\"••••\" autofocus required>' +\n    '<button class=\"btn plein\" type=\"submit\">Entrer</button></form>';\n  $('#formPin').onsubmit = function (ev) {\n    ev.preventDefault(); PIN = $('#pinSaisie').value.replace(/\\D/g, '');\n    appel('adminCharger', [], function (res) { try { localStorage.setItem('festival_resa_pin', PIN); } catch (e) {} recharger(res); });\n  };\n}\nvar MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];\n\nfunction $(s, r) { return (r || document).querySelector(s); }\nfunction esc(t) { return String(t == null ? '' : t).replace(/[&<>\"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]; }); }\nfunction toast(t, err) { var b = $('#toast'); b.textContent = t; b.className = err ? 'erreur' : ''; b.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { b.style.display = 'none'; }, err ? 6000 : 2500); }\nfunction aujourdhui() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }\n\nfunction appel(fn, args, ok) {\n  $('#charge').style.display = 'block';\n  var r = google.script.run.withSuccessHandler(function (res) { $('#charge').style.display = 'none'; ok(res); })\n    .withFailureHandler(function (e) { $('#charge').style.display = 'none'; toast(e.message || String(e), true); });\n  r[fn].apply(r, [CLE].concat(args || []));\n}\nfunction recharger(res) {\n  D = res; COMPTE = res.compte || null; $('#nomFestival').textContent = D.reglages.nomFestival || 'Festival';\n  document.querySelectorAll('nav [data-droit]').forEach(function (b) { b.hidden = !b.dataset.droit.split(',').some(droit); });\n  $('#quitter').hidden = !COMPTE || COMPTE.id === 'cle' && !PIN;\n  if ((vue === 'photos' && !droit('photos')) || (vue === 'reglages' && !droit('reglages') && !droit('comptes'))) { vue = 'evenements'; ouvert = null; document.querySelectorAll('nav button[data-vue]').forEach(function (x) { x.classList.toggle('on', x.dataset.vue === vue); }); }\n  afficher();\n}\n\n$('#quitter').onclick = function () { if (confirm('Quitter ce compte ? Il faudra redonner le code PIN.')) deconnexion(); };\ndocument.querySelectorAll('nav button[data-vue]').forEach(function (b) {\n  b.onclick = function () { vue = b.dataset.vue; ouvert = null; document.querySelectorAll('nav button').forEach(function (x) { x.classList.toggle('on', x === b); }); afficher(); };\n});\n\nfunction afficher() {\n  if (!D) return;\n  if (vue === 'reglages') return afficherReglages();\n  if (vue === 'photos') return afficherPhotos();\n  if (ouvert) return afficherEvenement(ouvert);\n  var today = aujourdhui();\n  var evs = D.evenements.slice().sort(function (a, b) { return (a.date + a.debut) < (b.date + b.debut) ? -1 : 1; });\n  var avenir = evs.filter(function (e) { return e.date >= today; });\n  var passes = evs.filter(function (e) { return e.date < today; }).reverse();\n  var h = droit('evenements') ? '<div class=\"actions\"><button class=\"btn plein\" id=\"nouveau\">+ Nouvel événement</button></div>' : '';\n  if (D.version && VERSION_APPLI !== 'd57d2a2ebebc' && D.version !== VERSION_APPLI && droit('comptes')) h += '<div class=\"bandeau\">Le script Google (version ' + esc(D.version) + ') n\\'est pas celui de l\\'appli (' + esc(VERSION_APPLI) + '). <button type=\"button\" class=\"btn petit plein\" id=\"majScript\">Mettre à jour le script</button> <span class=\"aide\" style=\"display:inline\">Ça prend quelques secondes ; sinon, il se met à jour tout seul dans l\\'heure.</span></div>';\n  if (COMPTE && COMPTE.id === 'cle' && droit('comptes') && !PIN) h += '<div class=\"bandeau\" id=\"bandeauPin\">Vous êtes entrée avec le lien personnel. Créez votre code PIN et ceux des bénévoles dans <a href=\"#\" id=\"versComptes\">Réglages → Comptes</a> : ensuite l\\'appli s\\'ouvre avec le code, sur n\\'importe quel appareil.</div>';\n  h += '<h2>À venir</h2>' + liste(avenir) + '<h2>Passés</h2>' + liste(passes);\n  $('#vue').innerHTML = h;\n  if ($('#nouveau')) $('#nouveau').onclick = function () { ouvert = 'nouveau'; afficher(); };\n  if ($('#majScript')) $('#majScript').onclick = function () { $('#majScript').disabled = true; toast('Mise à jour en cours…'); appel('adminMettreAJour', [], function (t) { toast(t); setTimeout(function () { appel('adminCharger', [], recharger); }, 1500); }); };\n  if ($('#versComptes')) $('#versComptes').onclick = function (ev) { ev.preventDefault(); $('nav [data-vue=reglages]').click(); setTimeout(function () { var c = $('#comptes'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }, 300); };\n  document.querySelectorAll('.ev').forEach(function (b) { b.onclick = function () { ouvert = b.dataset.id; afficher(); scrollTo(0, 0); }; });\n  document.querySelectorAll('.statutRapide').forEach(function (s) {\n    s.onclick = function (ev) { ev.stopPropagation(); };\n    s.onchange = function (ev) {\n      ev.stopPropagation();\n      var e = D.evenements.filter(function (x) { return x.id === s.dataset.id; })[0]; if (!e) return;\n      var o = {}; Object.keys(e).forEach(function (k) { o[k] = e[k]; }); o.statut = s.value;\n      appel('adminEnregistrerEvenement', [o], function (res) { recharger(res); toast('« ' + e.titre + ' » : ' + s.value); });\n    };\n  });\n}\n\nfunction liste(evs) {\n  if (!evs.length) return '<p class=\"vide\">Aucun événement.</p>';\n  return '<div class=\"liste\">' + evs.map(function (e) {\n    var p = e.date.split('-'), places = Number(e.places) || 0;\n    var pc = places ? Math.min(100, Math.round(100 * e.prises / places)) : 0;\n    return '<button class=\"ev\" data-id=\"' + esc(e.id) + '\"><div class=\"jour\"><b>' + Number(p[2]) + '</b><span>' + MOIS[Number(p[1]) - 1] + ' ' + p[0] + '</span></div>' +\n      '<div><h3>' + esc(e.titre) + '<span class=\"badge ' + esc(e.statut) + '\">' + esc(e.statut) + '</span></h3>' +\n      '<p>' + esc([e.debut && (e.debut + (e.fin ? '–' + e.fin : '')), e.lieu].filter(Boolean).join(' · ')) + '</p></div>' +\n      '<div class=\"jauge\">' + e.prises + (places ? ' / ' + places : '') + ' place' + (e.prises > 1 || places > 1 ? 's' : '') +\n      (places ? '<div class=\"barre\"><i style=\"width:' + pc + '%\"></i></div>' : '') +\n      (droit('publier') ? '<select class=\"statutRapide\" data-id=\"' + esc(e.id) + '\" aria-label=\"Statut\">' + D.statuts.map(function (s) { return '<option' + (s === e.statut ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' : '<div><span class=\"badge ' + esc(e.statut) + '\">' + esc(e.statut) + '</span></div>') + '</div></button>';\n  }).join('') + '</div>';\n}\n\nfunction champ(nom, label, val, type, attrs) {\n  return '<div' + (type === 'textarea' ? ' class=\"large\"' : '') + '><label for=\"f-' + nom + '\">' + label + '</label>' +\n    (type === 'textarea' ? '<textarea id=\"f-' + nom + '\" name=\"' + nom + '\">' + esc(val) + '</textarea>'\n      : '<input id=\"f-' + nom + '\" name=\"' + nom + '\" type=\"' + (type || 'text') + '\" value=\"' + esc(val) + '\" ' + (attrs || '') + '>') + '</div>';\n}\n\nfunction afficherEvenement(id) {\n  var nouveau = id === 'nouveau' || id === 'copie';\n  var e = id === 'nouveau' ? { statut: 'Ouvert', places: '45', lieu: 'Théâtricul', adresse: 'Chêne-Bourg' } : (id === 'copie' ? afficherEvenement.copie : D.evenements.filter(function (x) { return x.id === id; })[0]);\n  if (!e) { ouvert = null; return afficher(); }\n  if (nouveau && !droit('evenements')) { ouvert = null; return afficher(); }\n  var peutModifier = droit('evenements'), peutResa = droit('reservations');\n  var h = '<div class=\"actions\"><button class=\"btn\" id=\"retour\">← Tous les événements</button></div>';\n  h += '<h2>' + (nouveau ? 'Nouvel événement' : esc(e.titre)) + '</h2>';\n  h += '<form id=\"form\" class=\"panneau\"><div class=\"grille\">' +\n    champ('titre', 'Titre affiché', e.titre, 'text', 'required list=\"spectacles\"') +\n    '<datalist id=\"spectacles\">' + D.spectacles.map(function (s) { return '<option value=\"' + esc(s) + '\">'; }).join('') + '</datalist>' +\n    champ('spectacle', 'Spectacle (pour regrouper les séances)', e.spectacle, 'text', 'list=\"spectacles\" placeholder=\"Vide = même que le titre\"') +\n    champ('compagnie', 'Compagnie / artistes', e.compagnie) +\n    champ('date', 'Date', e.date, 'date', 'required') +\n    champ('debut', 'Début', e.debut, 'time') +\n    champ('fin', 'Fin', e.fin, 'time') +\n    champ('duree', 'Durée', e.duree, 'text', 'placeholder=\"50 min\"') +\n    champ('age', 'Âge', e.age, 'text', 'placeholder=\"Dès 6 ans, tout public…\"') +\n    champ('lieu', 'Lieu', e.lieu) +\n    champ('adresse', 'Adresse', e.adresse) +\n    champ('tarif', 'Tarif (texte)', e.tarif, 'text', 'placeholder=\"Prix libre, paiement sur place\"') +\n    champ('places', 'Nombre de places (vide = illimité)', e.places, 'number', 'min=\"0\"') +\n    (droit('publier') ? '<div><label for=\"f-statut\">Statut</label><select id=\"f-statut\" name=\"statut\">' +\n      D.statuts.map(function (s) { return '<option' + (s === e.statut ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +\n      '<p class=\"aide\">Ouvert : réservable. Fermé : affiché sans réservation. Brouillon et Annulé : cachés du site.</p></div>'\n      : '<div><label>Statut</label><p><span class=\"badge ' + esc(e.statut) + '\">' + esc(e.statut || 'Brouillon') + '</span></p><p class=\"aide\">Seul un compte avec le droit « Publier » peut le changer.</p></div>') +\n    '<div class=\"large\"><label>Photos affichées sur le site (la 1re est celle du programme ; sur la fiche, toutes défilent dans l\\'ordre)</label>' +\n    '<div class=\"photos\" id=\"photos\"></div><textarea id=\"f-image\" name=\"image\" hidden>' + esc(e.image) + '</textarea>' +\n    '<p class=\"aide\">← → changent l\\'ordre, « Recadrer » refait le cadrage 3:2. « Ajouter » prend une photo de l\\'ordinateur ou du téléphone ; vous pouvez aussi <button type=\"button\" class=\"btn petit\" id=\"urlPhoto\">coller une adresse</button>. Pensez à enregistrer l\\'événement ensuite.</p>' +\n    '<div class=\"galerie\" id=\"galerie\"></div></div>' +\n    champ('description', 'Description', e.description, 'textarea') +\n    '</div>' + (peutModifier ? '<div class=\"actions\"><button class=\"btn plein\" type=\"submit\">Enregistrer</button>' +\n    (nouveau ? '' : '<button class=\"btn\" type=\"button\" id=\"dupliquer\">Dupliquer (autre date)</button><button class=\"btn danger\" type=\"button\" id=\"supprimer\">Supprimer</button>') +\n    '</div>' : '<p class=\"aide\">Votre compte peut consulter cet événement, pas le modifier.</p>') + '</form>';\n\n  if (!nouveau) h += apercuSite(e);\n  if (!nouveau) {\n    var resas = D.reservations.filter(function (r) { return r.evenement === e.id; });\n    var actives = resas.filter(function (r) { return r.statut !== 'Annulée'; });\n    var total = actives.reduce(function (s, r) { return s + r.places; }, 0);\n    var arrivees = actives.filter(function (r) { return r.arrivee; }).reduce(function (s, r) { return s + r.places; }, 0);\n    h += '<h2>Réservations · ' + total + (Number(e.places) ? ' / ' + e.places : '') + ' places' + (arrivees ? ' · ' + arrivees + ' arrivée' + (arrivees > 1 ? 's' : '') : '') + '</h2><div class=\"panneau\">';\n    if (!peutResa) h += '<p class=\"aide\">' + total + ' place' + (total > 1 ? 's' : '') + ' réservée' + (total > 1 ? 's' : '') + '. Votre compte ne voit pas le détail des réservations.</p></div>';\n    else if (!resas.length) h += '<p class=\"vide\">Pas encore de réservation.</p>';\n    else h += '<div class=\"tableau\"><table><tr><th>Arrivé·e</th><th>Nom</th><th>Places</th><th>Contact</th><th>Message</th><th>Reçue</th><th></th></tr>' +\n      resas.map(function (r) {\n        return '<tr class=\"' + (r.statut === 'Annulée' ? 'annulee' : (r.arrivee ? 'arrivee' : '')) + '\"><td>' + (r.statut === 'Annulée' ? '' : '<input type=\"checkbox\" class=\"arrivee\" data-pointer=\"' + esc(r.id) + '\"' + (r.arrivee ? ' checked' : '') + ' aria-label=\"Arrivé·e\">') + '</td><td>' + esc(r.nom) + '</td><td>' + r.places + '</td><td>' +\n          (r.email ? '<a style=\"color:var(--lav2)\" href=\"mailto:' + esc(r.email) + '\">' + esc(r.email) + '</a>' : '') + (r.telephone ? '<br>' + esc(r.telephone) : '') +\n          '</td><td>' + esc(r.message) + '</td><td>' + esc(r.recue) + '</td><td>' +\n          (r.statut === 'Annulée' ? 'Annulée' : '<button class=\"btn petit danger\" data-annuler=\"' + esc(r.id) + '\">Annuler</button>') + '</td></tr>';\n      }).join('') + '</table></div>';\n    if (peutResa) h += '<div class=\"actions\">' + (actives.length ? '<button class=\"btn\" id=\"copier\">Copier les e-mails</button>' : '') + '</div>';\n    if (peutResa) h += '<h2>Ajouter une réservation à la main</h2><form id=\"ajout\"><div class=\"grille\">' +\n      (champ('nom', 'Nom', '', 'text', 'required') + champ('email', 'E-mail', '', 'email') + champ('telephone', 'Téléphone', '') +\n      champ('places', 'Places', '1', 'number', 'min=\"1\"')).replace(/(id|for)=\"f-/g, '$1=\"a-') +\n      '<div><label><input type=\"checkbox\" name=\"envoyerMail\" style=\"width:auto\"> envoyer l\\'e-mail de confirmation</label></div>' +\n      '</div><div class=\"actions\"><button class=\"btn plein\" type=\"submit\">Ajouter</button></div></form></div>';\n  }\n  $('#vue').innerHTML = h;\n  $('#retour').onclick = function () { ouvert = null; afficher(); };\n  if (peutModifier) photosInit();\n  else { $('#form').querySelectorAll('input,select,textarea').forEach(function (x) { x.disabled = true; }); $('#photos').innerHTML = listePhotos().map(function (u) { return '<div class=\"photo\"><img src=\"' + esc(u) + '\" alt=\"\"></div>'; }).join('') || '<p class=\"aide\">Pas de photo.</p>'; $('#galerie').remove(); }\n  if (!nouveau) apercuInit(e);\n  document.querySelectorAll('[data-pointer]').forEach(function (c) { c.onchange = function () { appel('adminPointer', [c.dataset.pointer, c.checked], function (res) { recharger(res); }); }; });\n  if (!peutModifier) return;\n  $('#form').onsubmit = function (ev) {\n    ev.preventDefault();\n    var o = { id: nouveau ? '' : e.id };\n    new FormData(ev.target).forEach(function (v, k) { o[k] = v; });\n    appel('adminEnregistrerEvenement', [o], function (res) { recharger(res); ouvert = null; afficher(); toast('Enregistré'); });\n  };\n  if (nouveau) return;\n  if (!peutResa && $('#ajout')) $('#ajout').remove();\n  $('#dupliquer').onclick = function () {\n    var c = {}; Object.keys(e).forEach(function (k) { c[k] = e[k]; }); c.id = ''; c.date = '';\n    afficherEvenement.copie = c; ouvert = 'copie'; afficher(); toast('Copie : choisissez la nouvelle date');\n  };\n  $('#supprimer').onclick = function () {\n    if (!confirm('Supprimer « ' + e.titre + ' » ?')) return;\n    appel('adminSupprimerEvenement', [e.id], function (res) { ouvert = null; recharger(res); toast('Supprimé'); });\n  };\n  document.querySelectorAll('[data-annuler]').forEach(function (b) {\n    b.onclick = function () {\n      if (!confirm('Annuler cette réservation ?')) return;\n      var prevenir = confirm('Prévenir la personne par e-mail ?');\n      appel('adminAnnulerReservation', [b.dataset.annuler, prevenir], function (res) { recharger(res); toast('Réservation annulée'); });\n    };\n  });\n  var cp = $('#copier');\n  if (cp) cp.onclick = function () {\n    var mails = actives.map(function (r) { return r.email; }).filter(Boolean).join(', ');\n    (navigator.clipboard ? navigator.clipboard.writeText(mails) : Promise.reject()).then(function () { toast('E-mails copiés'); }, function () { prompt('E-mails :', mails); });\n  };\n  $('#ajout').onsubmit = function (ev) {\n    ev.preventDefault();\n    var o = { evenement: e.id };\n    new FormData(ev.target).forEach(function (v, k) { o[k] = v; });\n    o.envoyerMail = !!o.envoyerMail;\n    appel('adminAjouterReservation', [o], function (res) { recharger(res); toast('Réservation ajoutée'); });\n  };\n}\n\nfunction afficherReglages() {\n  var r = D.reglages, h = '';\n  if (droit('reglages')) h += '<h2>Réglages</h2><form id=\"regl\" class=\"panneau\"><div class=\"grille\">' +\n    champ('nomFestival', 'Nom du festival (signature des e-mails)', r.nomFestival) +\n    champ('siteUrl', 'Adresse du site (pour les aperçus)', r.siteUrl, 'url') +\n    champ('copieA', 'Adresse qui reçoit une copie de chaque réservation', r.copieA, 'email') +\n    champ('sujet', 'Sujet de la confirmation', r.sujet) +\n    champ('message', 'Message de confirmation', r.message, 'textarea') +\n    champ('sujetAnnulation', 'Sujet de l\\'annulation', r.sujetAnnulation) +\n    champ('messageAnnulation', 'Message d\\'annulation', r.messageAnnulation, 'textarea') +\n    '</div><p class=\"aide\">Remplacés automatiquement : {nom} {places} {titre} {date} {heure} {lieu} {tarif} {festival}</p>' +\n    '<div class=\"actions\"><button class=\"btn plein\" type=\"submit\">Enregistrer</button><button class=\"btn\" type=\"button\" id=\"essai\">M\\'envoyer un essai</button></div></form>';\n  if (droit('comptes')) h += '<h2 id=\"comptes\">Comptes et codes PIN</h2><div class=\"panneau\" id=\"zoneComptes\"><p class=\"vide\">Chargement…</p></div>';\n  $('#vue').innerHTML = h;\n  if ($('#regl')) {\n    $('#regl').onsubmit = function (ev) {\n      ev.preventDefault();\n      var o = {}; new FormData(ev.target).forEach(function (v, k) { o[k] = v; });\n      appel('adminEnregistrerReglages', [o], function (res) { recharger(res); toast('Enregistré'); });\n    };\n    $('#essai').onclick = function () { appel('adminEssaiMail', [], function (t) { toast(t); }); };\n  }\n  if ($('#zoneComptes')) appel('adminListerComptes', [], comptesAfficher);\n}\n\n// ---------- Comptes : un code PIN par personne, avec ses droits ----------\nfunction comptesAfficher(res) {\n  var z = $('#zoneComptes'); if (!z) return;\n  var lien = res.lien || location.href.split('?')[0].replace(/gestion\\.html$/, '');\n  var h = '<p class=\"aide\">Chaque personne reçoit le lien de l\\'appli et son code PIN ; l\\'appli s\\'ouvre avec le code, puis se met sur l\\'écran d\\'accueil du téléphone. Commencez par votre propre compte, avec tous les droits.</p>';\n  if (!res.comptes.length) h += '<p class=\"vide\">Aucun compte pour l\\'instant.</p>';\n  res.comptes.forEach(function (c) {\n    var dr = res.droits.filter(function (d) { return c.droits && c.droits[d[0]]; }).map(function (d) { return d[1].split(' :')[0]; });\n    h += '<div class=\"compte\"><div class=\"qui\"><b>' + esc(c.nom) + '</b><p>' + (dr.length === res.droits.length ? 'Tous les droits' : (dr.join(', ') || 'Aucun droit')) + '</p></div>' +\n      '<div class=\"actions\"><button type=\"button\" class=\"btn petit plein\" data-partager=\"' + esc(c.id) + '\">Partager l\\'appli</button><button type=\"button\" class=\"btn petit\" data-modifier=\"' + esc(c.id) + '\">Modifier</button><button type=\"button\" class=\"btn petit danger\" data-supprimer=\"' + esc(c.id) + '\">Supprimer</button></div></div>';\n  });\n  h += '<div class=\"actions\"><button type=\"button\" class=\"btn plein\" id=\"nouveauCompte\">+ Nouveau compte</button></div><div id=\"formCompte\"></div>';\n  z.innerHTML = h;\n  function formulaire(c) {\n    c = c || { nom: '', droits: {} };\n    $('#formCompte').innerHTML = '<form id=\"fCompte\" class=\"panneau\"><h3 style=\"margin:0 0 10px\">' + (c.id ? 'Modifier « ' + esc(c.nom) + ' »' : 'Nouveau compte') + '</h3><div class=\"grille\">' +\n      champ('c-nom', 'Prénom ou nom', c.nom, 'text', 'required placeholder=\"Ex. Léa (billetterie)\"').replace(/f-c-nom/g, 'c-nom') +\n      '<div><label for=\"c-pin\">Code PIN (4 à 8 chiffres' + (c.id ? ', vide = inchangé' : '') + ')</label><div style=\"display:flex;gap:6px\"><input id=\"c-pin\" name=\"pin\" inputmode=\"numeric\" pattern=\"[0-9]{4,8}\" maxlength=\"8\" autocomplete=\"off\"' + (c.id ? '' : ' required') + '><button type=\"button\" class=\"btn petit\" id=\"proposerPin\">Proposer</button></div></div>' +\n      '</div><div class=\"coches\" style=\"margin-top:10px\">' + res.droits.map(function (d) { return '<label><input type=\"checkbox\" name=\"d-' + d[0] + '\"' + (c.droits && c.droits[d[0]] ? ' checked' : '') + '> <span><b>' + esc(d[1].split(' :')[0]) + '</b> :' + esc(d[1].split(' :').slice(1).join(' :')) + '</span></label>'; }).join('') + '</div>' +\n      '<div class=\"actions\"><button class=\"btn plein\" type=\"submit\">' + (c.id ? 'Enregistrer' : 'Créer le compte') + '</button><button class=\"btn\" type=\"button\" id=\"annulerCompte\">Annuler</button></div></form>';\n    $('#proposerPin').onclick = function () { var p = ''; for (var i = 0; i < 6; i++) p += Math.floor(Math.random() * 10); $('#c-pin').value = p; $('#c-pin').type = 'text'; };\n    $('#annulerCompte').onclick = function () { $('#formCompte').innerHTML = ''; };\n    $('#fCompte').onsubmit = function (ev) {\n      ev.preventDefault();\n      var o = { id: c.id || '', nom: $('#c-nom').value, pin: $('#c-pin').value.trim(), droits: {} };\n      res.droits.forEach(function (d) { o.droits[d[0]] = $('#fCompte [name=\"d-' + d[0] + '\"]').checked; });\n      appel('adminEnregistrerCompte', [o], function (r2) {\n        comptesAfficher(r2); toast(c.id ? 'Compte modifié' : 'Compte créé');\n        if (o.pin) { var nc = r2.comptes.filter(function (x) { return x.nom === o.nom; }).pop(); if (nc) partager(nc, o.pin, lien); }\n      });\n    };\n    $('#formCompte').scrollIntoView({ behavior: 'smooth', block: 'nearest' });\n  }\n  $('#nouveauCompte').onclick = function () { formulaire(); };\n  z.querySelectorAll('[data-modifier]').forEach(function (b) { b.onclick = function () { formulaire(res.comptes.filter(function (x) { return x.id === b.dataset.modifier; })[0]); }; });\n  z.querySelectorAll('[data-supprimer]').forEach(function (b) { b.onclick = function () {\n    var c = res.comptes.filter(function (x) { return x.id === b.dataset.supprimer; })[0];\n    if (!confirm('Supprimer le compte de « ' + c.nom + ' » ? Son code PIN ne marchera plus.')) return;\n    appel('adminSupprimerCompte', [c.id], function (r2) { comptesAfficher(r2); toast('Compte supprimé'); });\n  }; });\n  z.querySelectorAll('[data-partager]').forEach(function (b) { b.onclick = function () {\n    var c = res.comptes.filter(function (x) { return x.id === b.dataset.partager; })[0];\n    var pin = prompt('Le code PIN de ' + c.nom + ' n\\'est pas gardé en clair : tapez-le pour l\\'inclure dans le message (ou laissez vide pour envoyer seulement le lien).');\n    if (pin === null) return;\n    partager(c, pin.trim(), lien);\n  }; });\n}\nfunction partager(c, pin, lien) {\n  var texte = 'Bonjour ' + c.nom + ' ! Voici l\\'appli « ' + (D.reglages.nomFestival || 'Festival') + ' » : ' + lien + (pin ? '\\nTon code PIN : ' + pin : '') +\n    '\\nOuvre le lien, entre le code, puis ajoute l\\'appli à l\\'écran d\\'accueil (Safari : Partager → « Sur l\\'écran d\\'accueil » ; Android : menu ⋮ → « Ajouter à l\\'écran d\\'accueil »).';\n  var h = '<div class=\"panneau\" id=\"boitePartage\"><h3 style=\"margin:0 0 8px\">Envoyer à ' + esc(c.nom) + '</h3><textarea readonly style=\"min-height:130px\" id=\"textePartage\">' + esc(texte) + '</textarea><div class=\"actions\">' +\n    (navigator.share ? '<button type=\"button\" class=\"btn plein\" id=\"partagerNatif\">Partager…</button>' : '') +\n    '<a class=\"btn\" target=\"_blank\" rel=\"noopener\" href=\"https://wa.me/?text=' + encodeURIComponent(texte) + '\">WhatsApp</a>' +\n    '<a class=\"btn\" href=\"mailto:?subject=' + encodeURIComponent('Appli « ' + (D.reglages.nomFestival || 'Festival') + ' »') + '&body=' + encodeURIComponent(texte) + '\">E-mail</a>' +\n    '<button type=\"button\" class=\"btn\" id=\"copierPartage\">Copier</button><button type=\"button\" class=\"btn\" id=\"fermerPartage\">Fermer</button></div>' +\n    '<p class=\"aide\">Le code PIN ne s\\'affiche qu\\'ici : notez-le ou envoyez-le tout de suite.</p></div>';\n  $('#formCompte').innerHTML = h; $('#boitePartage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });\n  if ($('#partagerNatif')) $('#partagerNatif').onclick = function () { navigator.share({ text: texte }).catch(function () {}); };\n  $('#copierPartage').onclick = function () { var t = $('#textePartage'); t.select(); try { navigator.clipboard.writeText(texte); } catch (e) { document.execCommand('copy'); } toast('Copié'); };\n  $('#fermerPartage').onclick = function () { $('#formCompte').innerHTML = ''; };\n}\n\n// ---------- Photos d'un événement : liste, ordre, recadrage ----------\nfunction listePhotos() { return $('#f-image').value.split(/\\s*[\\n,]\\s*/).filter(Boolean); }\nfunction ecrirePhotos(l) { $('#f-image').value = l.join('\\n'); photosAfficher(); galerieAfficher(); }\nfunction photosAfficher() {\n  var l = listePhotos();\n  $('#photos').innerHTML = l.map(function (u, i) {\n    return '<div class=\"photo\"><img src=\"' + esc(u) + '\" alt=\"\" loading=\"lazy\"><span class=\"num\">' + (i + 1) + '</span><div class=\"outils\">' +\n      '<button type=\"button\" data-bouger=\"' + i + ',-1\" title=\"Avancer\"' + (i ? '' : ' disabled') + '>←</button>' +\n      '<button type=\"button\" data-bouger=\"' + i + ',1\" title=\"Reculer\"' + (i < l.length - 1 ? '' : ' disabled') + '>→</button>' +\n      '<button type=\"button\" data-recadrer=\"' + esc(u) + '\" data-index=\"' + i + '\">Recadrer</button>' +\n      '<button type=\"button\" data-retirer=\"' + i + '\">Retirer</button></div></div>';\n  }).join('') + '<button type=\"button\" class=\"ajout\" id=\"ajoutPhoto\">+ Ajouter</button>';\n  $('#photos').querySelectorAll('[data-retirer]').forEach(function (b) { b.onclick = function () { var l = listePhotos(); l.splice(+b.dataset.retirer, 1); ecrirePhotos(l); }; });\n  $('#photos').querySelectorAll('[data-bouger]').forEach(function (b) { b.onclick = function () {\n    var a = b.dataset.bouger.split(','), i = +a[0], j = i + (+a[1]), l = listePhotos(); if (j < 0 || j >= l.length) return;\n    var x = l[i]; l[i] = l[j]; l[j] = x; ecrirePhotos(l);\n  }; });\n  $('#photos').querySelectorAll('[data-recadrer]').forEach(function (b) { b.onclick = function () {\n    var i = +b.dataset.index;\n    recadrerUrl(b.dataset.recadrer, ($('#f-titre').value || 'photo'), function (url) { var l = listePhotos(); l[i] = url; ecrirePhotos(l); toast('Photo recadrée : pensez à enregistrer l\\'événement'); });\n  }; });\n  $('#ajoutPhoto').onclick = function () { $('#fichierPhoto').value = ''; $('#fichierPhoto').click(); };\n}\n\n// ---------- Galerie : toutes les photos (fichier du site + dossier Drive), par spectacle ----------\nvar PHOTOS_DRIVE = null;\nfunction chargerSite(ok) {\n  if (window.SPECTACLES || !siteUrl()) return ok();\n  var sc = document.createElement('script'); sc.src = siteUrl() + 'festival.js?' + Date.now(); sc.onload = ok; sc.onerror = function () { ok(); }; document.head.appendChild(sc);\n}\nfunction chargerDrive(ok, force) {\n  if (PHOTOS_DRIVE && !force) return ok();\n  appel('adminListerPhotos', [], function (l) { PHOTOS_DRIVE = l || []; ok(); });\n}\nfunction normTitre(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }\nfunction titresConnus() {\n  var l = Object.keys(window.SPECTACLES || {}); (D.spectacles || []).forEach(function (s) { if (!l.some(function (k) { return normTitre(k) === normTitre(s); })) l.push(s); }); return l;\n}\nfunction titreDe(nom) { // « Titre · 3 » ou « Titre 3 » → titre connu\n  var n = normTitre(String(nom).split(' · ')[0]), l = titresConnus().slice().sort(function (a, b) { return b.length - a.length; });\n  for (var i = 0; i < l.length; i++) { var k = normTitre(l[i]); if (n === k || n.indexOf(k + ' ') === 0) return l[i]; }\n  return '';\n}\nfunction idDrive(u) { var m = /drive\\.google\\.com\\/(?:thumbnail\\?id=|uc\\?id=|file\\/d\\/)([\\w-]+)/.exec(u || ''); return m ? m[1] : ''; }\n// Toutes les photos connues : { titre, url, credit, origine: 'site'|'drive', id, surSite }\nfunction toutesPhotos() {\n  var l = [], SP = window.SPECTACLES || {}, utilisees = {};\n  D.evenements.forEach(function (e) { String(e.image || '').split(/\\s*[\\n,]\\s*/).forEach(function (u) { if (u) utilisees[u.split('/').pop()] = true; }); });\n  Object.keys(SP).forEach(function (k) {\n    var s = SP[k], aff = (s.photos || (s.photo ? [{ src: s.photo, credit: s.credit }] : []));\n    aff.forEach(function (p) { l.push({ titre: k, url: siteUrl() + p.src, credit: p.credit || '', origine: 'site', surSite: true }); });\n    (s.banque || []).forEach(function (p) { l.push({ titre: k, url: siteUrl() + p.src, credit: p.credit || '', origine: 'site', surSite: false }); });\n  });\n  (PHOTOS_DRIVE || []).forEach(function (f) { l.push({ titre: titreDe(f.nom), nom: f.nom, url: f.url, credit: '', origine: 'drive', id: f.id, surSite: !!utilisees[f.url.split('/').pop()] }); });\n  return l;\n}\nfunction cartePhoto(p, boutons) {\n  var portrait = /affiche|visuel|gerard-[1-6]\\b|-z[15]\\.|facteur-cheval-[245]\\.|ma-vie-3|hans-boude|hans-pepite|gaza-/.test(p.url);\n  return '<div class=\"photo' + (portrait ? ' portrait' : '') + '\" title=\"' + esc(p.credit || p.nom || '') + '\"><img src=\"' + esc(p.url) + '\" alt=\"\" loading=\"lazy\">' +\n    (p.surSite ? '<span class=\"etiquette\">Sur le site</span>' : (p.origine === 'drive' ? '<span class=\"etiquette drive\">Drive</span>' : '')) +\n    '<div class=\"outils\">' + boutons + '</div></div>';\n}\nfunction galerieAfficher() {\n  var z = $('#galerie'); if (!z) return;\n  chargerSite(function () { chargerDrive(function () {\n    var cible = normTitre($('#f-spectacle').value || $('#f-titre').value), prises = listePhotos();\n    var toutes = toutesPhotos(), pour = toutes.filter(function (p) { return normTitre(p.titre) === cible; }), autres = toutes.filter(function (p) { return normTitre(p.titre) !== cible; });\n    function boutons(p) {\n      var deja = prises.some(function (u) { return u === p.url || u.split('/').pop() === p.url.split('/').pop(); });\n      return (deja ? '<span style=\"color:var(--vert);font-size:12px;padding:3px 5px\">✓ Utilisée</span>' : '<button type=\"button\" data-utiliser=\"' + esc(p.url) + '\">+ Utiliser</button>') +\n        '<button type=\"button\" data-recadrer-g=\"' + esc(p.url) + '\">Recadrer</button>';\n    }\n    var h = '<h4>Galerie · pour « ' + esc($('#f-spectacle').value || $('#f-titre').value) + ' » (' + pour.length + ')</h4>';\n    h += pour.length ? '<div class=\"photos\">' + pour.map(function (p) { return cartePhoto(p, boutons(p)); }).join('') + '</div>'\n      : '<p class=\"aide\">Aucune photo dans la galerie pour ce titre. Ajoutez-en dans l\\'onglet Photos, ou vérifiez l\\'orthographe du titre.</p>';\n    var groupes = {}; autres.forEach(function (p) { (groupes[p.titre || 'Sans spectacle'] = groupes[p.titre || 'Sans spectacle'] || []).push(p); });\n    h += '<details><summary>Toutes les autres photos de la galerie (' + autres.length + ')</summary>' + Object.keys(groupes).sort().map(function (k) {\n      return '<h4>' + esc(k) + '</h4><div class=\"photos\">' + groupes[k].map(function (p) { return cartePhoto(p, boutons(p)); }).join('') + '</div>';\n    }).join('') + '</details>';\n    z.innerHTML = h;\n    z.querySelectorAll('[data-utiliser]').forEach(function (b) { b.onclick = function () { ecrirePhotos(listePhotos().concat([b.dataset.utiliser])); }; });\n    z.querySelectorAll('[data-recadrer-g]').forEach(function (b) { b.onclick = function () {\n      recadrerUrl(b.dataset.recadrerG, ($('#f-titre').value || 'photo'), function (url) { ecrirePhotos(listePhotos().concat([url])); toast('Photo recadrée et ajoutée : pensez à enregistrer'); });\n    }; });\n  }); });\n}\nfunction photosInit() {\n  if (!$('#photos')) return;\n  photosAfficher(); galerieAfficher();\n  $('#f-titre').onchange = $('#f-spectacle').onchange = galerieAfficher;\n  $('#urlPhoto').onclick = function () { var u = prompt('Adresse de l\\'image (https://…) :'); if (u && /^https?:\\/\\//.test(u.trim())) ecrirePhotos(listePhotos().concat([u.trim()])); };\n  $('#fichierPhoto').onchange = function () { var f = this.files[0]; if (f) recadrer(f, function (base64) {\n    envoyerImage(($('#f-titre').value || 'photo'), base64, function (r) { ecrirePhotos(listePhotos().concat([r.url])); toast('Photo ajoutée : pensez à enregistrer l\\'événement'); });\n  }); };\n}\nfunction envoyerImage(titre, base64, ok) {\n  toast('Envoi de la photo…');\n  appel('adminEnregistrerImage', [{ nom: titre + ' · ' + new Date().toISOString().slice(0, 16).replace('T', ' '), base64: base64 }], function (r) { PHOTOS_DRIVE = null; ok(r); });\n}\n// Récupère une photo existante (site ou Drive) pour la recadrer, puis l'enregistre comme nouvelle photo.\nfunction recadrerUrl(url, titre, ok) {\n  var id = idDrive(url);\n  function suite(blob) { recadrer(blob, function (base64) { envoyerImage(titre, base64, function (r) { ok(r.url); }); }); }\n  function rate() { toast('Impossible de lire cette photo pour la recadrer.', true); }\n  if (id) appel('adminLireImage', [id], function (r) { fetch(r.base64).then(function (x) { return x.blob(); }).then(suite).catch(rate); });\n  else fetch(url, { mode: 'cors' }).then(function (x) { if (!x.ok) throw 0; return x.blob(); }).then(suite).catch(rate);\n}\n// Réduit une photo (max 1600 px) sans la recadrer, pour la galerie.\nfunction reduire(fichier, ok) {\n  var charge = window.createImageBitmap ? createImageBitmap(fichier, { imageOrientation: 'from-image' }) : Promise.reject();\n  charge.catch(function () { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = URL.createObjectURL(fichier); }); })\n    .then(function (im) {\n      var k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);\n      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.85));\n    }).catch(function () { toast('Photo illisible : ' + fichier.name, true); });\n}\n\n// ---------- Onglet Photos : la galerie complète ----------\nfunction afficherPhotos() {\n  $('#vue').innerHTML = '<p class=\"vide\">Chargement de la galerie…</p>';\n  chargerSite(function () { chargerDrive(function () {\n    var toutes = toutesPhotos(), groupes = {}, titres = titresConnus();\n    toutes.forEach(function (p) { (groupes[p.titre || 'Sans spectacle'] = groupes[p.titre || 'Sans spectacle'] || []).push(p); });\n    var h = '<div class=\"panneau\"><div class=\"grille\"><div><label for=\"g-titre\">Spectacle</label><select id=\"g-titre\">' + titres.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '<option value=\"\">Sans spectacle</option></select></div>' +\n      '<div><label>&nbsp;</label><button type=\"button\" class=\"btn plein\" id=\"ajoutGalerie\">+ Ajouter des photos à la galerie</button></div></div>' +\n      '<p class=\"aide\">Les photos ajoutées ici sont rangées dans le Drive du festival (dossier « ' + esc('Petit Festival · photos du site') + ' »), sans recadrage. On choisit ensuite, dans chaque événement, lesquelles afficher, dans quel ordre, et on les recadre si besoin. Les photos marquées « Sur le site » sont déjà affichées.</p></div>';\n    Object.keys(groupes).sort(function (a, b) { return a.localeCompare(b, 'fr'); }).forEach(function (k) {\n      h += '<div class=\"groupe\"><h3>' + esc(k) + ' <span class=\"badge\">' + groupes[k].length + '</span></h3><div class=\"photos\">' + groupes[k].map(function (p) {\n        return cartePhoto(p, '<a href=\"' + esc(p.url) + '\" target=\"_blank\" rel=\"noopener\" style=\"color:var(--texte);font:600 12px Barlow,sans-serif;padding:3px 5px;text-decoration:none\">Voir</a>' +\n          (p.origine === 'drive' ? '<button type=\"button\" data-suppr=\"' + esc(p.id) + '\">Supprimer</button>' : '<span style=\"font-size:11px;color:var(--doux);padding:3px 5px\">fichier du site</span>'));\n      }).join('') + '</div></div>';\n    });\n    if (!toutes.length) h += '<p class=\"vide\">Aucune photo pour l\\'instant.</p>';\n    $('#vue').innerHTML = h;\n    $('#ajoutGalerie').onclick = function () { $('#fichiersGalerie').value = ''; $('#fichiersGalerie').click(); };\n    $('#fichiersGalerie').onchange = function () {\n      var fichiers = Array.prototype.slice.call(this.files), titre = $('#g-titre').value || 'photo', n = 0;\n      if (!fichiers.length) return;\n      (function suivant() {\n        if (n >= fichiers.length) { toast(fichiers.length + ' photo' + (fichiers.length > 1 ? 's' : '') + ' ajoutée' + (fichiers.length > 1 ? 's' : '')); return chargerDrive(afficherPhotos, true); }\n        reduire(fichiers[n++], function (base64) { appel('adminEnregistrerImage', [{ nom: titre + ' · ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' ' + n, base64: base64 }], suivant); });\n      })();\n    };\n    document.querySelectorAll('[data-suppr]').forEach(function (b) { b.onclick = function () {\n      if (!confirm('Supprimer cette photo du Drive ? Si un événement l\\'affiche, elle disparaîtra du site.')) return;\n      appel('adminSupprimerPhoto', [b.dataset.suppr], function () { toast('Photo supprimée'); chargerDrive(afficherPhotos, true); });\n    }; });\n  }); });\n}\n\n// Recadrage : la photo se déplace au doigt ou à la souris, le curseur zoome ; le cadre est au format 3:2 du site.\nfunction recadrer(fichier, ok) {\n  var boite = $('#recadrage'), cv = $('#cv'), ctx = cv.getContext('2d'), zoom = $('#zoom');\n  var img, base, s, ox, oy, W = 900, H = 600;\n  cv.width = W; cv.height = H;\n  var charge = window.createImageBitmap ? createImageBitmap(fichier, { imageOrientation: 'from-image' }).catch(function () { return chargerImage(fichier); }) : chargerImage(fichier);\n  charge.then(function (im) {\n    img = im; base = Math.max(W / im.width, H / im.height); s = base; zoom.value = 1;\n    ox = (W - im.width * s) / 2; oy = (H - im.height * s) / 2; dessiner(); boite.classList.add('ouvert');\n  });\n  function chargerImage(f) { return new Promise(function (res, rej) { var u = URL.createObjectURL(f), i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = u; }); }\n  function borner() { ox = Math.min(0, Math.max(W - img.width * s, ox)); oy = Math.min(0, Math.max(H - img.height * s, oy)); }\n  function dessiner() { borner(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, ox, oy, img.width * s, img.height * s); }\n  zoom.oninput = function () { var ns = base * zoom.value, cx = W / 2, cy = H / 2; ox = cx - (cx - ox) * ns / s; oy = cy - (cy - oy) * ns / s; s = ns; dessiner(); };\n  var drag = null;\n  cv.onpointerdown = function (ev) { drag = { x: ev.clientX, y: ev.clientY, ox: ox, oy: oy }; cv.setPointerCapture(ev.pointerId); };\n  cv.onpointermove = function (ev) { if (!drag) return; var k = W / cv.clientWidth; ox = drag.ox + (ev.clientX - drag.x) * k; oy = drag.oy + (ev.clientY - drag.y) * k; dessiner(); };\n  cv.onpointerup = cv.onpointercancel = function () { drag = null; };\n  $('#recadrerOk').onclick = function () {\n    var out = document.createElement('canvas'), f = 1600 / W; out.width = 1600; out.height = 1067;\n    var c = out.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, out.width, out.height); c.drawImage(img, ox * f, oy * f, img.width * s * f, img.height * s * f);\n    boite.classList.remove('ouvert'); ok(out.toDataURL('image/jpeg', 0.85));\n  };\n  $('#recadrerNon').onclick = function () { boite.classList.remove('ouvert'); };\n}\n\n// ---------- Aperçu du site ----------\nfunction siteUrl() { var u = (D.reglages.siteUrl || '').trim(); return u ? u.replace(/\\/?$/, '/') : ''; }\nfunction apercuSite(e) {\n  if (!siteUrl()) return '<h2>Aperçu sur le site</h2><div class=\"panneau\"><p class=\"aide\">Indiquez l\\'adresse du site dans les réglages pour voir les aperçus ici.</p></div>';\n  return '<h2>Aperçu sur le site</h2><div class=\"panneau apercu\" id=\"apercu\"><div class=\"onglets\">' +\n    '<button type=\"button\" class=\"btn petit on\" data-page=\"programme.html#' + esc(e.id) + '\">Fiche du spectacle</button>' +\n    '<button type=\"button\" class=\"btn petit\" data-page=\"programme.html#jour-' + esc(e.date) + '\">Journée du ' + esc(e.date.split('-').reverse().join('.')) + '</button>' +\n    '<button type=\"button\" class=\"btn petit\" data-page=\"programme.html\">Programme</button>' +\n    '<button type=\"button\" class=\"btn petit\" data-page=\"\">Accueil</button>' +\n    '<button type=\"button\" class=\"btn petit\" id=\"tel\">Téléphone</button>' +\n    '<a class=\"btn petit\" id=\"ouvrirSite\" href=\"' + esc(siteUrl() + 'programme.html#' + e.id) + '\" target=\"_blank\" rel=\"noopener\">Ouvrir dans un onglet</a></div>' +\n    '<p class=\"aide\">' + (e.statut === 'Ouvert' || e.statut === 'Fermé' ? 'L\\'aperçu montre ce qui est enregistré : après une modification, enregistrez puis rechargez l\\'aperçu.' : 'Cet événement est « ' + esc(e.statut) + ' » : il n\\'apparaît pas sur le site tant qu\\'il n\\'est pas Ouvert ou Fermé.') + '</p>' +\n    '<div class=\"cadre\"><iframe id=\"cadreSite\" src=\"' + esc(siteUrl() + 'programme.html#' + e.id) + '\" title=\"Aperçu du site\" loading=\"lazy\"></iframe></div></div>';\n}\nfunction apercuInit(e) {\n  var a = $('#apercu'); if (!a) return;\n  a.querySelectorAll('[data-page]').forEach(function (b) {\n    b.onclick = function () {\n      a.querySelectorAll('[data-page]').forEach(function (x) { x.classList.toggle('on', x === b); });\n      var u = siteUrl() + b.dataset.page; $('#ouvrirSite').href = u;\n      var f = $('#cadreSite'); f.src = 'about:blank'; setTimeout(function () { f.src = u; }, 50);\n    };\n  });\n  $('#tel').onclick = function () { a.classList.toggle('tel'); $('#tel').classList.toggle('on'); };\n}\n\nappel('adminCharger', [], recharger);\n</script>\n</body>\n</html>\n";
