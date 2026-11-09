// ---------- Boîte : les réponses du public, lues et traitées depuis l'appli ----------
// Ne montre que les fils utiles au festival : réponses à nos e-mails, ou messages d'une personne qui a réservé.
// Le reste de la boîte Gmail du festival n'est jamais envoyé à l'appli.

var BOITE = {
  prefixe: 'Festival/',
  traite: 'Traité',
  etiquettes: { annulation: 'Annulation', places: 'Changement de places', question: 'Question', autre: 'Autre' },
  max: 40
};

function adresseDe_(de) { var m = /<([^>]+)>/.exec(String(de || '')); return (m ? m[1] : String(de || '')).trim().toLowerCase(); }
function nomDe_(de) { var m = /^\s*"?([^"<]*?)"?\s*</.exec(String(de || '')); return (m && m[1].trim()) || adresseDe_(de); }
function dateCourte_(d) { return Utilities.formatDate(d, 'Europe/Zurich', 'yyyy-MM-dd HH:mm'); }
function libelleGmail_(nom) { return GmailApp.getUserLabelByName(BOITE.prefixe + nom) || GmailApp.createLabel(BOITE.prefixe + nom); }

/** Texte d'un message sans la partie citée (« Le … a écrit : » et lignes en « > »). */
function sansCitation_(texte) {
  var lignes = String(texte || '').replace(/\r/g, '').split('\n'), garde = [];
  for (var i = 0; i < lignes.length; i++) {
    var l = lignes[i];
    if (/^\s*>/.test(l)) break;
    if (/^(Le|On|Am|El)\s.{4,200}(a écrit|wrote|schrieb|escribió)\s*:?\s*$/i.test(l.trim())) break;
    if (/^-{2,}\s*(Message d'origine|Original Message)/i.test(l.trim())) break;
    garde.push(l);
  }
  return garde.join('\n').replace(/\n{3,}/g, '\n\n').trim() || String(texte || '').trim();
}

function reservationsParEmail_() {
  var evs = {}; lireEvenements_().forEach(function (e) { evs[e.id] = e; });
  var par = {};
  lireReservations_().forEach(function (r) {
    var k = String(r.email || '').trim().toLowerCase(); if (!k) return;
    var e = evs[r.evenement] || {};
    (par[k] = par[k] || []).push({ id: r.id, evenement: r.evenement, titre: r.titreEvenement || e.titre || '', date: e.date || '', debut: e.debut || '', places: r.places, statut: r.statut, nom: r.nom });
  });
  return par;
}

function etiquettesFil_(t) {
  return t.getLabels().map(function (l) { return l.getName(); }).filter(function (n) { return n.indexOf(BOITE.prefixe) === 0; }).map(function (n) { return n.slice(BOITE.prefixe.length); });
}

/** Fils à montrer : dossier « inbox » (à traiter), « traites », ou « nonlus » (pour le compteur). */
function filsBoite_(dossier, max) {
  var moi = expediteur_().toLowerCase(), par = reservationsParEmail_();
  var fils = dossier === 'traites' ? libelleGmail_(BOITE.traite).getThreads(0, max) : GmailApp.search(dossier === 'nonlus' ? 'in:inbox is:unread' : 'in:inbox', 0, max);
  if (!fils.length) return [];
  var tous = GmailApp.getMessagesForThreads(fils), l = [];
  fils.forEach(function (t, i) {
    var ms = tous[i], autres = ms.filter(function (m) { return adresseDe_(m.getFrom()) !== moi; });
    if (!autres.length) return; // seulement nos propres envois (copies, essais)
    var dernier = autres[autres.length - 1], qui = adresseDe_(dernier.getFrom()), resas = par[qui] || [];
    var reponseANous = adresseDe_(ms[0].getFrom()) === moi;
    if (!reponseANous && !resas.length) return; // ni réponse à un de nos e-mails, ni personne qui a réservé
    var auto = '';
    try { auto = String(dernier.getHeader('Auto-Submitted') || ''); } catch (e) {}
    l.push({
      id: t.getId(), sujet: t.getFirstMessageSubject() || '(sans objet)', nom: nomDe_(dernier.getFrom()), email: qui,
      date: dateCourte_(t.getLastMessageDate()), extrait: sansCitation_(dernier.getPlainBody()).replace(/\s+/g, ' ').slice(0, 160),
      nonLu: t.isUnread(), nb: ms.length, repondu: adresseDe_(ms[ms.length - 1].getFrom()) === moi,
      automatique: !!auto && !/^no$/i.test(auto), etiquettes: etiquettesFil_(t), resas: resas
    });
  });
  return l;
}

function adminBoite(cle, dossier) {
  verifierCle_(cle);
  return { fils: filsBoite_(dossier === 'traites' ? 'traites' : 'inbox', BOITE.max), etiquettes: BOITE.etiquettes, dossier: dossier === 'traites' ? 'traites' : 'inbox' };
}

/** Nombre de fils non lus pour le compteur de l'onglet (0 si Gmail n'est pas encore autorisé). */
function boiteNonLus_() {
  try { return filsBoite_('nonlus', 20).length; } catch (e) { return -1; }
}

function filOuErreur_(id) {
  var t = null;
  try { t = GmailApp.getThreadById(String(id || '')); } catch (e) {}
  if (!t) throw new Error('Ce message n\'existe plus dans la boîte du festival.');
  return t;
}

function adminLireFil(cle, id) {
  verifierCle_(cle);
  var t = filOuErreur_(id), moi = expediteur_().toLowerCase(), ms = t.getMessages();
  var qui = '';
  ms.forEach(function (m) { var a = adresseDe_(m.getFrom()); if (a !== moi) qui = a; });
  if (t.isUnread()) t.markRead();
  return {
    id: t.getId(), sujet: t.getFirstMessageSubject() || '(sans objet)', email: qui, etiquettes: etiquettesFil_(t),
    traite: !t.isInInbox(), resas: reservationsParEmail_()[qui] || [],
    messages: ms.map(function (m) {
      var a = adresseDe_(m.getFrom());
      return { moi: a === moi, nom: a === moi ? 'Le festival' : nomDe_(m.getFrom()), email: a, date: dateCourte_(m.getDate()), texte: sansCitation_(m.getPlainBody()).slice(0, 20000) };
    })
  };
}

function adminRepondreFil(cle, id, texte, traite) {
  verifierCle_(cle);
  texte = String(texte || '').trim();
  if (!texte) throw new Error('La réponse est vide.');
  var t = filOuErreur_(id), moi = expediteur_().toLowerCase(), r = reglages_();
  var ms = t.getMessages().filter(function (m) { return adresseDe_(m.getFrom()) !== moi; });
  if (!ms.length) throw new Error('Personne à qui répondre dans ce fil.');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Google n\'autorise plus d\'e-mail aujourd\'hui : réessayez demain.');
  var html = '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:16px;line-height:1.55;color:#1b1733">' + MAIL.texteVersHtml(texte, MAIL.THEMES.clair) + '</div>';
  ms[ms.length - 1].reply(texte, { htmlBody: html, name: r.nomFestival });
  if (traite) { t.addLabel(libelleGmail_(BOITE.traite)); t.moveToArchive(); }
  return adminLireFil(cle, id);
}

/** Étiquette (annulation, places, question, autre) ou « traite » : ajoutée si actif, retirée sinon. */
function adminClasserFil(cle, id, etiquette, actif) {
  verifierCle_(cle);
  var t = filOuErreur_(id);
  if (etiquette === 'traite') {
    if (actif) { t.addLabel(libelleGmail_(BOITE.traite)); t.moveToArchive(); }
    else { t.removeLabel(libelleGmail_(BOITE.traite)); t.moveToInbox(); }
  } else {
    var nom = BOITE.etiquettes[etiquette];
    if (!nom) throw new Error('Étiquette inconnue.');
    if (actif) t.addLabel(libelleGmail_(nom)); else t.removeLabel(libelleGmail_(nom));
  }
  return adminLireFil(cle, id);
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
  return adminCharger(cle);
}
