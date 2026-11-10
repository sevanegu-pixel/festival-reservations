// ---------- Mails : la boîte Gmail du festival, lue et écrite depuis l'appli ----------
// Repris de l'appli Diffusion (Compagnie Origami) : l'API Gmail est appelée directement avec UrlFetchApp.fetchAll
// (lectures en parallèle), avec l'accès Gmail déjà accordé au script (mail.google.com) : aucun droit nouveau.
// Dossiers, libellés, conversations complètes (images intégrées), brouillons enregistrés dans Gmail, envoi,
// envois programmés (onglet « Envois programmés » du classeur + un déclencheur horaire), réservations liées à chaque fil.

var MAILS = {
  prefixe: 'Festival/',
  traite: 'Traité',
  etiquettes: { annulation: 'Annulation', places: 'Changement de places', question: 'Question', autre: 'Autre' },
  onglet: 'Envois programmés',
  taille: 30,
  maxPiece: 15 * 1024 * 1024, maxPieces: 20 * 1024 * 1024
};
var COL_PROG = ['id', 'Créé le', 'Prévu le (ms)', 'À', 'Objet', 'Statut', 'Essais', 'Raison', 'Envoyé le', 'Fil', 'Brouillon', 'Traiter après', 'Par'];
var CHAMPS_PROG = ['id', 'cree', 'prevu', 'a', 'objet', 'statut', 'essais', 'raison', 'envoyeLe', 'fil', 'brouillon', 'traiter', 'par'];
var STATUTS_PROG = { attente: 'Programmé', cours: 'Envoi en cours', envoye: 'Envoyé', echec: 'Échec', annule: 'Annulé' };
var DOSSIERS_MAILS = {
  reception: { ids: ['INBOX'], q: 'in:inbox' },
  suivis: { ids: ['STARRED'], q: 'is:starred' },
  envoyes: { ids: ['SENT'], q: 'in:sent' },
  brouillons: { ids: ['DRAFT'], q: 'in:drafts' },
  tous: { q: '-in:spam -in:trash' },
  spam: { ids: ['SPAM'], q: 'in:spam' },
  corbeille: { ids: ['TRASH'], q: 'in:trash' }
};
var API_GMAIL_ = 'https://gmail.googleapis.com/gmail/v1/users/me/';

// ----- Appels Gmail (parallèles, avec reprise en cas de 429 / 5xx) -----
function gmailParallele_(chemins) {
  if (!chemins.length) return [];
  var jeton = ScriptApp.getOAuthToken();
  var requete = function (c) {
    var o = typeof c === 'string' ? { chemin: c } : c;
    var r = { url: API_GMAIL_ + o.chemin, headers: { Authorization: 'Bearer ' + jeton }, muteHttpExceptions: true, method: o.method || 'get' };
    if (o.body !== undefined) { r.contentType = 'application/json'; r.payload = JSON.stringify(o.body); }
    return r;
  };
  var lire = function (liste) { return UrlFetchApp.fetchAll(liste.map(requete)); };
  var rep = lire(chemins);
  for (var essai = 1; essai <= 2; essai++) {
    var refaire = []; rep.forEach(function (r, i) { var c = r.getResponseCode(); if (c === 429 || c >= 500) refaire.push(i); });
    if (!refaire.length) break;
    Utilities.sleep(700 * essai);
    lire(refaire.map(function (i) { return chemins[i]; })).forEach(function (r, k) { rep[refaire[k]] = r; });
  }
  return rep.map(function (r) { var c = r.getResponseCode(); if (c < 200 || c >= 300) return null; try { return c === 204 ? {} : JSON.parse(r.getContentText() || '{}'); } catch (e) { return null; } });
}
function gmailGet_(chemin) {
  var r = gmailParallele_([chemin])[0];
  if (!r) throw new Error('Gmail ne répond pas, réessayez.');
  return r;
}
/** Appel qui écrit (modify, trash, drafts…) : l'erreur de Gmail est rendue lisible. */
function gmailEcrire_(chemin, method, body) {
  var r = UrlFetchApp.fetch(API_GMAIL_ + chemin, { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
    contentType: body === undefined ? undefined : 'application/json', payload: body === undefined ? undefined : JSON.stringify(body) });
  var c = r.getResponseCode();
  if (c === 429 || c >= 500) { Utilities.sleep(900); r = UrlFetchApp.fetch(API_GMAIL_ + chemin, { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, contentType: body === undefined ? undefined : 'application/json', payload: body === undefined ? undefined : JSON.stringify(body) }); c = r.getResponseCode(); }
  if (c < 200 || c >= 300) {
    var m = ''; try { m = JSON.parse(r.getContentText()).error.message; } catch (e) { m = ''; }
    if (c === 404) throw new Error('Introuvable dans Gmail (supprimé entre-temps ?).');
    throw new Error('Gmail a refusé (' + c + (m ? ' · ' + m : '') + ').');
  }
  try { return c === 204 ? {} : JSON.parse(r.getContentText() || '{}'); } catch (e) { return {}; }
}
/** Petit cache du script pour ce qui change rarement (libellés, adresse, brouillons). */
function enCache_(cle, secondes, f) {
  var c = CacheService.getScriptCache(), v = null;
  try { v = c.get(cle); } catch (e) { v = null; }
  if (v) { try { return JSON.parse(v); } catch (e) { /* recalcul */ } }
  var x = f();
  try { c.put(cle, JSON.stringify(x), secondes); } catch (e) { /* trop gros : pas de cache */ }
  return x;
}
function oublierCache_(cles) { try { CacheService.getScriptCache().removeAll(cles); } catch (e) { /* rien */ } }
function monAdresse_() { return enCache_('gm:moi', 21600, function () { try { return String(gmailGet_('profile').emailAddress || '').toLowerCase(); } catch (e) { return expediteur_().toLowerCase(); } }); }
/** Libellés personnels : [{ id, nom }], dont Festival/… */
function libellesGmail_() {
  return enCache_('gm:libelles', 300, function () {
    return (gmailGet_('labels').labels || []).filter(function (l) { return l.type === 'user'; }).map(function (l) { return { id: l.id, nom: l.name }; });
  });
}
function idLibelle_(nom, creer) {
  var l = libellesGmail_().filter(function (x) { return x.nom === nom; })[0];
  if (l) return l.id;
  if (!creer) return '';
  var n = gmailEcrire_('labels', 'post', { name: nom, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
  oublierCache_(['gm:libelles']);
  return n.id;
}
function entete_(m, nom) {
  var h = (m && m.payload && m.payload.headers) || [];
  for (var i = 0; i < h.length; i++) if (String(h[i].name).toLowerCase() === nom.toLowerCase()) return String(h[i].value || '');
  return '';
}
function dateGmail_(ms) { return Utilities.formatDate(new Date(Number(ms) || 0), 'Europe/Zurich', 'yyyy-MM-dd\'T\'HH:mm'); }
function texteExtrait_(s) {
  return String(s || '').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, function (x, n) { return String.fromCharCode(Number(n)); }).replace(/&amp;/g, '&');
}
function adressesDe_(texte) { return (String(texte || '').match(/[^\s<>,;"']+@[^\s<>,;"']+\.[a-z]{2,}/ig) || []).map(function (x) { return x.toLowerCase(); }); }
function adresseDe_(de) { var m = String(de || '').match(/<[^<>\s]+@[^<>\s]+>/g); return m ? m[m.length - 1].slice(1, -1).trim().toLowerCase() : (adressesDe_(de)[0] || ''); }
function nomDe_(de) { var t = String(de || '').split(',')[0].trim(), m = t.match(/^"?([^"<]+?)"?\s*</); return (m ? m[1].trim() : t.replace(/[<>]/g, '')) || adresseDe_(de); }
function emailValide_(a) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a || '')); }
function echapperHtml_(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function estReponseAutomatique_(m) {
  var auto = String(entete_(m, 'Auto-Submitted') || '').trim().toLowerCase();
  if (auto && auto !== 'no') return true;
  if (entete_(m, 'X-Autoreply') || entete_(m, 'X-Autorespond')) return true;
  return /^\s*(r[ée]ponse automatique|auto(matic)?[ -]?reply|automatische antwort|out of (the )?office|absen(ce|t)\b)/i.test(String(entete_(m, 'Subject') || ''));
}

// ----- Réservations liées à une adresse -----
function reservationsParEmail_() {
  var evs = {}; lireEvenements_().forEach(function (e) { evs[e.id] = e; });
  var par = {};
  lireReservations_().forEach(function (r) {
    var k = String(r.email || '').trim().toLowerCase(); if (!k) return;
    var e = evs[r.evenement] || {};
    (par[k] = par[k] || []).push({ id: r.id, evenement: r.evenement, titre: r.titreEvenement || e.titre || '', date: e.date || '', debut: e.debut || '', places: r.places, statut: r.statut, nom: r.nom, options: r.options || '' });
  });
  return par;
}
/** Même chose, gardé 90 s (la liste des mails la demande souvent). */
function reservationsParEmailCache_() { return enCache_('gm:resas', 90, reservationsParEmail_); }
function oublierResasMails_() { oublierCache_(['gm:resas']); }

// ----- Brouillons : identifiant de brouillon ↔ message (une lecture, gardée 60 s) -----
function brouillonsGmail_() {
  return enCache_('gm:brouillons', 60, function () {
    var tous = [], jeton = '', tours = 0;
    do {
      var r = gmailGet_('drafts?maxResults=500' + (jeton ? '&pageToken=' + encodeURIComponent(jeton) : '') + '&fields=' + encodeURIComponent('nextPageToken,drafts(id,message(id,threadId))'));
      (r.drafts || []).forEach(function (d) { if (d.message) tous.push({ id: d.id, messageId: d.message.id, threadId: d.message.threadId }); });
      jeton = r.nextPageToken || '';
    } while (jeton && ++tours < 6);
    return tous;
  });
}
function oublierBrouillons_() { oublierCache_(['gm:brouillons', 'gm:dossiers']); }
/** Brouillons qui sont en fait des mails programmés (ils ne se montrent pas comme brouillons). */
function brouillonsProgrammes_() {
  var t = {};
  lignesProgrammes_().forEach(function (l) { if (l.statut === STATUTS_PROG.attente || l.statut === STATUTS_PROG.echec || l.statut === STATUTS_PROG.cours) t[l.brouillon] = l; });
  return t;
}

// ----- Dossiers et compteurs -----
function adminMailsDossiers(cle) {
  verifierCle_(cle);
  return enCache_('gm:dossiers', 120, dossiersMails_);
}
function dossiersMails_() {
  var t0 = Date.now(), libs = [];
  try { libs = libellesGmail_(); } catch (e) { libs = []; }
  var cles = ['reception', 'suivis', 'brouillons', 'spam'];
  var reps = gmailParallele_(cles.map(function (k) { return 'labels/' + DOSSIERS_MAILS[k].ids[0]; }).concat(libs.map(function (l) { return 'labels/' + encodeURIComponent(l.id); })));
  var comptes = {};
  cles.forEach(function (k, i) { var l = reps[i] || {}; comptes[k] = k === 'brouillons' ? Number(l.threadsTotal || 0) : Number(l.threadsUnread || 0); });
  var progs = brouillonsProgrammes_(), nProg = Object.keys(progs).length;
  comptes.brouillons = Math.max(0, comptes.brouillons - nProg);
  comptes.programmes = nProg;
  var libelles = libs.map(function (l, i) { var x = reps[cles.length + i] || {}; return { nom: l.nom, nonLus: Number(x.threadsUnread || 0) }; });
  libelles.sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr'); });
  return { comptes: comptes, libelles: libelles, moi: monAdresse_(), etiquettes: MAILS.etiquettes, prefixe: MAILS.prefixe, traite: MAILS.prefixe + MAILS.traite, ms: Date.now() - t0 };
}
/** Compteur de l'onglet Mails : fils non lus dans la boîte de réception (−1 si Gmail est indisponible). */
function boiteNonLus_() {
  try { return Number(gmailGet_('labels/INBOX').threadsUnread || 0); } catch (e) { return -1; }
}

/** En-têtes des fils d'une page : gardés dans le cache du script tant que le fil n'a pas bougé (historyId), pour que
 *  rafraîchir la liste coûte 1 appel Gmail au lieu de 31 (quota UrlFetch : 20 000 appels par jour). */
function detailsFils_(fils) {
  if (!fils.length) return [];
  var cache = CacheService.getScriptCache(), cles = fils.map(function (t) { return 'gm:fil:' + t.id + ':' + (t.historyId || ''); }), connus = {};
  try { connus = cache.getAll(cles) || {}; } catch (e) { connus = {}; }
  var champs = '&fields=' + encodeURIComponent('id,messages(id,labelIds,snippet,internalDate,payload(mimeType,headers))');
  var manquants = fils.filter(function (t, i) { return !connus[cles[i]]; });
  var lus = gmailParallele_(manquants.map(function (t) { return 'threads/' + t.id + '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Auto-Submitted' + champs; }));
  var parId = {}, aGarder = {};
  manquants.forEach(function (t, i) { if (lus[i]) { parId[t.id] = lus[i]; aGarder['gm:fil:' + t.id + ':' + (t.historyId || '')] = JSON.stringify(lus[i]); } });
  if (Object.keys(aGarder).length) { try { cache.putAll(aGarder, 21600); } catch (e) { /* trop gros */ } }
  return fils.map(function (t, i) { if (parId[t.id]) return parId[t.id]; try { return JSON.parse(connus[cles[i]]); } catch (e) { return null; } });
}

// ----- Liste des conversations (une page de 30) -----
/** o : { dossier, libelle, recherche, jeton, public (seulement les fils liés à une réservation ou à nos envois) } */
function adminMailsListe(cle, o) {
  verifierCle_(cle);
  o = o || {};
  var t0 = Date.now(), taille = MAILS.taille, recherche = String(o.recherche || '').trim();
  var d = DOSSIERS_MAILS[o.dossier] || DOSSIERS_MAILS.reception;
  var chemin, q = '';
  if (o.libelle) {
    var idLib = idLibelle_(String(o.libelle), false);
    if (!idLib) return { fils: [], jetonSuite: '', ms: 0 };
    if (recherche) q = 'label:"' + String(o.libelle).replace(/"/g, '') + '" ' + recherche;
    else chemin = 'threads?maxResults=' + taille + '&labelIds=' + encodeURIComponent(idLib);
  } else if (recherche || !d.ids) q = (d.q + ' ' + recherche).trim();
  else chemin = 'threads?maxResults=' + taille + d.ids.map(function (l) { return '&labelIds=' + l; }).join('') + (o.dossier === 'spam' || o.dossier === 'corbeille' ? '&includeSpamTrash=true' : '');
  if (q) chemin = 'threads?maxResults=' + taille + '&q=' + encodeURIComponent(q) + (/\bin:(spam|trash)\b/.test(q) ? '&includeSpamTrash=true' : '');
  if (o.jeton) chemin += '&pageToken=' + encodeURIComponent(String(o.jeton));
  var page = gmailGet_(chemin + '&fields=' + encodeURIComponent('threads(id,historyId),nextPageToken'));
  var details = detailsFils_(page.threads || []);
  if (details.length && !details.some(function (t) { return t && t.messages && t.messages.length; })) throw new Error('Gmail ne répond pas, réessayez.');
  var moi = monAdresse_(), par = reservationsParEmailCache_(), nomsLib = {}, progs = brouillonsProgrammes_(), parMessageBrouillon = {};
  try { libellesGmail_().forEach(function (l) { nomsLib[l.id] = l.nom; }); } catch (e) { /* sans noms */ }
  if (o.dossier === 'brouillons' && !o.libelle) { try { brouillonsGmail_().forEach(function (b) { parMessageBrouillon[b.messageId] = b.id; }); } catch (e) { /* liste telle quelle */ } }
  var liste = [];
  details.forEach(function (t) {
    if (!t || !t.messages || !t.messages.length) return;
    var ms = t.messages, etiquettes = {}, nonLu = false, suivi = false, pieces = false, brouillon = false, qui = '', reponseANous = adresseDe_(entete_(ms[0], 'From')) === moi;
    ms.forEach(function (m) {
      (m.labelIds || []).forEach(function (l) { if (l === 'UNREAD') nonLu = true; else if (l === 'STARRED') suivi = true; else if (l === 'DRAFT') brouillon = true; else if (nomsLib[l]) etiquettes[nomsLib[l]] = true; });
      if (/^multipart\/mixed/i.test(String(m.payload && m.payload.mimeType || ''))) pieces = true;
      var a = adresseDe_(entete_(m, 'From')); if (a && a !== moi) qui = a;
    });
    if (!qui) qui = adressesDe_(entete_(ms[ms.length - 1], 'To')).filter(function (a) { return a !== moi; })[0] || '';
    if (o.dossier === 'brouillons' && !o.libelle) { // un brouillon programmé n'est pas un brouillon à reprendre
      var dessins = ms.filter(function (m) { return (m.labelIds || []).indexOf('DRAFT') >= 0; });
      if (dessins.length && dessins.every(function (m) { return progs[parMessageBrouillon[m.id]]; })) return;
    }
    var resas = par[qui] || [];
    if (o.public && !resas.length && !reponseANous) return;
    var dernier = ms[ms.length - 1], deDernier = entete_(dernier, 'From'), dernierAutre = ms.filter(function (m) { return adresseDe_(entete_(m, 'From')) !== moi; }).pop();
    liste.push({
      id: t.id, objet: entete_(ms[0], 'Subject') || '(sans objet)', date: dateGmail_(dernier.internalDate), nonLu: nonLu, suivi: suivi, nb: ms.length, brouillon: brouillon,
      de: adresseDe_(deDernier) === moi ? 'Moi' + (entete_(dernier, 'To') ? ' → ' + nomDe_(entete_(dernier, 'To')) : '') : nomDe_(deDernier),
      email: qui, extrait: texteExtrait_(dernier.snippet).slice(0, 140), libelles: Object.keys(etiquettes).map(function (n) { return n.indexOf(MAILS.prefixe) === 0 ? n.slice(MAILS.prefixe.length) : n; }),
      pieces: pieces, auto: !!(dernierAutre && estReponseAutomatique_(dernierAutre)), repondu: adresseDe_(deDernier) === moi && ms.length > 1 && !brouillon,
      resas: resas.slice(0, 3), nbResas: resas.length
    });
  });
  return { fils: liste, jetonSuite: page.nextPageToken || '', ms: Date.now() - t0 };
}

// ----- Une conversation complète -----
function decoderPartie_(p) {
  var cs = (String(entete_({ payload: p }, 'Content-Type')).match(/charset="?([^";\s]+)/i) || [])[1] || 'UTF-8';
  var octets = Utilities.base64DecodeWebSafe(String(p.body.data));
  var utf8 = Utilities.newBlob(octets).getDataAsString('UTF-8');
  if (utf8.indexOf('�') < 0 || /^utf-?8$/i.test(cs)) return utf8;
  try { return Utilities.newBlob(octets).getDataAsString(cs); } catch (e) { return utf8; }
}
function base64Standard_(s) { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''); while (s.length % 4) s += '='; return s; }
/** Images intégrées de tous les messages d'un fil (Content-ID, X-Attachment-Id) : pour les anciens mails cités. */
function imagesDuFil_(messages) {
  var t = {};
  (messages || []).forEach(function (m) {
    (function parcourir(p) {
      if (!p) return;
      if (/^image\//i.test(p.mimeType || '') && p.body && (p.body.attachmentId || p.body.data)) {
        var im = { att: p.body.attachmentId || '', data: p.body.data || '', type: p.mimeType, taille: Number(p.body.size || 0), msg: m.id };
        [String(entete_({ payload: p }, 'Content-ID') || '').replace(/^\s*<|>\s*$/g, ''), String(entete_({ payload: p }, 'X-Attachment-Id') || '').trim()].forEach(function (k) { if (k && !t[k]) t[k] = im; });
      }
      (p.parts || []).forEach(parcourir);
    })(m.payload);
  });
  return t;
}
/** Contenu d'un message (format full) : HTML (ou texte mis en forme), images cid: intégrées, noms des pièces jointes (pas téléchargées). */
function contenuMessage_(m, autres) {
  var r = { html: '', texte: '', pieces: [] }, integrees = {}, brutes = [];
  (function parcourir(p) {
    if (!p) return;
    var dispo = entete_({ payload: p }, 'Content-Disposition'), cid = String(entete_({ payload: p }, 'Content-ID') || '').replace(/^\s*<|>\s*$/g, '');
    if (/^image\//i.test(p.mimeType || '') && p.body) {
      var image = { att: p.body.attachmentId || '', data: p.body.data || '', type: p.mimeType, taille: Number(p.body.size || 0), msg: m.id };
      [cid, String(entete_({ payload: p }, 'X-Attachment-Id') || '').trim(), String(p.filename || '').trim()].forEach(function (k) { if (k && !integrees[k]) integrees[k] = image; });
    }
    if (p.filename && p.body && (p.body.attachmentId || p.body.size)) {
      if (!/^inline/i.test(dispo) || !cid) brutes.push({ nom: p.filename, type: p.mimeType || '', taille: Number(p.body.size || 0), id: p.body.attachmentId || '', message: m.id });
    } else if (p.body && p.body.data && /^text\/html/i.test(p.mimeType) && !r.html) r.html = decoderPartie_(p);
    else if (p.body && p.body.data && /^text\/plain/i.test(p.mimeType) && !r.texte) r.texte = decoderPartie_(p);
    (p.parts || []).forEach(parcourir);
  })(m.payload);
  if (!r.html) r.html = '<div style="white-space:pre-wrap">' + echapperHtml_(r.texte).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>') + '</div>';
  Object.keys(autres || {}).forEach(function (k) { if (!integrees[k]) integrees[k] = autres[k]; });
  var cids = Object.keys(integrees).filter(function (c) { return r.html.indexOf('cid:' + c) >= 0 && integrees[c].taille < 4e6; });
  var aLire = cids.filter(function (c) { return !integrees[c].data && integrees[c].att; });
  try {
    var lus = gmailParallele_(aLire.map(function (c) { return 'messages/' + encodeURIComponent(integrees[c].msg || m.id) + '/attachments/' + encodeURIComponent(integrees[c].att); }));
    aLire.forEach(function (c, i) { if (lus[i] && lus[i].data) integrees[c].data = lus[i].data; });
  } catch (e) { /* images laissées telles quelles */ }
  var utilisees = {};
  cids.forEach(function (c) { var x = integrees[c]; if (x.data) { utilisees[x.att || c] = true; r.html = r.html.split('cid:' + c).join('data:' + x.type + ';base64,' + base64Standard_(x.data)); } });
  r.pieces = brutes.filter(function (x) { return !(utilisees[x.id] || utilisees[x.nom]); });
  // Pixels de suivi (images 1×1) : retirés, nos lectures ne comptent pas comme des ouvertures.
  r.html = r.html.replace(/<img\b[^>]*\b(?:width|height)\s*=\s*["']?1(?:px)?["']?[^>]*>/gi, function (tag) { return /\b(width|height)\s*=\s*["']?1(px)?["']?/gi.test(tag) && !/data:image/i.test(tag) ? '' : tag; });
  return r;
}
function lireConversation_(id) {
  var t = gmailGet_('threads/' + encodeURIComponent(id) + '?format=full');
  var nomsLib = {}; try { libellesGmail_().forEach(function (l) { nomsLib[l.id] = l.nom; }); } catch (e) { /* sans noms */ }
  var etiquettes = {}, suivi = false, nonLu = false, dansReception = false, moi = monAdresse_(), autres = imagesDuFil_(t.messages || []);
  var messages = (t.messages || []).map(function (m) {
    var c = contenuMessage_(m, autres), lab = m.labelIds || [];
    lab.forEach(function (l) { if (l === 'STARRED') suivi = true; if (l === 'UNREAD') nonLu = true; if (l === 'INBOX') dansReception = true; if (nomsLib[l]) etiquettes[nomsLib[l]] = true; });
    var de = entete_(m, 'From');
    return { id: m.id, de: de, email: adresseDe_(de), nom: adresseDe_(de) === moi ? 'Le festival' : nomDe_(de), a: entete_(m, 'To'), cc: entete_(m, 'Cc'), objet: entete_(m, 'Subject'), date: dateGmail_(m.internalDate),
      html: c.html, moi: adresseDe_(de) === moi, nonLu: lab.indexOf('UNREAD') >= 0, brouillon: lab.indexOf('DRAFT') >= 0, pieces: c.pieces, auto: estReponseAutomatique_(m) };
  });
  if (!messages.length) throw new Error('Conversation introuvable.');
  var qui = ''; messages.forEach(function (m) { if (!m.moi && m.email) qui = m.email; });
  if (!qui) qui = adressesDe_(messages[messages.length - 1].a).filter(function (a) { return a !== moi; })[0] || '';
  var libs = Object.keys(etiquettes);
  return { id: id, objet: messages[0].objet || '(sans objet)', messages: messages, suivi: suivi, nonLu: nonLu, email: qui,
    libelles: libs.map(function (n) { return n.indexOf(MAILS.prefixe) === 0 ? n.slice(MAILS.prefixe.length) : n; }),
    traite: libs.indexOf(MAILS.prefixe + MAILS.traite) >= 0, dansReception: dansReception, resas: reservationsParEmail_()[qui] || [] };
}
/** Ouvre un fil : le marque comme lu (sauf aperçu préchargé) ; ses brouillons (et mails programmés) sont reconnus. */
function adminMailsOuvrir(cle, id, apercu) {
  verifierCle_(cle);
  var t0 = Date.now(), f = lireConversation_(String(id || ''));
  if (!apercu && f.nonLu) { try { gmailEcrire_('threads/' + encodeURIComponent(f.id) + '/modify', 'post', { removeLabelIds: ['UNREAD'] }); f.nonLu = false; } catch (e) { /* reste non lu */ } }
  var dessins = f.messages.filter(function (m) { return m.brouillon; });
  if (dessins.length) {
    var vivants = {}; try { brouillonsGmail_().forEach(function (d) { vivants[d.messageId] = d.id; }); } catch (e) { vivants = null; }
    var progs = brouillonsProgrammes_();
    if (vivants) f.messages = f.messages.filter(function (m) { return !m.brouillon || vivants[m.id]; });
    f.messages.forEach(function (m) {
      if (!m.brouillon || !vivants) return;
      m.brouillonId = vivants[m.id] || '';
      var p = progs[m.brouillonId]; if (p) { m.programme = resumeProgramme_(p); m.brouillon = false; }
    });
    dessins = f.messages.filter(function (m) { return m.brouillon; });
  }
  f.nbBrouillons = dessins.length;
  var mb = dessins[dessins.length - 1];
  if (mb) f.brouillon = { id: mb.brouillonId || '', messageId: mb.id, a: mb.a, cc: mb.cc, objet: mb.objet, html: mb.html, reponse: f.messages.length > 1 };
  f.ms = Date.now() - t0;
  return f;
}
/** Pièce jointe d'un message : contenu en base64 (aperçu ou téléchargement dans l'appli). */
function adminMailsPiece(cle, messageId, pieceId) {
  verifierCle_(cle);
  var r = gmailGet_('messages/' + encodeURIComponent(messageId) + '/attachments/' + encodeURIComponent(pieceId));
  if (!r || !r.data) throw new Error('Pièce jointe introuvable.');
  if (Number(r.size || 0) > 25e6) throw new Error('Pièce trop lourde pour l\'appli : ouvrez-la dans Gmail.');
  return { data: base64Standard_(r.data), taille: Number(r.size || 0) };
}

// ----- Actions sur des fils -----
/** action : archiver, corbeille, restaurer, lu, nonLu, suivre, nePlusSuivre, boiteReception, spam, nonSpam, libeller, retirerLibelle, deplacer, traite, nonTraite, creerLibelle, etiquette (param : clé d'étiquette Festival, actif via param2) */
function adminMailsAction(cle, ids, action, param, param2) {
  verifierCle_(cle);
  oublierCache_(['gm:dossiers']);
  if (action === 'creerLibelle') {
    var nouveau = String(param || '').trim(); if (!nouveau) throw new Error('Donnez un nom au libellé.');
    idLibelle_(nouveau, true);
    return { n: 0, libelle: nouveau };
  }
  ids = (ids || []).map(String).filter(Boolean).slice(0, 100);
  if (!ids.length) return { n: 0 };
  var corps = null, chemin = 'modify';
  if (action === 'archiver') corps = { removeLabelIds: ['INBOX'] };
  else if (action === 'boiteReception') corps = { addLabelIds: ['INBOX'], removeLabelIds: ['SPAM', 'TRASH'] };
  else if (action === 'lu') corps = { removeLabelIds: ['UNREAD'] };
  else if (action === 'nonLu') corps = { addLabelIds: ['UNREAD'] };
  else if (action === 'suivre') corps = { addLabelIds: ['STARRED'] };
  else if (action === 'nePlusSuivre') corps = { removeLabelIds: ['STARRED'] };
  else if (action === 'spam') corps = { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] };
  else if (action === 'nonSpam') corps = { addLabelIds: ['INBOX'], removeLabelIds: ['SPAM'] };
  else if (action === 'corbeille') chemin = 'trash';
  else if (action === 'restaurer') chemin = 'untrash';
  else if (action === 'traite') corps = { addLabelIds: [idLibelle_(MAILS.prefixe + MAILS.traite, true)], removeLabelIds: ['INBOX'] };
  else if (action === 'nonTraite') { var tId = idLibelle_(MAILS.prefixe + MAILS.traite, false); corps = { addLabelIds: ['INBOX'] }; if (tId) corps.removeLabelIds = [tId]; }
  else if (action === 'etiquette') { // étiquette du festival (annulation, places, question, autre) ajoutée ou retirée
    var nomEt = MAILS.etiquettes[param]; if (!nomEt) throw new Error('Étiquette inconnue.');
    var idEt = idLibelle_(MAILS.prefixe + nomEt, !!param2); if (!idEt) return { n: 0 };
    corps = param2 ? { addLabelIds: [idEt] } : { removeLabelIds: [idEt] };
  } else if (action === 'libeller' || action === 'deplacer' || action === 'retirerLibelle') {
    var nom = String(param || '').trim(); if (!nom) throw new Error('Choisissez un libellé.');
    var idL = idLibelle_(nom, action !== 'retirerLibelle'); if (!idL) return { n: 0 };
    corps = action === 'retirerLibelle' ? { removeLabelIds: [idL] } : { addLabelIds: [idL] };
    if (action === 'deplacer') corps.removeLabelIds = ['INBOX'];
  } else throw new Error('Action inconnue : ' + action);
  var reps = gmailParallele_(ids.map(function (id) { return { chemin: 'threads/' + encodeURIComponent(id) + '/' + chemin, method: 'post', body: corps || {} }; }));
  var faits = reps.filter(Boolean).length;
  if (!faits) throw new Error('Gmail n\'a pas appliqué l\'action : réessayez.');
  return { n: faits };
}

// ----- Écrire : brouillons, envoi -----
/** HTML final du message : texte écrit + pied de page du festival (facultatif) + conversation citée. */
function htmlMail_(m, r) {
  var corps = String(m.html || '').trim();
  var pied = m.pied === false ? '' : MAIL.pied(r);
  var cit = String(m.citation || '').trim();
  return '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:16px;line-height:1.55;color:#1b1733">' + corps + pied + '</div>' +
    (cit ? '<br><div class="gmail_quote" style="margin:12px 0 0;padding-left:12px;border-left:2px solid #ccc;color:#555">' + cit + '</div>' : '');
}
function texteDeHtml_(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/\n{3,}/g, '\n\n').trim();
}
/** Pièces jointes envoyées par l'appli { nom, type, base64 } → blobs (15 Mo par fichier, 20 Mo en tout). */
function piecesDuMail_(m) {
  var total = 0;
  return (m.pieces || []).filter(function (p) { return p && p.base64; }).map(function (p) {
    var nom = String(p.nom || 'fichier').replace(/[\\/:*?"<>|\r\n]+/g, '-').trim().slice(0, 150) || 'fichier';
    var type = /^[\w.+-]+\/[\w.+-]+$/.test(String(p.type || '')) ? String(p.type) : 'application/octet-stream';
    var s = String(p.base64).replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    var taille = Math.floor(s.length * 3 / 4);
    if (taille > MAILS.maxPiece) throw new Error('« ' + nom + ' » est trop lourd (15 Mo au plus).');
    total += taille;
    if (total > MAILS.maxPieces) throw new Error('Pièces jointes trop lourdes (20 Mo au plus en tout).');
    return Utilities.newBlob(Utilities.base64Decode(s), type, nom);
  });
}
/** Transfert : les pièces jointes du message d'origine sont relues dans Gmail et jointes. */
function piecesTransferees_(m) {
  if (m.mode !== 'transferer' || !m.messageId) return [];
  var orig = gmailGet_('messages/' + encodeURIComponent(m.messageId) + '?format=full'), l = [];
  (function parcourir(p) {
    if (!p) return;
    var cid = String(entete_({ payload: p }, 'Content-ID') || '');
    if (p.filename && p.body && p.body.attachmentId && !(cid && /^inline/i.test(entete_({ payload: p }, 'Content-Disposition'))) && Number(p.body.size || 0) < MAILS.maxPiece) l.push(p);
    (p.parts || []).forEach(parcourir);
  })(orig.payload);
  var lus = gmailParallele_(l.map(function (p) { return 'messages/' + encodeURIComponent(m.messageId) + '/attachments/' + encodeURIComponent(p.body.attachmentId); }));
  return l.map(function (p, i) { return lus[i] && lus[i].data ? Utilities.newBlob(Utilities.base64DecodeWebSafe(lus[i].data), p.mimeType || 'application/octet-stream', p.filename) : null; }).filter(Boolean);
}
/** Message MIME complet (texte + HTML + pièces jointes), en-têtes de réponse si le mail prend place dans un fil. */
function mimeMail_(m, r) {
  var mot = function (s) { return '=?UTF-8?B?' + Utilities.base64Encode(Utilities.newBlob(String(s)).getBytes()) + '?='; };
  var b64 = function (octets) { return Utilities.base64Encode(octets).replace(/.{76}/g, '$&\r\n'); };
  var sures = function (t) { return adressesDe_(t).filter(emailValide_).filter(function (x, i, tt) { return tt.indexOf(x) === i; }).join(', '); };
  var a = sures(m.a), cc = sures(m.cc), cci = sures(m.cci);
  if (!a) throw new Error('Indiquez au moins un destinataire (adresse e-mail complète).');
  var html = htmlMail_(m, r), texte = texteDeHtml_(html), objet = String(m.objet || '').trim(), mid = '', refs = '';
  if (m.filId) {
    var fil = gmailGet_('threads/' + encodeURIComponent(m.filId) + '?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject');
    var ms = (fil.messages || []).filter(function (x) { return (x.labelIds || []).indexOf('DRAFT') < 0; });
    if (ms.length) {
      var dernier = (m.messageId && ms.filter(function (x) { return x.id === m.messageId; })[0]) || ms[ms.length - 1];
      mid = entete_(dernier, 'Message-ID'); refs = (entete_(dernier, 'References') + ' ' + mid).trim();
      if (!objet) objet = 'Re: ' + entete_(ms[0], 'Subject').replace(/^(re|tr|fwd?)\s*:\s*/i, '');
    }
  }
  var pieces = piecesDuMail_(m).concat(piecesTransferees_(m));
  var r0 = 'mix_' + Utilities.getUuid(), r2 = 'alt_' + Utilities.getUuid();
  var l = ['From: ' + mot(r.nomFestival || 'Festival') + ' <' + monAdresse_() + '>', 'To: ' + a];
  if (cc) l.push('Cc: ' + cc);
  if (cci) l.push('Bcc: ' + cci);
  l.push('Subject: ' + mot(objet || '(sans objet)'));
  if (mid && m.mode !== 'transferer') l.push('In-Reply-To: ' + mid, 'References: ' + refs);
  l.push('MIME-Version: 1.0');
  if (pieces.length) l.push('Content-Type: multipart/mixed; boundary="' + r0 + '"', '', '--' + r0);
  l.push('Content-Type: multipart/alternative; boundary="' + r2 + '"', '',
    '--' + r2, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(Utilities.newBlob(texte).getBytes()),
    '--' + r2, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(Utilities.newBlob(html).getBytes()), '--' + r2 + '--', '');
  pieces.forEach(function (bl) {
    var nom = mot(bl.getName() || 'fichier');
    l.push('--' + r0, 'Content-Type: ' + (bl.getContentType() || 'application/octet-stream') + '; name="' + nom + '"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="' + nom + '"', '', b64(bl.getBytes()));
  });
  if (pieces.length) l.push('--' + r0 + '--', '');
  return { raw: Utilities.base64EncodeWebSafe(l.join('\r\n')), a: a, objet: objet || '(sans objet)' };
}
function cleParti_(m) { return m && m.cleSecours ? 'gm:parti:' + String(m.cleSecours).replace(/[^\w-]/g, '').slice(0, 40) : ''; }
function dejaParti_(m) { var k = cleParti_(m); if (!k) return false; try { return !!CacheService.getScriptCache().get(k); } catch (e) { return false; } }
function noterParti_(m) { var k = cleParti_(m); if (k) try { CacheService.getScriptCache().put(k, '1', 21600); } catch (e) { /* facultatif */ } }
/** Enregistre (ou met à jour) le brouillon Gmail du mail en cours : { brouillonId, messageId, filId } ; dejaParti si le mail est déjà envoyé ou programmé. */
function brouillonMail_(m) {
  if (!m.__pourEnvoi && dejaParti_(m)) return { brouillonId: '', dejaParti: true };
  var r = reglages_(), x = mimeMail_(m, r), corps = { message: { raw: x.raw } };
  if (m.filId && m.mode !== 'transferer') corps.message.threadId = m.filId;
  var d;
  if (m.brouillonId) {
    try { d = gmailEcrire_('drafts/' + encodeURIComponent(m.brouillonId), 'put', corps); }
    catch (e) { if (!/Introuvable/.test(String(e.message))) throw e; d = gmailEcrire_('drafts', 'post', corps); } // supprimé entre-temps : recréé
  } else d = gmailEcrire_('drafts', 'post', corps);
  oublierBrouillons_();
  return { brouillonId: d.id, messageId: d.message && d.message.id, filId: d.message && d.message.threadId, a: x.a, objet: x.objet };
}
function adminMailsBrouillon(cle, m) { verifierCle_(cle); var r = brouillonMail_(m || {}); return r.dejaParti ? { brouillonId: '', dejaParti: true } : { brouillonId: r.brouillonId, messageId: r.messageId, filId: r.filId }; }
function adminMailsSupprimerBrouillon(cle, id) {
  verifierCle_(cle);
  if (!id) return true;
  var progs = brouillonsProgrammes_(); if (progs[id]) throw new Error('Ce mail est programmé : annulez l\'envoi programmé plutôt.');
  try { gmailEcrire_('drafts/' + encodeURIComponent(String(id)), 'delete'); } catch (e) { if (!/Introuvable/.test(String(e.message))) throw e; }
  oublierBrouillons_();
  return true;
}
/** Envoie le mail (sur clic « Envoyer » confirmé). Après l'envoi, le fil peut être marqué « Traité ». */
function envoyerMail_(m) {
  if (dejaParti_(m)) throw new Error('Ce mail vient déjà d\'être envoyé (ou programmé).');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Google n\'autorise plus d\'e-mail aujourd\'hui depuis ce compte : réessayez demain, ou programmez l\'envoi.');
  var b = brouillonMail_(Object.assign({}, m, { __pourEnvoi: true }));
  var envoye = gmailEcrire_('drafts/send', 'post', { id: b.brouillonId });
  noterParti_(m); oublierBrouillons_();
  var fil = envoye.threadId || b.filId || '';
  if (m.traite && fil) { try { adminMailsActionInterne_([fil], 'traite'); } catch (e) { /* le mail est parti : le classement se fait à la main */ } }
  return { envoye: true, fil: fil, message: envoye.id || '', a: b.a };
}
function adminMailsActionInterne_(ids, action) { return adminMailsAction(PropertiesService.getScriptProperties().getProperty(RESA.cleAdmin), ids, action); }
function adminMailsEnvoyer(cle, m) { verifierCle_(cle); return envoyerMail_(m || {}); }

// ----- Envois programmés -----
function ongletProgrammes_() { return onglet_(MAILS.onglet, COL_PROG); }
function lignesProgrammes_() {
  var f = SpreadsheetApp.getActive().getSheetByName(MAILS.onglet);
  if (!f || f.getLastRow() < 2) return [];
  return f.getRange(2, 1, f.getLastRow() - 1, COL_PROG.length).getDisplayValues().map(function (l, i) { var o = objetDeLigne_(l, CHAMPS_PROG); o._ligne = i + 2; return o; }).filter(function (o) { return o.id; });
}
function ligneProgramme_(id) {
  var l = lignesProgrammes_().filter(function (x) { return x.id === String(id); })[0];
  if (!l) throw new Error('Envoi programmé introuvable.');
  return l;
}
function ecrireProgramme_(l, maj) {
  var f = ongletProgrammes_(), o = {}; CHAMPS_PROG.forEach(function (k) { o[k] = l[k] || ''; });
  Object.keys(maj).forEach(function (k) { o[k] = maj[k]; l[k] = maj[k]; });
  ecrireLigne_(f, l._ligne, CHAMPS_PROG, o);
}
function resumeProgramme_(l) {
  return { id: l.id, prevu: Number(l.prevu) || 0, a: l.a, objet: l.objet, statut: l.statut, essais: Number(l.essais) || 0, raison: l.raison, envoyeLe: l.envoyeLe, fil: l.fil, brouillon: l.brouillon, traiter: l.traiter === 'Oui', par: l.par };
}
/** À venir, en échec, et ceux partis ces 3 derniers jours. */
function listeProgrammes_() {
  var limite = Date.now() - 3 * 86400000;
  return lignesProgrammes_().filter(function (l) {
    if (l.statut === STATUTS_PROG.annule) return false;
    if (l.statut === STATUTS_PROG.envoye) { var t = Date.parse(String(l.envoyeLe).replace(' ', 'T')); return !t || t > limite; }
    return true;
  }).map(resumeProgramme_).sort(function (x, y) {
    var px = x.statut === STATUTS_PROG.envoye ? 1 : 0, py = y.statut === STATUTS_PROG.envoye ? 1 : 0;
    return px - py || (px ? String(y.envoyeLe).localeCompare(String(x.envoyeLe)) : x.prevu - y.prevu);
  });
}
function adminMailsProgrammes(cle) { verifierCle_(cle); return listeProgrammes_(); }
function avecVerrouMails_(f) {
  var verrou = LockService.getScriptLock(); verrou.waitLock(25000);
  try { return f(); } finally { verrou.releaseLock(); }
}
/** Programme (ou modifie) un mail : son brouillon Gmail est gardé et part à l'heure dite. quand : millisecondes. */
function adminMailsProgrammer(cle, m, quand, id, par) {
  verifierCle_(cle);
  m = m || {};
  var t = Number(quand);
  if (!(t > Date.now() + 60000)) throw new Error('Choisissez une heure à venir (au moins dans une minute).');
  if (t > Date.now() + 366 * 86400000) throw new Error('Choisissez une date dans l\'année qui vient.');
  return avecVerrouMails_(function () {
    if (id) { var l = ligneProgramme_(id); if (l.statut !== STATUTS_PROG.attente && l.statut !== STATUTS_PROG.echec) throw new Error('Ce mail n\'est plus modifiable : ' + l.statut.toLowerCase() + '.'); m.brouillonId = m.brouillonId || l.brouillon; }
    var b = brouillonMail_(Object.assign({}, m, { __pourEnvoi: true }));
    noterParti_(m);
    var valeurs = { prevu: String(t), a: b.a, objet: b.objet, statut: STATUTS_PROG.attente, essais: '0', raison: '', fil: b.filId || '', brouillon: b.brouillonId, traiter: m.traite ? 'Oui' : '', par: String(par || '').slice(0, 60) };
    if (id) ecrireProgramme_(ligneProgramme_(id), valeurs);
    else { id = 'E' + Utilities.formatDate(new Date(), 'Europe/Zurich', 'yyMMddHHmmss') + Math.floor(Math.random() * 900 + 100); ajouterLigne_(ongletProgrammes_(), CHAMPS_PROG, Object.assign({ id: id, cree: maintenant_(), envoyeLe: '' }, valeurs)); }
    SpreadsheetApp.flush();
    try { planifierProchainEnvoi_(); } catch (e) { console.warn('Déclencheur : ' + e); }
    oublierBrouillons_();
    return { id: id, prevu: t, liste: listeProgrammes_() };
  });
}
/** Envoie un mail programmé : son brouillon part tel quel. L'échec est noté, jamais renvoyé ici. */
function envoyerUnProgramme_(id) {
  var l = ligneProgramme_(id);
  if (l.statut !== STATUTS_PROG.attente && l.statut !== STATUTS_PROG.echec) throw new Error('Ce mail est déjà ' + l.statut.toLowerCase() + '.');
  ecrireProgramme_(l, { statut: STATUTS_PROG.cours }); SpreadsheetApp.flush();
  var envoye;
  try {
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Quota Gmail du jour atteint.');
    envoye = gmailEcrire_('drafts/send', 'post', { id: l.brouillon });
  } catch (e) {
    var raison = /Introuvable/.test(String(e.message)) ? 'Le brouillon de ce mail n\'existe plus dans Gmail (supprimé ou déjà envoyé à la main).' : String(e && e.message ? e.message : e).slice(0, 300);
    ecrireProgramme_(l, { statut: STATUTS_PROG.echec, essais: String((Number(l.essais) || 0) + 1), raison: raison }); SpreadsheetApp.flush();
    throw new Error(raison);
  }
  var fil = envoye.threadId || l.fil || '';
  ecrireProgramme_(l, { statut: STATUTS_PROG.envoye, envoyeLe: maintenant_(), fil: fil, raison: '' }); SpreadsheetApp.flush();
  oublierBrouillons_();
  if (l.traiter === 'Oui' && fil) { try { adminMailsActionInterne_([fil], 'traite'); } catch (e) { /* à la main */ } }
  return { id: id, envoye: true, fil: fil };
}
/** Envoie ceux dont l'heure est venue ; filet : réessaie une fois ceux en échec. Un « Envoi en cours » interrompu passe en échec, jamais renvoyé tout seul. */
function envoyerProgrammesDus_(filet) {
  if (!SpreadsheetApp.getActive().getSheetByName(MAILS.onglet)) return 0;
  return avecVerrouMails_(function () {
    var n = 0, maintenant = Date.now();
    lignesProgrammes_().forEach(function (l) {
      var prevu = Number(l.prevu) || 0;
      if (l.statut === STATUTS_PROG.cours) { ecrireProgramme_(l, { statut: STATUTS_PROG.echec, essais: '2', raison: 'Envoi interrompu : regardez dans « Envoyés » s\'il est parti avant de le renvoyer.' }); return; }
      var du = l.statut === STATUTS_PROG.attente && prevu && prevu <= maintenant + 60000;
      var reessai = filet && l.statut === STATUTS_PROG.echec && (Number(l.essais) || 0) < 2 && !/n'existe plus/.test(l.raison);
      if (!du && !reessai) return;
      if (quotaEpuise_()) return reporterAuLendemain_(l);
      try { envoyerUnProgramme_(l.id); n++; } catch (e) { if (/quota|too many times|trop de fois/i.test(String(e))) reporterAuLendemain_(ligneProgramme_(l.id)); console.warn('Envoi programmé ' + l.id + ' : ' + e); }
    });
    try { planifierProchainEnvoi_(); } catch (e) { console.warn('Déclencheur : ' + e); }
    return n;
  });
}
function quotaEpuise_() { try { return MailApp.getRemainingDailyQuota() <= 0; } catch (e) { return false; } }
/** Demain 9 h, heure de Genève. */
function demain9hGeneve_() {
  var jour = Utilities.formatDate(new Date(Date.now() + 864e5), 'Europe/Zurich', 'yyyy-MM-dd').split('-').map(Number);
  var t = Date.UTC(jour[0], jour[1] - 1, jour[2], 9, 0, 0);
  for (var i = 0; i < 2; i++) { var h = Number(Utilities.formatDate(new Date(t), 'Europe/Zurich', 'HH')), mi = Number(Utilities.formatDate(new Date(t), 'Europe/Zurich', 'mm')); t -= ((h - 9) * 60 + mi) * 60000; }
  return t;
}
function reporterAuLendemain_(l) {
  var quand = demain9hGeneve_();
  ecrireProgramme_(l, { statut: STATUTS_PROG.attente, prevu: String(quand), raison: 'Quota Gmail du jour atteint : reprogrammé le ' + Utilities.formatDate(new Date(quand), 'Europe/Zurich', 'dd.MM.yyyy') + ' à 9 h.' });
  SpreadsheetApp.flush();
}
/** Un seul déclencheur ponctuel, à l'heure du prochain mail programmé (retiré s'il n'y en a plus). */
function planifierProchainEnvoi_() {
  var heures = lignesProgrammes_().filter(function (l) { return l.statut === STATUTS_PROG.attente && Number(l.prevu); }).map(function (l) { return Number(l.prevu); }).sort(function (a, b) { return a - b; });
  var voulu = heures.length ? Math.max(heures[0], Date.now() + 60000) : 0, p = PropertiesService.getScriptProperties();
  var existants = ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'envoyerProgrammes'; });
  if (existants.length === (voulu ? 1 : 0) && Number(p.getProperty('MAILS_DECLENCHEUR') || 0) === voulu) return;
  existants.forEach(function (x) { ScriptApp.deleteTrigger(x); });
  p.deleteProperty('MAILS_DECLENCHEUR');
  if (!voulu) return;
  ScriptApp.newTrigger('envoyerProgrammes').timeBased().at(new Date(voulu)).create();
  p.setProperty('MAILS_DECLENCHEUR', String(voulu));
}
/** Déclencheur ponctuel : envoie les mails dont l'heure est venue (et réessaie une fois ceux en échec). */
function envoyerProgrammes() {
  try { PropertiesService.getScriptProperties().deleteProperty('MAILS_DECLENCHEUR'); } catch (e) { /* reposé après */ }
  envoyerProgrammesDus_(true);
}
function adminMailsProgrammeEnvoyer(cle, id) {
  verifierCle_(cle);
  return avecVerrouMails_(function () { var r = envoyerUnProgramme_(String(id)); try { planifierProchainEnvoi_(); } catch (e) { /* au prochain passage */ } r.liste = listeProgrammes_(); return r; });
}
function adminMailsProgrammeAnnuler(cle, id, garderBrouillon) {
  verifierCle_(cle);
  return avecVerrouMails_(function () {
    var l = ligneProgramme_(String(id));
    if (l.statut !== STATUTS_PROG.attente && l.statut !== STATUTS_PROG.echec) throw new Error('Trop tard : ce mail est ' + l.statut.toLowerCase() + '.');
    ecrireProgramme_(l, { statut: STATUTS_PROG.annule });
    if (!garderBrouillon && l.brouillon) { try { gmailEcrire_('drafts/' + encodeURIComponent(l.brouillon), 'delete'); } catch (e) { /* déjà retiré */ } }
    try { planifierProchainEnvoi_(); } catch (e) { /* au prochain passage */ }
    oublierBrouillons_();
    return { id: l.id, annule: true, liste: listeProgrammes_() };
  });
}
/** Mail programmé rouvert pour être modifié : son brouillon Gmail, prêt pour l'éditeur. */
function adminMailsProgrammeLire(cle, id) {
  verifierCle_(cle);
  var l = ligneProgramme_(String(id));
  if (l.statut !== STATUTS_PROG.attente && l.statut !== STATUTS_PROG.echec) throw new Error('Ce mail est ' + l.statut.toLowerCase() + '.');
  var d = gmailGet_('drafts/' + encodeURIComponent(l.brouillon) + '?format=full'), m = d.message || {};
  var c = contenuMessage_(m, {});
  return { resume: resumeProgramme_(l), brouillonId: d.id, filId: m.threadId || l.fil || '', a: entete_(m, 'To'), cc: entete_(m, 'Cc'), cci: entete_(m, 'Bcc'), objet: entete_(m, 'Subject'), html: c.html, pieces: c.pieces };
}

/** Change le nombre de places d'une réservation (demande reçue par e-mail). Pas d'e-mail automatique. */
function adminModifierPlaces(cle, id, places) {
  verifierCle_(cle);
  places = Math.floor(Number(places));
  if (!(places >= 1 && places <= 50)) throw new Error('Nombre de places entre 1 et 50.');
  var verrou = LockService.getScriptLock(); verrou.waitLock(20000);
  try {
    var feuille = onglet_(RESA.ongletReservations, COL_RES), n = ligneDe_(feuille, id);
    if (!n) throw new Error('Réservation introuvable.');
    feuille.getRange(n, CHAMPS_RES.indexOf('places') + 1).setValue(String(places));
  } finally { verrou.releaseLock(); }
  oublierResasMails_();
  return adminCharger(cle);
}
