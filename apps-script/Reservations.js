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
  adminListerComptes: 'comptes', adminEnregistrerCompte: 'comptes', adminSupprimerCompte: 'comptes'
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
