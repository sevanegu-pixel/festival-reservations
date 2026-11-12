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
  'Description', 'Tarif', 'Places', 'Statut', 'Image', 'Créé le', 'Liste d\'attente', 'Texte long', 'Distribution', 'Vidéo',
  'Réservations envoyées à', 'Copie au festival', 'Réponses à cette adresse', 'Options de réservation', 'E-mails (exceptions)'];
var CHAMPS_EV = ['id', 'titre', 'spectacle', 'compagnie', 'date', 'debut', 'fin', 'duree', 'age', 'lieu', 'adresse',
  'description', 'tarif', 'places', 'statut', 'image', 'cree', 'attente', 'long', 'distribution', 'video',
  'renvoi', 'renvoiCopie', 'renvoiReponses', 'options', 'mailsEv'];

// Adresse de l'appli de gestion (page GitHub installable comme une icône, ordinateur et téléphone)
var GESTION_URL = 'https://sevanegu-pixel.github.io/festival-reservations/';
var COL_RES = ['id', 'Événement (id)', 'Événement', 'Reçue le', 'Nom', 'E-mail', 'Téléphone', 'Places', 'Message', 'Statut', 'Arrivée', 'Options'];
var CHAMPS_RES = ['id', 'evenement', 'titreEvenement', 'recue', 'nom', 'email', 'telephone', 'places', 'message', 'statut', 'arrivee', 'options'];

// ----- Options de réservation, créées par événement dans l'appli -----
// case : case à cocher en plus (ex. « Billet + livre ») ; contingent : places réservées à un groupe (ex. « Société des écrivains »).
function optionsEv_(ev) {
  var l = [];
  try { l = JSON.parse((ev && ev.options) || '[]') || []; } catch (e) { l = []; }
  if (!Array.isArray(l)) return [];
  return l.map(function (o) {
    return { id: String(o.id || '').replace(/[^\w-]/g, '').slice(0, 20), type: o.type === 'contingent' ? 'contingent' : 'case',
      nom: String(o.nom || '').trim().slice(0, 80), aide: String(o.aide || '').trim().slice(0, 300), mail: String(o.mail || '').trim().slice(0, 600), places: Math.max(0, Math.floor(Number(o.places) || 0)) };
  }).filter(function (o) { return o.id && o.nom; });
}
function nomsOptions_(r) { return String((r && r.options) || '').split(' · ').map(function (x) { return x.trim(); }).filter(String); }
/** Places prises par option (contingents) pour chaque événement : { evId: { nomOption: places } }. */
function prisesParOption_(resas) {
  var p = {};
  (resas || lireReservations_()).forEach(function (r) {
    if (r.statut === 'Annulée' || r.statut === 'Liste d\'attente') return;
    nomsOptions_(r).forEach(function (n) { p[r.evenement] = p[r.evenement] || {}; p[r.evenement][n] = (p[r.evenement][n] || 0) + r.places; });
  });
  return p;
}
/** Places libres pour le public (sans contingent) et pour chaque contingent. */
function disponibilites_(ev, prises, parOption) {
  var max = Number(ev.places) || 0, opts = optionsEv_(ev), reserve = 0, c = {};
  opts.forEach(function (o) {
    if (o.type !== 'contingent') return;
    var pris = (parOption && parOption[o.nom]) || 0;
    reserve += Math.max(0, o.places - pris);
    c[o.id] = Math.max(0, Math.min(o.places - pris, max > 0 ? max - prises : 1e9));
  });
  return { publiques: max > 0 ? Math.max(0, max - prises - reserve) : null, contingents: c, max: max };
}

// Statuts d'un événement : Ouvert (réservable), Fermé (affiché, sans réservation), Brouillon (caché), Annulé (caché)
var STATUTS_EV = ['Ouvert', 'Fermé', 'Brouillon', 'Annulé'];

var REGLAGES_DEFAUT = {
  nomFestival: 'Le Petit Festival au Théâtricul',
  siteUrl: 'https://ptit-festival.ch/apercu/',
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
  sujetLiberee: 'Une place s\'est libérée : {titre}',
  messageLiberee: 'Bonjour {nom},\n\nBonne nouvelle : une place s\'est libérée ! Votre réservation de {places} place(s) pour « {titre} », le {date} à {heure}, {lieu}, est maintenant confirmée.\n\n' +
    'Le paiement se fait sur place. Si vous ne pouvez plus venir, répondez simplement à cet e-mail pour que quelqu\'un d\'autre en profite.\n\nÀ très vite !\n{festival}',
  sujetRappel: 'C\'est demain : {titre}',
  messageRappel: 'Bonjour {prenom},\n\nPetit rappel : nous vous attendons pour « {titre} », le {date} à {heure}, {lieu}.\n\n' +
    'La buvette ouvre une heure avant le spectacle. Le paiement se fait sur place ({tarif}).\n\nSi vous ne pouvez plus venir, répondez à cet e-mail : votre place fera un·e heureux·se sur la liste d\'attente.\n\nÀ demain !\n{festival}',
  sujetEvenementAnnule: 'Important : {titre} du {date}',
  messageEvenementAnnule: 'Bonjour {nom},\n\nNous sommes désolés : la représentation de « {titre} » prévue le {date} à {heure} ne pourra pas avoir lieu comme prévu.\n\n' +
    '**Nous vous proposons…** (à compléter : nouvelle date, remboursement, autre spectacle)\n\nRépondez à cet e-mail pour toute question, nous vous répondrons vite.\n\n{festival}',
  sujetMerci: 'Merci d\'être venu·e !',
  messageMerci: 'Bonjour {prenom},\n\nMerci d\'être venu·e voir « {titre} » hier soir. Nous espérons que la soirée vous a plu !\n\n' +
    'Le festival continue : tout le programme est sur {site}. Et si vous avez envie de nous dire un mot sur le spectacle, répondez simplement à cet e-mail.\n\nÀ bientôt au Théâtricul,\n{festival}',
  piedDePage: '{festival}\n{adresse}\n{site}\nPour toute question, répondez simplement à cet e-mail.',
  piedStyle: 'simple',
  instagram: '',
  facebook: '',
  billet: 'Oui',
  optionsMail: '{}',
  formulaire: '{}',
};

/**
 * Formulaire de réservation du site, réglé dans l'appli (Réglages) : champs demandés, obligatoires ou non,
 * téléphone obligatoire à partir d'un nombre de places, nombre maximum de places par réservation.
 */
var CHAMPS_FORM = ['telephone', 'message'];
function formulaire_(r) {
  var o = {}; try { o = JSON.parse((r || reglages_()).formulaire || '{}') || {}; } catch (e) { o = {}; }
  var f = {};
  CHAMPS_FORM.forEach(function (c) { f[c] = ['masque', 'facultatif', 'obligatoire'].indexOf(o[c]) >= 0 ? o[c] : 'facultatif'; });
  f.maxPlaces = Math.min(30, Math.max(1, Math.floor(Number(o.maxPlaces) || RESA.maxParReservation)));
  f.telDes = Math.max(0, Math.floor(Number(o.telDes) || 0)); // 0 = jamais
  if (f.telephone === 'obligatoire') f.telDes = 0;
  return f;
}

// ---------- Point d'entrée web ----------

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.api === 'evenements') { var rg = reglages_(); return json_({ festival: rg.nomFestival, formulaire: formulaire_(rg), evenements: evenementsPublics_() }); }
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
  ['boite', 'Mails : lire la boîte Gmail du festival, répondre, écrire, programmer des envois'],
  ['comptes', 'Comptes : créer des codes PIN et choisir leurs droits (administration)']
];
var FONCTION_DROIT = {
  adminCharger: null,
  adminEnregistrerEvenement: 'evenements', adminSupprimerEvenement: 'evenements',
  adminAjouterReservation: 'reservations', adminAnnulerReservation: 'reservations', adminPointer: 'reservations', adminConfirmerReservation: 'reservations', adminEnvoyerGroupe: 'reservations',
  adminEnregistrerReglages: 'reglages', adminEssaiMail: 'reglages',
  adminEnregistrerImage: 'photos', adminListerPhotos: 'photos', adminLireImage: 'photos', adminEnregistrerOriginal: 'photos', adminSupprimerPhoto: 'photos', adminEnregistrerVisuel: 'photos',
  adminListerComptes: 'comptes', adminEnregistrerCompte: 'comptes', adminSupprimerCompte: 'comptes', adminMettreAJour: 'comptes',
  adminListerAppareils: 'comptes', adminDeconnecterAppareil: 'comptes', adminQuitterAppareil: null,
  adminModifierPlaces: 'reservations',
  adminMailsDossiers: 'boite', adminMailsListe: 'boite', adminMailsOuvrir: 'boite', adminMailsPiece: 'boite', adminMailsAction: 'boite',
  adminMailsBrouillon: 'boite', adminMailsSupprimerBrouillon: 'boite', adminMailsEnvoyer: 'boite',
  adminMailsProgrammes: 'boite', adminMailsProgrammer: 'boite', adminMailsProgrammeEnvoyer: 'boite', adminMailsProgrammeAnnuler: 'boite', adminMailsProgrammeLire: 'boite'
};
/** Droits d'un compte ; un compte créé avant la Boîte la reçoit s'il gère les comptes (administration). */
function droitsDe_(c) {
  var d = {}; Object.keys((c && c.droits) || {}).forEach(function (k) { d[k] = !!c.droits[k]; });
  if (!('boite' in d)) d.boite = !!d.comptes;
  return d;
}
function adminApi_(d) {
  try {
    if (!(d.fn in FONCTION_DROIT)) throw new Error('Fonction inconnue.');
    var compte = acces_(d), droit = FONCTION_DROIT[d.fn];
    if (droit && !compte.droits[droit]) throw new Error('Votre compte (' + compte.nom + ') n\'a pas ce droit : ' + droit + '.');
    var args = Array.isArray(d.args) ? d.args : [];
    if (d.fn === 'adminEnregistrerEvenement' && !compte.droits.publier) args[0] = sansPublication_(args[0]);
    if (d.fn === 'adminMailsProgrammer') args = [args[0], args[1], args[2], compte.nom]; // qui a programmé le mail
    var cle = PropertiesService.getScriptProperties().getProperty(RESA.cleAdmin);
    var res = d.fn === 'adminQuitterAppareil' ? adminQuitterAppareil(cle, compte.appareil) : globalThis[d.fn].apply(null, [cle].concat(args));
    if (res && res.evenements && res.reglages) { // réponse adminCharger : on y joint le compte, et on cache les contacts à qui n'a pas le droit
      res.compte = { id: compte.id, nom: compte.nom, droits: compte.droits, appareil: compte.appareil || '' };
      if (compte.jeton) res.jeton = compte.jeton; // nouvel appareil : il garde ce jeton et n'a plus à redonner le code
      res.version = VERSION_CODE;
      res.droits = DROITS;
      if (compte.droits.boite && d.fn === 'adminCharger') res.boiteNonLus = boiteNonLus_();
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
  var acces = { id: c.id, nom: c.nom, droits: droitsDe_(c) };
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
  return { id: c.id, nom: c.nom, droits: droitsDe_(c), appareil: a.id };
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
  return { comptes: comptes_().map(function (c) { return { id: c.id, nom: c.nom, droits: droitsDe_(c), cree: c.cree }; }), droits: DROITS, lien: GESTION_URL };
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
  var pris = placesPrises_(), parOption = prisesParOption_();
  return lireEvenements_()
    .filter(function (ev) { return (ev.statut === 'Ouvert' || ev.statut === 'Fermé') && ev.date >= aujourdhui; })
    .map(function (ev) { return versPublic_(ev, pris[ev.id] || 0, parOption[ev.id] || {}); })
    .sort(function (a, b) { return (a.date + a.debut) < (b.date + b.debut) ? -1 : 1; });
}

function versPublic_(ev, prises, parOption) {
  var places = Number(ev.places) || 0, dispo = disponibilites_(ev, prises, parOption || {});
  var opts = optionsEv_(ev).map(function (o) { var x = { id: o.id, type: o.type, nom: o.nom, aide: o.aide }; if (o.type === 'contingent') x.restantes = dispo.contingents[o.id]; return x; });
  var contingentLibre = opts.some(function (o) { return o.type === 'contingent' && o.restantes > 0; });
  if (opts.length && places > 0) return {
    id: ev.id, titre: ev.titre, spectacle: ev.spectacle, date: ev.date, debut: ev.debut, fin: ev.fin,
    compagnie: ev.compagnie, duree: ev.duree, age: ev.age,
    lieu: ev.lieu, adresse: ev.adresse, description: ev.description, long: ev.long, distribution: ev.distribution, video: ev.video, tarif: ev.tarif, image: ev.image,
    reservable: ev.statut === 'Ouvert' && (dispo.publiques > 0 || contingentLibre),
    complet: dispo.publiques <= 0 && !contingentLibre,
    restantes: dispo.publiques,
    attente: ev.statut === 'Ouvert' && ev.attente === 'Oui',
    options: opts
  };
  return {
    options: opts,
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
  var places = Math.floor(Number(d.places)), fo = formulaire_();
  if (fo.telephone === 'masque') telephone = '';
  if (fo.message === 'masque') message = '';
  if (!nom) return { ok: false, erreur: 'Indiquez votre nom.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, erreur: 'L\'adresse e-mail ne semble pas correcte.' };
  if (!(places >= 1 && places <= fo.maxPlaces)) {
    return { ok: false, erreur: 'Choisissez entre 1 et ' + fo.maxPlaces + ' places.' };
  }
  if (!telephone && (fo.telephone === 'obligatoire' || (fo.telephone !== 'masque' && fo.telDes && places >= fo.telDes))) {
    return { ok: false, erreur: fo.telephone === 'obligatoire' ? 'Indiquez votre numéro de téléphone.' : 'Indiquez votre numéro de téléphone : il est demandé à partir de ' + fo.telDes + ' places.' };
  }
  if (!message && fo.message === 'obligatoire') return { ok: false, erreur: 'Écrivez un message.' };

  var verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    var ev = lireEvenements_().filter(function (x) { return x.id === d.evenement; })[0];
    if (!ev || ev.statut !== 'Ouvert') return { ok: false, erreur: 'Cet événement n\'est pas ouvert à la réservation.' };
    var max = Number(ev.places) || 0;
    var resasTout = lireReservations_(), prises = 0;
    resasTout.forEach(function (r) { if (r.evenement === ev.id && r.statut !== 'Annulée' && r.statut !== 'Liste d\'attente') prises += r.places; });
    var opts = optionsEv_(ev), ids = Array.isArray(d.options) ? d.options.map(String) : [];
    var choisies = opts.filter(function (o) { return ids.indexOf(o.id) >= 0; });
    var contingent = choisies.filter(function (o) { return o.type === 'contingent'; })[0];
    var dispo = disponibilites_(ev, prises, prisesParOption_(resasTout)[ev.id] || {});
    var libres = max > 0 ? (contingent ? dispo.contingents[contingent.id] : dispo.publiques) : null;
    var attente = false;
    if (contingent && max > 0 && places > libres) return { ok: false, erreur: libres ? 'Il ne reste que ' + libres + ' place(s) « ' + contingent.nom + ' ».' : 'Les places « ' + contingent.nom + ' » sont toutes prises.', restantes: dispo.publiques };
    if (max > 0 && places > libres) {
      var reste = Math.max(0, libres);
      if (d.attente && ev.attente === 'Oui') attente = true; // complet, mais liste d'attente ouverte
      else return { ok: false, erreur: reste ? 'Il ne reste que ' + reste + ' place(s).' : 'Désolé, c\'est complet.', restantes: reste, attente: ev.attente === 'Oui' };
    }
    var resa = {
      id: nouvelId_('R'), evenement: ev.id, titreEvenement: ev.titre, recue: maintenant_(),
      nom: nom, email: email, telephone: telephone, places: places, message: message, statut: attente ? 'Liste d\'attente' : 'Confirmée',
      options: choisies.map(function (o) { return o.nom; }).join(' · '),
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
  return { ok: true, id: resa.id, mailEnvoye: mailEnvoye, restantes: max > 0 ? Math.max(0, contingent ? dispo.publiques : libres - places) : null };
}

// ---------- E-mails ----------

/** Exceptions d'un événement pour ses e-mails : { types: { confirmation: 'non', … }, ajout: 'texte ajouté' }. */
function mailsEv_(ev) {
  var o = {}; try { o = JSON.parse((ev && ev.mailsEv) || '{}') || {}; } catch (e) { o = {}; }
  return { types: o.types && typeof o.types === 'object' ? o.types : {}, ajout: String(o.ajout || '').slice(0, 2000) };
}
var TYPES_AVEC_OPTIONS = ['confirmation', 'liberee', 'rappel'];
/** Phrases « mail » des options que la personne a cochées (ou de son groupe de places réservées). */
function textesOptions_(ev, resa) {
  var noms = nomsOptions_(resa);
  return optionsEv_(ev).filter(function (o) { return o.mail && noms.indexOf(o.nom) >= 0; }).map(function (o) { return o.mail; }).join('\n\n');
}
function envoyerType_(type, ev, resa, r) {
  r = r || reglages_();
  var valeurs = valeursMail_(ev, resa), x = mailsEv_(ev), t = MAIL.TYPES[type];
  if (x.types[type] === 'non') return valeurs; // cet événement n'envoie pas ce mail-là
  // Phrases des options cochées (ex. « votre livre vous attendra au théâtre ») : dans les mails où la place est confirmée.
  var parOptions = TYPES_AVEC_OPTIONS.indexOf(type) >= 0 ? textesOptions_(ev, resa) : '';
  var ajout = [x.ajout.trim(), parOptions].filter(String).join('\n\n');
  if (ajout && t) { var r2 = {}; Object.keys(r).forEach(function (k) { r2[k] = r[k]; }); r2[t.message] = String(r[t.message] || '').replace(/\s+$/, '') + '\n\n' + ajout; r = r2; }
  var m = MAIL.composer(type, r, valeurs);
  var repondreA = renvoi_(ev) && ev.renvoiReponses === 'Oui' ? renvoi_(ev) : r.copieA;
  MailApp.sendEmail({ to: resa.email, subject: m.sujet, body: m.texte, htmlBody: m.html, name: r.nomFestival, replyTo: repondreA || undefined });
  return valeurs;
}
/** Adresse qui reçoit les réservations de cet événement à la place (ou en plus) de celle du festival. */
function renvoi_(ev) { var a = String((ev && ev.renvoi) || '').trim(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a) ? a : ''; }
/** Destinataires des avis « nouvelle réservation » pour cet événement. */
function destinatairesAvis_(ev, r) {
  var l = [], autre = renvoi_(ev);
  if (autre) l.push(autre);
  if (r.copieA && (!autre || ev.renvoiCopie !== 'Non') && l.indexOf(r.copieA) < 0) l.push(r.copieA);
  return l;
}
function envoyerConfirmation_(ev, resa) {
  var r = reglages_();
  var valeurs = envoyerType_('confirmation', ev, resa, r);
  destinatairesAvis_(ev, r).forEach(function (a) {
    MailApp.sendEmail({
      to: a,
      subject: 'Nouvelle réservation : ' + ev.titre + ' (' + resa.places + ' pl.)',
      body: resa.nom + ' · ' + resa.email + (resa.telephone ? ' · ' + resa.telephone : '') + '\n' +
        resa.places + ' place(s) pour « ' + ev.titre + ' », ' + valeurs.date + ' à ' + valeurs.heure + '\n' +
        (resa.options ? 'Options : ' + resa.options + '\n' : '') +
        (resa.message ? '\nMessage : ' + resa.message + '\n' : ''),
      name: 'Réservations · ' + r.nomFestival,
      replyTo: resa.email,
    });
  });
}

function envoyerAnnulation_(ev, resa) { envoyerType_('annulation', ev, resa); }

function envoyerAttente_(ev, resa) {
  var r = reglages_();
  envoyerType_('attente', ev, resa, r);
  destinatairesAvis_(ev, r).forEach(function (a) { MailApp.sendEmail({ to: a, subject: '[Liste d\'attente] ' + ev.titre + ' : ' + resa.nom + ' (' + resa.places + ')', body: resa.nom + ' · ' + resa.email + ' · ' + resa.places + ' place(s)', name: r.nomFestival, replyTo: resa.email || undefined }); });
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
  if (prevenir && ev && resa.email) envoyerType_('liberee', ev, resa);
  return adminCharger(cle);
}

function valeursMail_(ev, resa) {
  var r = reglages_(), nom = String(resa.nom || '').trim();
  return {
    nom: nom, prenom: nom.split(/\s+/)[0] || '', places: resa.places, titre: ev.titre, date: dateLongue_(ev.date),
    heure: ev.debut || '', lieu: [ev.lieu, ev.adresse].filter(String).join(', '), adresse: ev.adresse || '', tarif: MAIL.tarifUneLigne(ev.tarif),
    numero: resa.id || '', email: resa.email || '', telephone: resa.telephone || '', message: resa.message || '', options: resa.options || '',
    festival: r.nomFestival, site: String(r.siteUrl || '').replace(/\/apercu\/?$/, '').replace(/\/$/, ''),
    lien: ev.id ? String(r.siteUrl || '').replace(/\/?$/, '/') + 'programme.html#' + encodeURIComponent(ev.id) : String(r.siteUrl || ''),
    image: String(ev.image || '').split(/\s*[\n,]\s*/).filter(function (u) { return u && u.charAt(0) !== '#'; })[0] || '',
  };
}

/**
 * E-mail « groupé » envoyé à la demande depuis la page d'un événement (rappel, spectacle annulé, merci) :
 * une copie personnalisée à chaque réservation active (liste d'attente comprise pour « spectacle annulé »).
 * brouillon : réglages pas encore enregistrés (pour l'essai). Renvoie le nombre d'envois.
 */
/** Compte Google au nom duquel le script tourne, donc d'où partent les e-mails (celui qui a déployé). */
function expediteur_() { try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; } }

function adminEnvoyerGroupe(cle, evId, type, brouillon) {
  verifierCle_(cle);
  var t = MAIL.TYPES[type];
  if (!t || !t.groupe) throw new Error('Ce modèle ne s\'envoie pas en groupe.');
  var ev = lireEvenements_().filter(function (x) { return x.id === evId; })[0];
  if (!ev) throw new Error('Événement introuvable.');
  var r = reglages_();
  if (brouillon && typeof brouillon === 'object') Object.keys(REGLAGES_DEFAUT).forEach(function (k) { if (k in brouillon) r[k] = String(brouillon[k]); });
  var resas = lireReservations_().filter(function (x) { return x.evenement === evId && x.email && x.statut !== 'Annulée' && (t.attente || x.statut !== 'Liste d\'attente'); });
  var quota = MailApp.getRemainingDailyQuota();
  if (resas.length > quota) throw new Error('Google n\'autorise plus que ' + quota + ' e-mail(s) aujourd\'hui, il en faudrait ' + resas.length + '. Réessayez demain ou envoyez en deux fois.');
  var n = 0, erreurs = [];
  resas.forEach(function (resa) {
    try { envoyerType_(type, ev, resa, r); n++; } catch (err) { erreurs.push(resa.nom + ' : ' + err); }
  });
  if (erreurs.length) console.error('Envoi groupé ' + type + ' : ' + erreurs.join(' | '));
  return { envoyes: n, erreurs: erreurs.length, total: resas.length };
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
    nbComptes: comptes_().length,
    expediteur: expediteur_(),
  };
}

function adminEnregistrerEvenement(cle, ev) {
  verifierCle_(cle);
  // Retours à la ligne venus du navigateur (\r\n) ramenés à \n, comme dans la feuille.
  CHAMPS_EV.forEach(function (c) { if (typeof ev[c] === 'string') ev[c] = ev[c].replace(/\r\n?/g, '\n'); });
  var avant = ev._avant && typeof ev._avant === 'object' ? ev._avant : null, gardes = [];
  delete ev._avant;
  if (avant && ev.id) { // l'appli dit ce qu'elle avait chargé : seuls les champs changés dans l'appli sont écrits
    var fl = onglet_(RESA.ongletEvenements, COL_EV), nl = ligneDe_(fl, ev.id);
    if (nl) gardes = fusionnerEvenement_(ev, avant, objetDeLigne_(fl.getRange(nl, 1, 1, COL_EV.length).getDisplayValues()[0], CHAMPS_EV));
  }
  if (!String(ev.titre || '').trim()) throw new Error('Le titre manque.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) throw new Error('La date manque.');
  if (STATUTS_EV.indexOf(ev.statut) < 0) ev.statut = 'Brouillon';
  ev.places = Math.max(0, Math.floor(Number(ev.places) || 0));
  ev.renvoi = String(ev.renvoi || '').trim();
  if (ev.renvoi && !renvoi_(ev)) throw new Error('L\'adresse qui reçoit les réservations n\'est pas une adresse e-mail valable.');
  ev.renvoiCopie = ev.renvoiCopie === 'Non' ? 'Non' : 'Oui';
  ev.renvoiReponses = ev.renvoiReponses === 'Oui' ? 'Oui' : '';
  var opts = optionsEv_(ev);
  if (opts.filter(function (o) { return o.type === 'contingent'; }).length > 1) throw new Error('Une seule option « places réservées à un groupe » par événement.');
  ev.options = opts.length ? JSON.stringify(opts) : '';
  var mx = mailsEv_(ev), types = {};
  Object.keys(MAIL.TYPES).forEach(function (k) { if (mx.types[k] === 'non') types[k] = 'non'; });
  ev.mailsEv = Object.keys(types).length || mx.ajout.trim() ? JSON.stringify({ types: types, ajout: mx.ajout.trim() }) : '';
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
  var res = adminCharger(cle);
  if (gardes.length) res.gardes = gardes;
  return res;
}

/**
 * Protège ce qui a été changé ailleurs (dans la feuille, ou depuis un autre appareil) depuis que l'appli a chargé
 * l'événement : un champ que l'appli n'a pas touché (même valeur qu'au chargement) reprend la valeur actuelle de la feuille.
 * Un champ absent de la demande garde aussi la valeur de la feuille. Renvoie les champs ainsi gardés (s'ils différaient).
 */
function fusionnerEvenement_(ev, avant, actuel) {
  var gardes = [], norm = function (v) { return v == null ? '' : String(v).replace(/\r\n?/g, '\n'); };
  CHAMPS_EV.forEach(function (c) {
    if (c === 'id') return;
    var absent = !(c in ev), inchange = !absent && norm(ev[c]) === norm(avant[c]);
    if (!absent && !inchange) return; // changé dans l'appli : on l'écrit
    if (absent || norm(actuel[c]) !== norm(avant[c])) { if (norm(ev[c]) !== norm(actuel[c]) && !absent) gardes.push(COL_EV[CHAMPS_EV.indexOf(c)]); ev[c] = actuel[c]; }
  });
  return gardes;
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
    options: optionsEv_(ev).filter(function (o) { return (Array.isArray(d.options) ? d.options : []).indexOf(o.id) >= 0; }).map(function (o) { return o.nom; }).join(' · '),
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
  // Recadrage : on garde l'image d'origine et le cadre, pour rouvrir l'éditeur sur le même cadrage.
  if (d.source && d.cadre) { try { fichier.setDescription(JSON.stringify({ source: String(d.source).slice(0, 300), cadre: d.cadre })); } catch (e) {} }
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
  var info = {}; try { info = JSON.parse(f.getDescription() || '{}') || {}; } catch (e) {}
  return { base64: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()), nom: f.getName(), source: info.source || '', cadre: info.cadre || null };
}

// Image d'origine d'un recadrage (envoyée depuis l'ordinateur ou le téléphone) : rangée dans un sous-dossier, hors de la bibliothèque.
function adminEnregistrerOriginal(cle, d) {
  verifierCle_(cle);
  var base64 = String(d.base64 || '').replace(/^data:[^,]*,/, '');
  if (!base64 || base64.length > 12e6) throw new Error('Photo manquante ou trop lourde.');
  var parent = dossierPhotos_(), it = parent.getFoldersByName('Originaux'), dossier = it.hasNext() ? it.next() : parent.createFolder('Originaux');
  var nom = String(d.nom || 'original').replace(/[^\w\u00C0-\u017F .-]+/g, ' ').trim().slice(0, 80) || 'original';
  var fichier = dossier.createFile(Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', nom + '.jpg'));
  return { id: fichier.getId() };
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
  // Depuis le 09.11.2026 le site est sur ptit-festival.ch ; l'ancienne adresse redirige vers l'accueil sans garder le chemin.
  r.siteUrl = String(r.siteUrl || '').replace(/^https?:\/\/(www\.)?petit-festival\.ch/i, 'https://ptit-festival.ch');
  return r;
}
