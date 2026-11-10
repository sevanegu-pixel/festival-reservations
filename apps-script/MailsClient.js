// ===== Mails : la boîte Gmail du festival dans l'appli (reprise de l'appli Diffusion) =====
// Liste gardée sur l'appareil (affichée tout de suite, puis mise à jour), conversations préparées en arrière-plan,
// trois colonnes fixes sur ordinateur (séparateurs glissables), liste puis conversation sur téléphone,
// brouillons enregistrés dans Gmail toutes les 5 s + copie de secours sur l'appareil, envois programmés.
var BOITE_NL = null;
var MX = { dossier: 'reception', libelle: '', recherche: '', jeton: '', pile: [], fils: null, jetonSuite: '', cache: {}, dossiers: null, coches: {}, fil: null,
  filsGardes: {}, ordre: [], enCours: {}, programmes: null, public: false, ouverture: 0, charge: false, enRoute: null, libellesVus: [] };
var DOSSIERS_MX = [['reception', 'Boîte de réception', '📥'], ['suivis', 'Suivis', '★'], ['traites', 'Traités', '✓'], ['brouillons', 'Brouillons', '✎'], ['programmes', 'Programmés', '⏱'], ['envoyes', 'Envoyés', '➤'], ['tous', 'Tous les mails', '▤'], ['spam', 'Spam', '⚠'], ['corbeille', 'Corbeille', '🗑']];
var REPONSES_RAPIDES = [
  ['Annulation notée', 'Bonjour {prenom},\n\nC\'est noté : votre réservation pour « {titre} » du {date} est annulée. Merci de nous avoir prévenus !\n\nÀ une prochaine fois,\n{festival}'],
  ['Places changées', 'Bonjour {prenom},\n\nC\'est fait : votre réservation pour « {titre} » du {date} est maintenant de {places} place(s).\n\nÀ bientôt !\n{festival}'],
  ['Complet, liste d\'attente', 'Bonjour {prenom},\n\nMerci pour votre message. La représentation de « {titre} » du {date} est complète ; nous vous inscrivons sur la liste d\'attente et vous prévenons dès qu\'une place se libère.\n\n{festival}'],
  ['Merci', 'Bonjour {prenom},\n\nMerci pour votre message !\n\n{festival}']
];
function badgeBoite() {
  document.querySelectorAll('[data-vue=boite], [data-bvue=boite]').forEach(function (b) {
    var p = b.querySelector('.pastille');
    if (BOITE_NL > 0) { if (!p) { p = document.createElement('span'); p.className = 'pastille'; b.appendChild(p); } p.textContent = BOITE_NL; } else if (p) p.remove();
  });
}
function surTelephone() { return innerWidth < 1000; }
function mxFixe() { return document.documentElement.classList.contains('mx-fixe'); }
function appelMx(fn, args, ok, echec, silencieux) { appel(fn, args, ok, { echec: echec, silencieux: silencieux }); }
function quandCourt(iso) {
  if (!iso) return '';
  var d = new Date(iso), auj = new Date();
  if (isNaN(d)) return iso;
  if (d.toDateString() === auj.toDateString()) return iso.slice(11, 16).replace(':', 'h');
  return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + (d.getFullYear() !== auj.getFullYear() ? '.' + d.getFullYear() : '');
}
function dateHeureFr(iso) { if (!iso) return ''; var p = iso.split('T'); return p[0].split('-').reverse().join('.') + (p[1] ? ' à ' + p[1].replace(':', 'h') : ''); }
function adresseDe(texte) { var m = String(texte || '').match(/[^\s<>,;"']+@[^\s<>,;"']+\.[a-z]{2,}/i); return m ? m[0].toLowerCase() : ''; }
function adressesDe(texte) { return (String(texte || '').match(/[^\s<>,;"']+@[^\s<>,;"']+\.[a-z]{2,}/ig) || []).map(function (x) { return x.toLowerCase(); }); }
function nomCourt(texte) { var t = String(texte || '').split(',')[0].trim(), m = t.match(/^"?([^"<]+?)"?\s*</); return m ? m[1].trim() : t.replace(/[<>]/g, ''); }
function moiMail() { return String((MX.dossiers && MX.dossiers.moi) || D.expediteur || '').toLowerCase(); }
function texteDeHtml(h) { var d = document.createElement('div'); d.innerHTML = String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ''); return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
function tailleLisible(n) { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1e3)) + ' ko'; }
function resumeResa(r) { return esc(r.titre) + (r.date ? ' · ' + esc(r.date.split('-').reverse().slice(0, 2).join('.')) : '') + ' · ' + r.places + ' pl.' + (r.statut && r.statut !== 'Confirmée' ? ' · ' + esc(r.statut) : ''); }

// ---------- Copie sur l'appareil + préparation en arrière-plan ----------
var CLE_COPIE_MX = 'mails_copie';
function cleListeMx(jeton) { return [MX.dossier, MX.libelle, MX.recherche, MX.public ? 1 : 0, jeton === undefined ? MX.jeton : jeton].join('|'); }
function cleBoiteDefautMx() { return ['reception', '', '', MX.public ? 1 : 0, ''].join('|'); }
function requeteListeMx(jeton) { return { dossier: MX.dossier, libelle: MX.libelle, recherche: MX.recherche, jeton: jeton, public: MX.public }; }
function noterCopieMx(cle, r) {
  if (!r || !r.fils || cle !== cleBoiteDefautMx()) return;
  try { garderLocal(CLE_COPIE_MX, JSON.stringify({ cle: cle, le: Date.now(), r: { fils: r.fils, jetonSuite: r.jetonSuite }, dossiers: MX.dossiers, programmes: MX.programmes })); }
  catch (e) { /* mémoire pleine : pas de copie */ }
}
function semerCopieMx() {
  if (semerCopieMx.fait) return; semerCopieMx.fait = true;
  var m = null; try { m = JSON.parse(lireLocal(CLE_COPIE_MX) || 'null'); } catch (e) { m = null; }
  if (!m || !m.r || !Array.isArray(m.r.fils) || Date.now() - m.le > 7 * 864e5) return;
  if (!MX.cache[m.cle]) MX.cache[m.cle] = Object.assign({}, m.r, { copie: m.le });
  if (!MX.dossiers && m.dossiers) MX.dossiers = m.dossiers;
  if (!MX.programmes && m.programmes) MX.programmes = m.programmes;
}
function chargerDossiersMx(apres) {
  appelMx('adminMailsDossiers', [], function (r) {
    MX.dossiers = r; if (typeof r.comptes.reception === 'number') { BOITE_NL = r.comptes.reception; badgeBoite(); }
    if (vue === 'boite') dessinerDossiersMx();
    noterCopieMx(cleBoiteDefautMx(), MX.cache[cleBoiteDefautMx()]);
    if (apres) apres(r);
  }, function () { return true; }, true);
}
function chargerProgrammesMx(apres) {
  appelMx('adminMailsProgrammes', [], function (l) { MX.programmes = l || []; if (vue === 'boite') { dessinerDossiersMx(); if (MX.dossier === 'programmes' && !MX.libelle) dessinerFilsMx(); majProgrammesFilMx(); } if (apres) apres(l); }, function () { return true; }, true);
}
function prechargerBoiteMx() {
  if (prechargerBoiteMx.fait || !D || !droit('boite') || document.hidden) return;
  prechargerBoiteMx.fait = true;
  semerCopieMx();
  if (vue === 'boite' || MX.charge) return;
  chargerDossiersMx(); chargerProgrammesMx();
  var cle = cleBoiteDefautMx(), route = MX.enRoute = { cle: cle, suites: [] };
  var finir = function () { if (MX.enRoute === route) MX.enRoute = null; };
  appelMx('adminMailsListe', [{ dossier: 'reception', libelle: '', recherche: '', jeton: '', public: MX.public }], function (r) {
    finir(); if (route.suites.length) return route.suites.forEach(function (x) { x[0](r); });
    MX.cache[cle] = r; noterCopieMx(cle, r); preparerRecentsMx();
  }, function (e) { finir(); route.suites.forEach(function (x) { x[1](e); }); return true; }, true);
}
/* Économie du quota Gmail (20 000 appels par jour pour tout le script) : les relectures automatiques ne tournent que si
   quelqu'un a touché l'appli dans les 30 dernières minutes et si l'onglet est visible. */
var ACTIF_MX = Date.now();
['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, function () { ACTIF_MX = Date.now(); }, { passive: true }); });
document.addEventListener('visibilitychange', function () { if (!document.hidden) ACTIF_MX = Date.now(); });
function actifMx() { return !document.hidden && Date.now() - ACTIF_MX < 30 * 60000; }
/* Conversations récentes préparées en arrière-plan (10 sur ordinateur, 4 sur téléphone), toutes les 10 minutes, une seule fois par fil. */
function preparerRecentsMx() {
  if (document.hidden || !D || !droit('boite')) return;
  var l = (MX.cache[cleBoiteDefautMx()] || {}).fils || [], n = surTelephone() ? 4 : 10, k = 0;
  l.slice(0, n).forEach(function (f, i) { if (MX.filsGardes[f.id] || MX.enCours[f.id] || f.brouillon) return; setTimeout(function () { prechargerFilMx(f.id); }, 400 * k++); });
}
function prechargerFilMx(id) {
  if (!id || MX.filsGardes[id] || MX.enCours[id]) return;
  MX.enCours[id] = true;
  appelMx('adminMailsOuvrir', [id, true], function (f) { delete MX.enCours[id]; garderFilMx(f); }, function () { delete MX.enCours[id]; return true; }, true);
}
function garderFilMx(f) {
  if (!f || !f.id) return;
  if (!MX.filsGardes[f.id]) MX.ordre.push(f.id);
  f._lu = Date.now(); MX.filsGardes[f.id] = f;
  while (MX.ordre.length > 40) delete MX.filsGardes[MX.ordre.shift()];
}
function oublierListesMx() { var garde = MX.cache[cleListeMx()]; MX.cache = {}; if (garde && !garde.attente) MX.cache[cleListeMx()] = garde; }
setInterval(function () { if (D && droit('boite') && actifMx()) { if (!prechargerBoiteMx.fait) prechargerBoiteMx(); else { if (vue !== 'boite') rafraichirListeDefautMx(); preparerRecentsMx(); } } }, 600000);
setInterval(function () { if (vue === 'boite' && D && actifMx() && !MX.charge && !MX.fil) chargerFilsMx(true); }, 240000);
function rafraichirListeDefautMx() {
  var cle = cleBoiteDefautMx();
  appelMx('adminMailsListe', [{ dossier: 'reception', libelle: '', recherche: '', jeton: '', public: MX.public }], function (r) { if (r.fils.length || !(MX.cache[cle] || {}).fils) { MX.cache[cle] = r; noterCopieMx(cle, r); } }, function () { return true; }, true);
  chargerDossiersMx();
}

// ---------- Écran ----------
function afficherBoite() {
  semerCopieMx();
  var h = '<div class="mx-tete"><h2>Mails</h2><span class="aide" id="mx-moi">' + (moiMail() ? esc(moiMail()) : '') + '</span><button type="button" class="btn petit" id="mx-actualiser">Actualiser</button><button type="button" class="btn petit plein" id="mx-ecrire-haut">+ Écrire</button></div>' +
    '<div class="mx' + (MX.fil ? ' detail' : '') + '" id="mx">' +
    '<aside class="mx-dossiers" id="mx-dossiers"></aside><div class="mx-sep" data-sep="1" role="separator" aria-orientation="vertical" tabindex="0" title="Glisser pour régler la largeur (double-clic : largeur d\'origine)"></div>' +
    '<section class="mx-col"><div class="mx-chips" id="mx-chips"></div>' +
    '<div class="mx-barre"><input type="search" id="mx-recherche" placeholder="Rechercher dans Gmail…" value="' + esc(MX.recherche) + '" aria-label="Rechercher"><label class="coche" style="font-size:13px"><input type="checkbox" id="mx-public"' + (MX.public ? ' checked' : '') + '> Public seulement</label></div>' +
    '<div class="mx-actions" id="mx-actions"></div><div class="mx-liste" id="mx-liste"></div><div class="mx-pages" id="mx-pages"></div></section>' +
    '<div class="mx-sep" data-sep="2" role="separator" aria-orientation="vertical" tabindex="0" title="Glisser pour régler la largeur (double-clic : largeur d\'origine)"></div>' +
    '<section class="mx-fil" id="mx-fil"></section></div>';
  $('#vue').innerHTML = h;
  $('#mx-actualiser').onclick = function () { MX.cache = {}; MX.filsGardes = {}; MX.ordre = []; chargerDossiersMx(); chargerProgrammesMx(); chargerFilsMx(); if (MX.fil) ouvrirConversationMx(MX.fil.id, true); toast('Mise à jour depuis Gmail…'); };
  $('#mx-ecrire-haut').onclick = function () { composerMx('nouveau', {}); };
  var rech = $('#mx-recherche'), minuterie;
  rech.oninput = function () { clearTimeout(minuterie); minuterie = setTimeout(function () { if (rech.value.trim() !== MX.recherche) { MX.recherche = rech.value.trim(); MX.jeton = ''; MX.pile = []; chargerFilsMx(); } }, 500); };
  rech.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(minuterie); MX.recherche = rech.value.trim(); MX.jeton = ''; MX.pile = []; chargerFilsMx(); } };
  $('#mx-public').onchange = function () { MX.public = this.checked; garderLocal('mails_public', MX.public ? '1' : ''); MX.jeton = ''; MX.pile = []; chargerFilsMx(); };
  dessinerDossiersMx(); dessinerActionsMx();
  if (!MX.dossiers || MX.dossiers === (semerCopieMx.dossiers || null)) chargerDossiersMx();
  if (!MX.programmes) chargerProgrammesMx();
  chargerFilsMx();
  if (MX.fil) afficherFilMx(MX.fil); else $('#mx-fil').innerHTML = '<p class="mx-vide">Choisissez une conversation.</p>';
  majMxFixe();
}
MX.public = !!lireLocal('mails_public');
function htmlDossiersMx(chips) {
  var c = (MX.dossiers && MX.dossiers.comptes) || {}, libs = (MX.dossiers && MX.dossiers.libelles) || [], traite = MX.dossiers ? MX.dossiers.traite : 'Festival/Traité';
  var actif = function (id) { return !MX.libelle && id === MX.dossier; };
  var h = DOSSIERS_MX.map(function (d) {
    var n = d[0] === 'reception' ? (c.reception || 0) : d[0] === 'brouillons' ? (c.brouillons || 0) : d[0] === 'programmes' ? programmesActifsMx().length : d[0] === 'suivis' ? (c.suivis || 0) : d[0] === 'spam' ? (c.spam || 0) : 0;
    if (d[0] === 'traites') { var lt = libs.filter(function (l) { return l.nom === traite; })[0]; n = lt ? lt.nonLus : 0; }
    return '<button type="button" class="dossier' + (actif(d[0]) ? ' actif' : '') + '" data-dossier="' + d[0] + '">' + (chips ? '' : '<i aria-hidden="true">' + d[2] + '</i>') + '<span>' + d[1] + '</span>' + (n ? '<b>' + n + '</b>' : '') + '</button>';
  }).join('');
  var autres = libs.filter(function (l) { return l.nom !== traite; });
  if (chips) {
    if (autres.length) h += '<select id="mx-chip-libelle" aria-label="Libellé"><option value="">Libellé…</option>' + autres.map(function (l) { return '<option' + (MX.libelle === l.nom ? ' selected' : '') + '>' + esc(l.nom) + '</option>'; }).join('') + '</select>';
    return h;
  }
  if (autres.length) {
    // Les 3 derniers libellés ouverts (+ celui affiché) ; « Tous les libellés » pour la liste entière.
    var vus = MX.libellesVus.slice(); if (MX.libelle && vus.indexOf(MX.libelle) < 0) vus.unshift(MX.libelle);
    var montres = MX.tousLibelles ? autres : autres.filter(function (l) { return vus.indexOf(l.nom) >= 0; }).slice(0, 4);
    if (!montres.length && !MX.tousLibelles) montres = autres.slice(0, 3);
    h += '<div class="titre-libelles">Libellés</div>' + montres.map(function (l) {
      return '<button type="button" class="dossier' + (MX.libelle === l.nom ? ' actif' : '') + '" data-libelle="' + esc(l.nom) + '"><i aria-hidden="true">🏷</i><span>' + esc(l.nom.replace(/^Festival\//, 'Festival · ')) + '</span>' + (l.nonLus ? '<b>' + l.nonLus + '</b>' : '') + '</button>';
    }).join('');
    if (autres.length > montres.length || MX.tousLibelles) h += '<button type="button" class="lien-libelles" id="mx-tous-libelles">' + (MX.tousLibelles ? 'Moins de libellés' : 'Tous les libellés (' + autres.length + ')') + '</button>';
  }
  h += '<button type="button" class="lien-libelles" id="mx-nouveau-libelle">+ Nouveau libellé</button>';
  return h;
}
function dessinerDossiersMx() {
  var z = $('#mx-dossiers'), ch = $('#mx-chips'); if (!z) return;
  z.innerHTML = '<button type="button" class="btn plein mx-ecrire-btn" id="mx-ecrire-btn">+ Écrire</button>' + htmlDossiersMx(false);
  ch.innerHTML = htmlDossiersMx(true);
  $('#mx-ecrire-btn').onclick = function () { composerMx('nouveau', {}); };
  document.querySelectorAll('#mx-dossiers [data-dossier], #mx-chips [data-dossier]').forEach(function (b) { b.onclick = function () { choisirDossierMx(b.dataset.dossier, ''); }; });
  document.querySelectorAll('#mx-dossiers [data-libelle]').forEach(function (b) { b.onclick = function () { choisirDossierMx('', b.dataset.libelle); }; });
  var sel = $('#mx-chip-libelle'); if (sel) sel.onchange = function () { if (sel.value) choisirDossierMx('', sel.value); };
  if ($('#mx-tous-libelles')) $('#mx-tous-libelles').onclick = function () { MX.tousLibelles = !MX.tousLibelles; dessinerDossiersMx(); };
  $('#mx-nouveau-libelle').onclick = function () {
    demander('Nom du nouveau libellé :', function (nom) {
      appelMx('adminMailsAction', [[], 'creerLibelle', nom], function () { toast('Libellé « ' + nom + ' » créé ✓'); chargerDossiersMx(); });
    }, { titre: 'Nouveau libellé', oui: 'Créer', placeholder: 'Ex. Presse' });
  };
}
function choisirDossierMx(dossier, libelle) {
  if (dossier === 'traites') { dossier = ''; libelle = (MX.dossiers && MX.dossiers.traite) || 'Festival/Traité'; MX.traitesVue = true; } else MX.traitesVue = false;
  MX.dossier = dossier || (libelle ? MX.dossier : 'reception'); MX.libelle = libelle || ''; MX.jeton = ''; MX.pile = []; MX.coches = {};
  if (libelle && !MX.traitesVue) { MX.libellesVus = [libelle].concat(MX.libellesVus.filter(function (x) { return x !== libelle; })).slice(0, 3); }
  if (dossier) { MX.recherche = ''; if ($('#mx-recherche')) $('#mx-recherche').value = ''; }
  if (MX.fil && surTelephone()) { MX.fil = null; $('#mx').classList.remove('detail'); }
  dessinerDossiersMx(); chargerFilsMx();
}
function chargerFilsMx(silencieux) {
  var cle = cleListeMx(), connu = MX.cache[cle] && !MX.cache[cle].attente ? MX.cache[cle] : null, z = $('#mx-liste');
  if (!z) return;
  MX.charge = true;
  if (connu) { MX.fils = connu.fils; MX.jetonSuite = connu.jetonSuite; dessinerFilsMx(); z.classList.add('rafraichit'); }
  else if (!silencieux) { MX.fils = null; z.innerHTML = '<p class="mx-vide">Lecture de Gmail…</p>'; $('#mx-pages').innerHTML = ''; }
  if (MX.dossier === 'programmes' && !MX.libelle) { MX.charge = false; z.classList.remove('rafraichit'); MX.fils = []; MX.jetonSuite = ''; dessinerFilsMx(); chargerProgrammesMx(); return; }
  var echec = function (e) { MX.charge = false; if ($('#mx-liste')) { $('#mx-liste').classList.remove('rafraichit'); if (!connu) $('#mx-liste').innerHTML = '<p class="mx-vide" style="color:var(--rouge)">' + esc(e && e.message ? e.message : e) + '</p>'; } return true; };
  var recu = function (r) {
    MX.cache[cle] = r; noterCopieMx(cle, r);
    if (connu && connu.fils.length && !r.fils.length) { MX.cache[cle] = connu; if (cle === cleListeMx()) MX.charge = false; if ($('#mx-liste')) $('#mx-liste').classList.remove('rafraichit'); return; } // vide d'un coup : liste connue gardée
    if (cle !== cleListeMx() || vue !== 'boite') return;
    MX.charge = false; $('#mx-liste').classList.remove('rafraichit');
    MX.fils = r.fils; MX.jetonSuite = r.jetonSuite; dessinerFilsMx();
    if (cle === cleBoiteDefautMx()) preparerRecentsMx();
  };
  if (MX.enRoute && MX.enRoute.cle === cle) { MX.enRoute.suites.push([recu, echec]); return; }
  appelMx('adminMailsListe', [requeteListeMx(MX.jeton)], recu, echec, true);
}
function signatureListeMx(l) { return (l || []).map(function (f) { return f.id + f.date + (f.nonLu ? 1 : 0) + (f.suivi ? 1 : 0) + (f.libelles || []).join('') + (f.brouillon ? 'b' : ''); }).join(','); }
function envoiEnCoursMx(f) { return MX.dossier === 'brouillons' && !MX.libelle && (MX.envoisEnCours || []).some(function (x) { return x.fil ? x.fil === f.id : (x.objet && x.objet === String(f.objet || '').trim().toLowerCase()); }); }
function dessinerFilsMx() {
  var z = $('#mx-liste'); if (!z) return;
  var l = MX.fils || [], h = '';
  if (MX.dossier === 'programmes' && !MX.libelle) h += htmlProgrammesMx();
  if (!l.length && !(MX.dossier === 'programmes' && !MX.libelle)) h += '<p class="mx-vide">' + (MX.recherche ? 'Aucun mail ne correspond à cette recherche.' : MX.public ? 'Aucun mail du public ici (décochez « Public seulement » pour tout voir).' : 'Aucun message ici.') + '</p>';
  h += l.map(function (f) {
    var part = envoiEnCoursMx(f), actif = MX.fil && MX.fil.id === f.id;
    return '<div class="conv' + (f.nonLu ? ' nonLu' : '') + (actif ? ' actif' : '') + (MX.coches[f.id] ? ' cochee' : '') + (part ? ' enEnvoi' : '') + '" data-conv="' + esc(f.id) + '" role="button" tabindex="0">' +
      '<span class="conv-gauche"><input type="checkbox" data-coche="' + esc(f.id) + '"' + (MX.coches[f.id] ? ' checked' : '') + ' aria-label="Sélectionner"><button type="button" class="etoile' + (f.suivi ? ' on' : '') + '" data-etoile="' + esc(f.id) + '" aria-label="' + (f.suivi ? 'Ne plus suivre' : 'Suivre') + '">★</button></span>' +
      '<span class="conv-corps"><span class="conv-tete"><span class="conv-de" title="' + esc(f.email) + '">' + esc(f.de) + '</span>' + (f.nb > 1 ? '<span class="conv-nb">' + f.nb + '</span>' : '') + '<span class="conv-date">' + esc(quandCourt(f.date)) + '</span></span>' +
      '<span class="conv-objet">' + (f.pieces ? '<small title="Pièce jointe">📎</small> ' : '') + esc(f.objet) + '</span><span class="conv-extrait">' + esc(f.extrait) + '</span>' +
      '<span class="conv-puces">' + (part ? '<span class="eti prog">Envoi en cours…</span>' : '') + (f.brouillon && MX.dossier !== 'brouillons' ? '<span class="eti brouillon">Brouillon</span>' : '') + (f.auto ? '<span class="eti">Réponse automatique</span>' : '') + (f.repondu ? '<span class="eti ok">Répondu</span>' : '') +
      (f.libelles || []).filter(function (e) { return e !== 'Traité' || MX.libelle !== ((MX.dossiers && MX.dossiers.traite) || 'Festival/Traité'); }).map(function (e) { return '<span class="eti' + (e === 'Traité' ? ' ok' : '') + '">' + esc(e) + '</span>'; }).join('') +
      (f.resas && f.resas[0] ? '<span class="eti resa">' + resumeResa(f.resas[0]) + (f.nbResas > 1 ? ' +' + (f.nbResas - 1) : '') + '</span>' : '') + '</span></span></div>';
  }).join('');
  z.innerHTML = h;
  z.querySelectorAll('[data-conv]').forEach(function (el) {
    el.onclick = function (ev) { if (ev.target.closest('[data-coche], [data-etoile]')) return; ouvrirConversationMx(el.dataset.conv); };
    el.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ouvrirConversationMx(el.dataset.conv); } };
  });
  z.querySelectorAll('[data-coche]').forEach(function (c) { c.onchange = function () { if (c.checked) MX.coches[c.dataset.coche] = true; else delete MX.coches[c.dataset.coche]; c.closest('.conv').classList.toggle('cochee', c.checked); dessinerActionsMx(); }; });
  z.querySelectorAll('[data-etoile]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); var f = l.filter(function (x) { return x.id === b.dataset.etoile; })[0]; if (f) actionMx(f.suivi ? 'nePlusSuivre' : 'suivre', '', [f.id]); }; });
  var p = $('#mx-pages');
  if (p) p.innerHTML = l.length ? '<button type="button" class="btn petit" id="mx-prec"' + (MX.pile.length ? '' : ' disabled') + '>‹</button><span>' + (MX.pile.length * 30 + 1) + '–' + (MX.pile.length * 30 + l.length) + (MX.jetonSuite ? ' · suite' : '') + '</span><button type="button" class="btn petit" id="mx-suiv"' + (MX.jetonSuite ? '' : ' disabled') + '>›</button>' : '';
  if ($('#mx-prec')) { $('#mx-prec').onclick = function () { MX.jeton = MX.pile.pop() || ''; MX.coches = {}; chargerFilsMx(); if ($('#mx-liste')) $('#mx-liste').scrollTop = 0; }; $('#mx-suiv').onclick = function () { MX.pile.push(MX.jeton); MX.jeton = MX.jetonSuite; MX.coches = {}; chargerFilsMx(); if ($('#mx-liste')) $('#mx-liste').scrollTop = 0; }; }
  dessinerActionsMx();
}
function idsCochesMx() { return Object.keys(MX.coches); }
function dessinerActionsMx() {
  var z = $('#mx-actions'); if (!z) return;
  var n = idsCochesMx().length, l = MX.fils || [], corb = MX.dossier === 'corbeille' && !MX.libelle, br = MX.dossier === 'brouillons' && !MX.libelle, spam = MX.dossier === 'spam' && !MX.libelle;
  var libs = ((MX.dossiers && MX.dossiers.libelles) || []).map(function (x) { return x.nom; });
  z.innerHTML = '<label class="coche-tout"><input type="checkbox" id="mx-tout"' + (n && l.every(function (f) { return MX.coches[f.id]; }) ? ' checked' : '') + (l.length ? '' : ' disabled') + ' aria-label="Tout sélectionner"></label>' +
    (n ? (corb ? '<button type="button" class="btn petit" data-act="restaurer">Restaurer</button>' : spam ? '<button type="button" class="btn petit" data-act="nonSpam">Pas du spam</button>' : '<button type="button" class="btn petit" data-act="archiver">Archiver</button>') +
      '<button type="button" class="btn petit danger" data-act="corbeille">' + (br ? 'Supprimer' : 'Corbeille') + '</button>' +
      (!br ? '<button type="button" class="btn petit" data-act="lu">Lu</button><button type="button" class="btn petit" data-act="nonLu">Non lu</button><button type="button" class="btn petit" data-act="traite">Traité ✓</button>' : '') +
      '<select id="mx-libeller" aria-label="Libeller"><option value="">Libeller…</option>' + libs.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '<option value="__nouveau__">+ Nouveau libellé…</option></select>' +
      '<span class="nb">' + n + ' sélectionné' + (n > 1 ? 's' : '') + '</span>' : '<span class="nb"></span>');
  $('#mx-tout').onchange = function () { MX.coches = {}; if (this.checked) l.forEach(function (f) { MX.coches[f.id] = true; }); dessinerFilsMx(); };
  z.querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () { if (b.dataset.act === 'corbeille' && br) confirmer('Supprimer ' + n + ' brouillon' + (n > 1 ? 's' : '') + ' ?', function () { actionMx('corbeille'); }, { oui: 'Supprimer', danger: true }); else actionMx(b.dataset.act); }; });
  var sel = $('#mx-libeller'); if (sel) sel.onchange = function () {
    var v = sel.value; sel.value = ''; if (!v) return;
    if (v === '__nouveau__') return demander('Nom du nouveau libellé :', function (nom) { actionMx('libeller', nom); }, { titre: 'Nouveau libellé', oui: 'Créer et appliquer' });
    actionMx('libeller', v);
  };
}
/* Affichage immédiat, puis Gmail en arrière-plan. */
function actionMx(action, param, ids) {
  ids = ids || idsCochesMx();
  if (!ids.length) return;
  var libelles = { archiver: 'Archivé', corbeille: 'Mis à la corbeille', lu: 'Marqué lu', nonLu: 'Marqué non lu', suivre: 'Suivi', nePlusSuivre: 'Plus suivi', libeller: 'Libellé « ' + param + ' »', deplacer: 'Déplacé vers « ' + param + ' »', boiteReception: 'Remis dans la boîte de réception', restaurer: 'Restauré', traite: 'Rangé dans « Traités »', nonTraite: 'Remis dans la boîte de réception', spam: 'Signalé comme spam', nonSpam: 'Remis dans la boîte de réception' };
  var dansReception = MX.dossier === 'reception' && !MX.libelle;
  var retire = ['corbeille', 'restaurer', 'spam', 'nonSpam'].indexOf(action) >= 0 || (['archiver', 'deplacer', 'traite'].indexOf(action) >= 0 && dansReception) || (['boiteReception', 'nonTraite'].indexOf(action) >= 0 && !dansReception && MX.dossier !== 'tous');
  MX.fils = (MX.fils || []).filter(function (f) {
    if (ids.indexOf(f.id) < 0) return true;
    if (action === 'lu') f.nonLu = false; if (action === 'nonLu') f.nonLu = true;
    if (action === 'suivre') f.suivi = true; if (action === 'nePlusSuivre') f.suivi = false;
    if (action === 'libeller' && f.libelles.indexOf(param) < 0) f.libelles.push(param);
    if (action === 'traite' && f.libelles.indexOf('Traité') < 0) f.libelles.push('Traité');
    if (action === 'nonTraite') f.libelles = f.libelles.filter(function (x) { return x !== 'Traité'; });
    return !retire;
  });
  ids.forEach(function (id) { delete MX.filsGardes[id]; }); oublierListesMx(); if (MX.cache[cleListeMx()]) MX.cache[cleListeMx()].fils = MX.fils;
  MX.coches = {}; dessinerFilsMx();
  if (MX.fil && ids.indexOf(MX.fil.id) >= 0) {
    if (action === 'suivre' || action === 'nePlusSuivre') MX.fil.suivi = action === 'suivre';
    if (action === 'traite' || action === 'nonTraite') MX.fil.traite = action === 'traite';
    if (retire && action !== 'nonSpam' && action !== 'restaurer') { MX.fil = null; $('#mx').classList.remove('detail'); $('#mx-fil').innerHTML = '<p class="mx-vide">' + esc(libelles[action] || 'Fait') + '.</p>'; }
    else if (MX.fil) afficherFilMx(MX.fil);
  }
  appelMx('adminMailsAction', [ids, action, param || ''], function (r) { toast((libelles[action] || 'Fait') + ' ✓'); chargerDossiersMx(); if (!retire) chargerFilsMx(true); }, function (e) { toast(e.message || String(e), true); MX.cache = {}; chargerFilsMx(); return true; }, true);
}

// ---------- Conversation ----------
function ouvrirConversationMx(id, force) {
  var gardee = MX.filsGardes[id];
  if (gardee && (force || (gardee.messages || []).some(function (m) { return m.brouillon || m.programme; }))) { delete MX.filsGardes[id]; gardee = null; }
  $('#mx').classList.add('detail');
  var x = (MX.fils || []).filter(function (y) { return y.id === id; })[0];
  if (gardee) {
    afficherFilMx(gardee);
    if (x && x.nonLu) { x.nonLu = false; dessinerFilsMx(); appelMx('adminMailsAction', [[id], 'lu', ''], function () { oublierListesMx(); chargerDossiersMx(); }, function () { return true; }, true); }
    setTimeout(function () { rafraichirFilOuvertMx(); }, 50);
    return;
  }
  $('#mx-fil').innerHTML = '<button type="button" class="btn petit retour" id="mx-retour">← Mails</button><p class="mx-vide">Ouverture…</p>';
  $('#mx-retour').onclick = retourListeMx;
  if (surTelephone()) scrollTo(0, 0);
  var jeton = MX.ouverture = (MX.ouverture || 0) + 1;
  appelMx('adminMailsOuvrir', [id, false], function (f) {
    if (jeton !== MX.ouverture || vue !== 'boite') return;
    if (!f || !(f.messages || []).length) { retourListeMx(); toast('Cette conversation n\'existe plus dans Gmail.', true); return; }
    f.nonLu = false; garderFilMx(f);
    if (x && x.nonLu) { x.nonLu = false; oublierListesMx(); chargerDossiersMx(); }
    afficherFilMx(f);
  }, function (e) {
    if (jeton !== MX.ouverture) return true;
    retourListeMx(); toast(/introuvable|not found|404|n'existe/i.test(String(e.message)) ? 'Cette conversation n\'existe plus dans Gmail.' : 'La conversation n\'a pas pu s\'ouvrir : ' + (e.message || e), true); return true;
  }, true);
}
function retourListeMx() { MX.fil = null; var g = $('#mx'); if (g) g.classList.remove('detail'); if ($('#mx-fil')) $('#mx-fil').innerHTML = '<p class="mx-vide">Choisissez une conversation.</p>'; dessinerFilsMx(); }
function signatureFilMx(f) { return ((f && f.messages) || []).map(function (m) { return m.id + (m.brouillon ? 'b' : '') + (m.programme ? 'p' : '') + ':' + String(m.html || '').length; }).join(',') + '|' + (f.libelles || []).join(',') + (f.suivi ? '*' : ''); }
function rafraichirFilOuvertMx() {
  if (!MX.fil || !MX.fil.id || vue !== 'boite') return;
  var id = MX.fil.id, jeton = MX.ouverture;
  appelMx('adminMailsOuvrir', [id, true], function (g) {
    if (!MX.fil || MX.fil.id !== id || jeton !== MX.ouverture) return;
    if (!g || !(g.messages || []).length) { delete MX.filsGardes[id]; retourListeMx(); toast('Cette conversation n\'existe plus dans Gmail.'); return; }
    g.nonLu = false; var avant = signatureFilMx(MX.fil); garderFilMx(g);
    if (signatureFilMx(g) === avant) { MX.fil = g; return; }
    var y = $('#mx-fil').scrollTop; afficherFilMx(g); $('#mx-fil').scrollTop = y;
  }, function () { return true; }, true);
}
function afficherFilMx(f) {
  MX.fil = f; dessinerFilsMx();
  var z = $('#mx-fil'); if (!z) return;
  var et = (MX.dossiers && MX.dossiers.etiquettes) || { annulation: 'Annulation', places: 'Changement de places', question: 'Question', autre: 'Autre' };
  var peutResa = droit('reservations'), derniers = f.messages.filter(function (m) { return !m.brouillon && !m.programme; }), dernier = derniers[derniers.length - 1];
  var h = '<button type="button" class="btn petit retour" id="mx-retour">← Mails</button>' +
    '<div class="fil-tete"><h2>' + esc(f.objet) + '</h2><button type="button" class="etoile' + (f.suivi ? ' on' : '') + '" id="mx-fil-etoile" aria-label="Suivre" title="Suivre">★</button></div>' +
    (f.libelles.length ? '<div class="fil-libelles">' + f.libelles.map(function (l) { return '<span class="eti' + (l === 'Traité' ? ' ok' : '') + '">' + esc(l) + '</span>'; }).join('') + '</div>' : '') +
    '<div class="fil-actions"><button type="button" class="btn plein" data-composer="repondre">Répondre</button>' +
    '<button type="button" class="btn' + (f.traite ? ' ok' : '') + '" id="mx-traite">' + (f.traite ? 'Traité ✓' : 'Marquer traité') + '</button>' +
    '<div class="menu-actions"><button type="button" class="btn" id="mx-menu-btn" aria-haspopup="menu">⋯ Actions</button><div class="menu-liste" id="mx-menu" role="menu">' +
    '<button type="button" data-act="repondreTous">Répondre à tous</button><button type="button" data-act="transferer">Transférer</button><hr>' +
    (f.dansReception ? '<button type="button" data-act="archiver">Archiver</button>' : '<button type="button" data-act="boiteReception">Remettre dans la boîte de réception</button>') +
    '<button type="button" data-act="nonLu">Marquer non lu</button><button type="button" data-act="libeller">Libeller…</button><button type="button" data-act="spam">Signaler comme spam</button>' +
    '<button type="button" class="danger" data-act="corbeille">Mettre à la corbeille</button><hr><button type="button" data-act="gmail">Ouvrir dans Gmail</button></div></div></div>';
  if (f.resas.length) h += '<div class="resas-fil">' + f.resas.map(function (r) {
    var att = r.statut === 'Liste d\'attente', ann = r.statut === 'Annulée';
    return '<div class="resa-fil"><div class="texte"><b>' + esc(r.nom) + '</b> · ' + resumeResa(r) + (r.options ? '<br><small class="doux">' + esc(r.options) + '</small>' : '') + '</div>' +
      (peutResa && !ann ? '<div class="actions">' + (att ? '<button type="button" class="btn petit plein" data-confirmer="' + esc(r.id) + '">Confirmer</button>' : '<button type="button" class="btn petit" data-places="' + esc(r.id) + '" data-n="' + r.places + '">Changer les places</button>') + '<button type="button" class="btn petit danger" data-annuler="' + esc(r.id) + '">Annuler</button></div>' : '') + '</div>';
  }).join('') + '</div>';
  else if (f.email && f.email !== moiMail()) h += '<p class="aide" style="margin:0 0 10px">Aucune réservation trouvée avec l\'adresse ' + esc(f.email) + '.</p>';
  h += '<div class="etiquettes-festival">' + Object.keys(et).map(function (k) { var on = f.libelles.indexOf(et[k]) >= 0; return '<button type="button" class="btn petit' + (on ? ' plein' : '') + '" data-etiquette="' + k + '" data-actif="' + (on ? '1' : '') + '">' + esc(et[k]) + '</button>'; }).join('') + '</div>';
  h += '<div class="messages-fil">' + f.messages.map(function (m, i) {
    var plie = !m.brouillon && !m.programme && derniers.length > 2 && m !== dernier && !m.nonLu && i < f.messages.length - 1;
    var extrait = texteDeHtml(m.html).slice(0, 140);
    return '<article class="fm' + (m.moi ? ' moi' : '') + (m.nonLu ? ' nonLu' : '') + (m.brouillon ? ' brouillon' : '') + (m.programme ? ' programme' : '') + (plie || m.brouillon ? ' plie' : '') + '" data-i="' + i + '">' +
      '<header><b>' + (m.brouillon ? '<span class="badge-b">Brouillon · pas envoyé</span>' : '') + (m.programme ? '<span class="badge-b">⏱ Programmé · part ' + esc(texteHeureGeneve(m.programme.prevu)) + '</span>' : '') + esc(m.nom) + '</b>' + (m.auto ? '<span class="eti">Réponse automatique</span>' : '') + (m.pieces.length ? '<span title="Pièces jointes">📎 ' + m.pieces.length + '</span>' : '') + '<span class="date">' + esc(dateHeureFr(m.date)) + '</span>' +
      '<span class="dest">' + esc(m.email) + ' → ' + esc(m.a) + (m.cc ? ' · Cc : ' + esc(m.cc) : '') + '</span>' +
      ((plie || m.brouillon) ? '<span class="dest extrait-plie">' + esc(extrait || '(vide)') + '</span>' : '') + '</header>' +
      '<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" data-msg="' + i + '" title="Contenu du message"></iframe>' +
      (m.pieces.length ? '<div class="pieces">' + m.pieces.map(function (p, k) { return '<div class="pj"><span class="nom" title="' + esc(p.nom) + '">' + esc(p.nom) + '</span><small>' + tailleLisible(p.taille) + '</small>' + (/^(application\/pdf|image\/)/i.test(p.type) ? '<button type="button" class="btn petit" data-pj="voir" data-i="' + i + '" data-k="' + k + '">Voir</button>' : '') + '<button type="button" class="btn petit" data-pj="dl" data-i="' + i + '" data-k="' + k + '">Télécharger</button></div>'; }).join('') + '</div>' : '') +
      '<div class="fm-actions">' + (m.brouillon ? '<button type="button" class="btn petit plein" data-fm="reprendre" data-i="' + i + '">Reprendre ce brouillon</button><button type="button" class="btn petit danger" data-fm="supprimerBrouillon" data-i="' + i + '">Supprimer le brouillon</button>'
        : m.programme ? '<button type="button" class="btn petit" data-prog-modifier="' + esc(m.programme.id) + '">Modifier</button><button type="button" class="btn petit" data-prog-envoyer="' + esc(m.programme.id) + '">Envoyer maintenant</button><button type="button" class="btn petit danger" data-prog-annuler="' + esc(m.programme.id) + '">Annuler l\'envoi</button>'
        : '<button type="button" class="btn petit" data-fm="repondre" data-i="' + i + '">Répondre</button><button type="button" class="btn petit" data-fm="repondreTous" data-i="' + i + '">Répondre à tous</button><button type="button" class="btn petit" data-fm="transferer" data-i="' + i + '">Transférer</button>') + '</div></article>';
  }).join('') + '</div><div id="mx-fil-programmes">' + htmlProgrammesFilMx(f.id) + '</div>' +
    '<div class="fil-bas"><button type="button" class="btn plein" data-composer="repondre">Répondre</button><button type="button" class="btn" data-composer="repondreTous">Répondre à tous</button><button type="button" class="btn" data-composer="transferer">Transférer</button></div>';
  z.innerHTML = h;
  z.querySelectorAll('iframe[data-msg]').forEach(function (fr) {
    var m = f.messages[Number(fr.dataset.msg)];
    fr.addEventListener('load', function () { try { var d = fr.contentDocument; d.querySelectorAll('a').forEach(function (a) { a.target = '_blank'; a.rel = 'noopener'; }); fr.style.height = Math.min(4000, d.documentElement.scrollHeight + 8) + 'px'; d.querySelectorAll('img').forEach(function (im) { im.addEventListener('load', function () { fr.style.height = Math.min(4000, d.documentElement.scrollHeight + 8) + 'px'; }); }); } catch (e) { fr.style.height = '400px'; } });
    fr.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;font:14px/1.5 Arial,Helvetica,sans-serif;color:#222;background:#fff;padding:6px 4px;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}blockquote{margin:6px 0;padding-left:10px;border-left:2px solid #ccc;color:#555}</style></head><body>' + m.html + '</body></html>';
  });
  $('#mx-retour').onclick = retourListeMx;
  $('#mx-fil-etoile').onclick = function () { actionMx(f.suivi ? 'nePlusSuivre' : 'suivre', '', [f.id]); };
  $('#mx-traite').onclick = function () { actionMx(f.traite ? 'nonTraite' : 'traite', '', [f.id]); };
  var menu = $('#mx-menu');
  $('#mx-menu-btn').onclick = function (ev) { ev.stopPropagation(); menu.classList.toggle('ouvert'); };
  document.addEventListener('click', function fermer() { menu.classList.remove('ouvert'); document.removeEventListener('click', fermer); });
  menu.querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () {
    menu.classList.remove('ouvert');
    var a = b.dataset.act;
    if (a === 'repondreTous' || a === 'transferer') return composerMx(a, { fil: f });
    if (a === 'gmail') return window.open('https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(f.id), '_blank');
    if (a === 'libeller') {
      var libs = ((MX.dossiers && MX.dossiers.libelles) || []).map(function (x) { return x.nom; });
      return dialogue({ titre: 'Libeller la conversation', html: '<select id="dlgLib">' + libs.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '<option value="__nouveau__">+ Nouveau libellé…</option></select>', oui: 'Appliquer', ok: function () {
        var v = $('#dlgLib').value; if (v === '__nouveau__') return demander('Nom du nouveau libellé :', function (nom) { actionMx('libeller', nom, [f.id]); }, { titre: 'Nouveau libellé', oui: 'Créer et appliquer' });
        actionMx('libeller', v, [f.id]);
      } });
    }
    if (a === 'corbeille') return confirmer('Mettre cette conversation à la corbeille ?', function () { actionMx('corbeille', '', [f.id]); }, { oui: 'Corbeille', danger: true });
    actionMx(a, '', [f.id]);
  }; });
  z.querySelectorAll('[data-composer]').forEach(function (b) { b.onclick = function () { composerMx(b.dataset.composer, { fil: f }); }; });
  z.querySelectorAll('[data-fm]').forEach(function (b) { b.onclick = function (ev) {
    ev.stopPropagation();
    var m = f.messages[Number(b.dataset.i)], a = b.dataset.fm;
    if (a === 'reprendre') return reprendreBrouillonMx(f, m);
    if (a === 'supprimerBrouillon') return confirmer('Supprimer ce brouillon ? La conversation et les vrais messages restent.', function () { supprimerBrouillonMx(m.brouillonId, f); }, { oui: 'Supprimer', danger: true });
    composerMx(a, { fil: f, message: m });
  }; });
  z.querySelectorAll('.fm header').forEach(function (hd) { hd.onclick = function (ev) { if (ev.target.closest('button')) return; hd.parentNode.classList.toggle('plie'); }; });
  z.querySelectorAll('[data-pj]').forEach(function (b) { b.onclick = function () {
    var m = f.messages[Number(b.dataset.i)], p = m.pieces[Number(b.dataset.k)];
    b.disabled = true; b.textContent = '…';
    appelMx('adminMailsPiece', [p.message, p.id], function (r) {
      b.disabled = false; b.textContent = b.dataset.pj === 'dl' ? 'Télécharger' : 'Voir';
      var bin = atob(r.data), octets = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([octets], { type: p.type || 'application/octet-stream' }));
      if (b.dataset.pj === 'voir') { var w = window.open(url, '_blank'); if (!w) toast('Autorisez les fenêtres surgissantes pour voir la pièce jointe.', true); }
      else { var a = document.createElement('a'); a.href = url; a.download = p.nom; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }, function (e) { b.disabled = false; b.textContent = b.dataset.pj === 'dl' ? 'Télécharger' : 'Voir'; toast(e.message || String(e), true); return true; });
  }; });
  z.querySelectorAll('[data-etiquette]').forEach(function (b) { b.onclick = function () {
    var actif = !b.dataset.actif, nom = et[b.dataset.etiquette];
    b.classList.toggle('plein', actif); b.dataset.actif = actif ? '1' : '';
    if (actif) f.libelles.push(nom); else f.libelles = f.libelles.filter(function (x) { return x !== nom; });
    appelMx('adminMailsAction', [[f.id], 'etiquette', b.dataset.etiquette, actif], function () { oublierListesMx(); chargerFilsMx(true); }, function (e) { toast(e.message || e, true); return true; }, true);
  }; });
  z.querySelectorAll('[data-annuler]').forEach(function (b) { b.onclick = function () {
    dialogue({ titre: 'Annuler la réservation', html: '<p>La réservation passe en « Annulée » et les places sont libérées.</p><label class="coche"><input type="checkbox" id="prevenirAnn"> Envoyer aussi l\'e-mail automatique « Réservation annulée »</label>', oui: 'Annuler la réservation', non: 'Garder', danger: true,
      ok: function () { var prev = !!($('#prevenirAnn') && $('#prevenirAnn').checked); appel('adminAnnulerReservation', [b.dataset.annuler, prev], function (res) { recharger(res); toast('Réservation annulée ✓'); ouvrirConversationMx(f.id, true); }); } });
  }; });
  z.querySelectorAll('[data-places]').forEach(function (b) { b.onclick = function () {
    demander('Nouveau nombre de places :', function (v) {
      if (!(Number(v) >= 1)) return toast('Indiquez un nombre de places (1 ou plus).', true);
      appel('adminModifierPlaces', [b.dataset.places, Number(v)], function (res) { recharger(res); toast('Places changées : ' + v + ' ✓ (aucun e-mail envoyé : répondez ci-dessous)'); ouvrirConversationMx(f.id, true); });
    }, { defaut: String(b.dataset.n), oui: 'Changer', titre: 'Changer les places' });
  }; });
  z.querySelectorAll('[data-confirmer]').forEach(function (b) { b.onclick = function () {
    confirmer('Passer cette inscription de la liste d\'attente à « Confirmée » et envoyer l\'e-mail de confirmation ?', function () {
      appel('adminConfirmerReservation', [b.dataset.confirmer, true], function (res) { recharger(res); toast('Réservation confirmée ✓'); ouvrirConversationMx(f.id, true); });
    }, { titre: 'Confirmer la réservation', oui: 'Confirmer et envoyer' });
  }; });
  activerProgrammesMx(z);
  if (mxFixe()) z.scrollTop = 0;
}
function reprendreBrouillonMx(f, m) {
  var b = m || f.messages.filter(function (x) { return x.brouillon; }).pop(); if (!b) return;
  if ((MX.envoisEnCours || []).some(function (x) { return x.fil === f.id; })) return toast('Ce mail est en cours d\'envoi : il quitte les brouillons dans un instant.');
  var h = String(b.html || ''), corps = h, citation = '';
  var sep = h.match(/^([\s\S]*?)<br><div class="gmail_quote"[^>]*>([\s\S]*)<\/div>\s*$/i);
  if (sep) { corps = sep[1]; citation = sep[2]; }
  corps = corps.replace(/<div style="margin-top:28px[^"]*">[\s\S]*$/i, '').replace(/^<div style="font-family:Georgia[^"]*">([\s\S]*)<\/div>\s*$/i, '$1');
  composerMx(f.messages.length > 1 ? 'repondre' : 'nouveau', { fil: f.messages.length > 1 ? f : null, a: b.a, cc: b.cc, objet: b.objet, corps: corps, citation: citation, brouillonId: b.brouillonId, garderChamps: true });
}
function supprimerBrouillonMx(id, f) {
  appelMx('adminMailsSupprimerBrouillon', [id], function () {
    toast('Brouillon supprimé ✓');
    if (f) { f.messages = f.messages.filter(function (x) { return x.brouillonId !== id; }); delete MX.filsGardes[f.id]; }
    MX.cache = {};
    if (f && f.messages.some(function (x) { return !x.brouillon; })) { garderFilMx(f); afficherFilMx(f); } else retourListeMx();
    chargerFilsMx(true); chargerDossiersMx();
  });
}

// ---------- Mails programmés ----------
function programmesActifsMx() { return (MX.programmes || []).filter(function (x) { return x.statut === 'Programmé' || x.statut === 'Échec' || x.statut === 'Envoi en cours'; }); }
function partiesGeneve(ms) {
  var p = {}; new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}
function heureGeneve(y, mo, d, h, mi) { var voulu = Date.UTC(y, mo - 1, d, h, mi), t = voulu; for (var i = 0; i < 3; i++) { var p = partiesGeneve(t); t += voulu - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); } return t; }
function d2(n) { return ('0' + n).slice(-2); }
function texteHeureGeneve(ms) { if (!ms) return ''; var p = partiesGeneve(ms); return ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()] + ' ' + d2(p.d) + '.' + d2(p.mo) + ' à ' + p.h + 'h' + d2(p.mi); }
function choisirHeureEnvoi(initial, intro, siOk) {
  var p = partiesGeneve(Date.now());
  var jour = function (n) { var x = new Date(Date.UTC(p.y, p.mo - 1, p.d + n)); return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate(), wd: x.getUTCDay() }; };
  var iso = function (j) { return j.y + '-' + d2(j.mo) + '-' + d2(j.d); };
  var auj = jour(0), demain = jour(1), lundi = jour(((8 - auj.wd) % 7) || 7), nomsJours = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'], quel = function (j) { return ' (' + nomsJours[j.wd] + ' ' + d2(j.d) + '.' + d2(j.mo) + ')'; };
  var choix = (p.h < 8 ? [['Ce matin 8h' + quel(auj), iso(auj), '08:00'], ['Ce matin 9h' + quel(auj), iso(auj), '09:00'], ['Demain 8h' + quel(demain), iso(demain), '08:00']] : [['Demain 8h' + quel(demain), iso(demain), '08:00'], ['Demain 9h' + quel(demain), iso(demain), '09:00']]).concat([['Lundi 8h' + quel(lundi), iso(lundi), '08:00']]);
  choix = choix.filter(function (c, i) { return choix.findIndex(function (y) { return y[1] === c[1] && y[2] === c[2]; }) === i; });
  var depart = initial ? partiesGeneve(initial) : null, d0 = depart ? iso(depart) : choix[0][1], h0 = depart ? d2(depart.h) + ':' + d2(depart.mi) : choix[0][2];
  function lire() {
    var dv = String($('#prog-date').value || '').split('-').map(Number), hv = String($('#prog-heure').value || '').split(':').map(Number);
    if (dv.length < 3 || !dv[0] || !dv[1] || !dv[2] || hv.length < 2 || isNaN(hv[0]) || isNaN(hv[1])) return { ok: false, texte: 'Choisissez un jour et une heure.' };
    var ms = heureGeneve(dv[0], dv[1], dv[2], hv[0], hv[1]);
    if (ms < Date.now() + 60000) return { ok: false, texte: 'Cette heure est déjà passée : choisissez plus tard.' };
    if (ms > Date.now() + 365 * 86400000) return { ok: false, texte: 'Choisissez une date dans l\'année qui vient.' };
    return { ok: true, ms: ms, texte: 'Sera envoyé ' + texteHeureGeneve(ms) + ' (heure de Genève). L\'appli n\'a pas besoin d\'être ouverte.' };
  }
  dialogue({ titre: 'Programmer l\'envoi', html: '<p style="margin-top:0">' + esc(intro) + '</p><div class="prog-choix">' + choix.map(function (c, i) { return '<button type="button" class="btn petit" data-prog-choix="' + i + '">' + c[0] + '</button>'; }).join('') + '</div>' +
    '<div class="prog-champs"><label>Jour<input type="date" id="prog-date" value="' + d0 + '" min="' + iso(auj) + '"></label><label>Heure (Genève)<input type="time" id="prog-heure" value="' + h0 + '" step="300"></label></div><p class="prog-phrase" id="prog-phrase"></p>',
    oui: 'Programmer', ok: function () { var t = lire(); if (!t.ok) { toast(t.texte, true); return; } siOk(t.ms); } });
  function maj() { var t = lire(); $('#prog-phrase').textContent = t.texte; $('#prog-phrase').classList.toggle('avert', !t.ok); document.querySelectorAll('[data-prog-choix]').forEach(function (b) { var c = choix[b.dataset.progChoix]; b.classList.toggle('on', c[1] === $('#prog-date').value && c[2] === $('#prog-heure').value); }); }
  document.querySelectorAll('[data-prog-choix]').forEach(function (b) { b.onclick = function () { var c = choix[b.dataset.progChoix]; $('#prog-date').value = c[1]; $('#prog-heure').value = c[2]; maj(); }; });
  $('#prog-date').oninput = maj; $('#prog-heure').oninput = maj; maj();
}
function htmlProgrammesMx() {
  var l = MX.programmes;
  if (!l) return '<p class="mx-vide">Lecture…</p>';
  if (!l.length) return '<p class="mx-vide">Aucun mail programmé. Dans la fenêtre d\'écriture, « Programmer » choisit le jour et l\'heure d\'envoi.</p>';
  return l.map(function (x) {
    var actif = x.statut === 'Programmé' || x.statut === 'Échec';
    var txt = x.statut === 'Programmé' ? 'Part ' + texteHeureGeneve(x.prevu) : x.statut === 'Échec' ? 'Échec : ' + x.raison + (x.essais < 2 ? ' · nouvel essai automatique' : ' · plus d\'essai automatique') : x.statut === 'Envoyé' ? 'Parti le ' + String(x.envoyeLe).split(' ')[0].split('-').reverse().join('.') + ' à ' + (String(x.envoyeLe).split(' ')[1] || '') : x.statut;
    return '<div class="prog-ligne' + (x.statut === 'Échec' ? ' echec' : '') + '"><div class="texte"><b>' + esc(x.a) + '</b> · ' + esc(x.objet) + '<small>' + esc(txt) + '</small></div><div class="btns">' +
      (actif ? '<button type="button" class="btn petit" data-prog-modifier="' + esc(x.id) + '">Modifier</button><button type="button" class="btn petit" data-prog-envoyer="' + esc(x.id) + '">Envoyer maintenant</button><button type="button" class="btn petit danger" data-prog-annuler="' + esc(x.id) + '">Annuler</button>' : '') +
      (x.statut === 'Envoyé' && x.fil ? '<button type="button" class="btn petit" data-prog-voir="' + esc(x.fil) + '">Voir</button>' : '') + '</div></div>';
  }).join('');
}
function htmlProgrammesFilMx(filId) {
  var l = programmesActifsMx().filter(function (x) { return filId && x.fil === filId && !(MX.fil && MX.fil.id === filId && MX.fil.messages.some(function (m) { return m.programme && m.programme.id === x.id; })); });
  return l.map(function (x) {
    var txt = x.statut === 'Programmé' ? 'Programmé · part ' + texteHeureGeneve(x.prevu) : x.statut === 'Échec' ? 'Programmé · échec : ' + x.raison : x.statut;
    return '<div class="prog-ligne' + (x.statut === 'Échec' ? ' echec' : '') + '"><div class="texte"><b>⏱ ' + esc(txt) + '</b><small>À : ' + esc(x.a) + ' · ' + esc(x.objet) + '</small></div><div class="btns">' + (x.statut !== 'Envoi en cours' ? '<button type="button" class="btn petit" data-prog-modifier="' + esc(x.id) + '">Modifier</button><button type="button" class="btn petit" data-prog-envoyer="' + esc(x.id) + '">Envoyer maintenant</button><button type="button" class="btn petit danger" data-prog-annuler="' + esc(x.id) + '">Annuler</button>' : '') + '</div></div>';
  }).join('');
}
function majProgrammesFilMx() { var z = $('#mx-fil-programmes'); if (z && MX.fil) { z.innerHTML = htmlProgrammesFilMx(MX.fil.id); activerProgrammesMx(z); } }
function activerProgrammesMx(racine) {
  (racine || document).querySelectorAll('[data-prog-modifier]').forEach(function (b) { b.onclick = function () {
    appelMx('adminMailsProgrammeLire', [b.dataset.progModifier], function (r) {
      var sep = String(r.html || '').match(/^([\s\S]*?)<br><div class="gmail_quote"[^>]*>([\s\S]*)<\/div>\s*$/i), corps = sep ? sep[1] : r.html, citation = sep ? sep[2] : '';
      corps = corps.replace(/<div style="margin-top:28px[^"]*">[\s\S]*$/i, '').replace(/^<div style="font-family:Georgia[^"]*">([\s\S]*)<\/div>\s*$/i, '$1');
      composerMx(r.filId ? 'repondre' : 'nouveau', { fil: r.filId ? { id: r.filId, objet: r.objet, messages: [] } : null, a: r.a, cc: r.cc, cci: r.cci, objet: r.objet, corps: corps, citation: citation, brouillonId: r.brouillonId, garderChamps: true, programme: r.resume, piecesGardees: r.pieces });
    });
  }; });
  (racine || document).querySelectorAll('[data-prog-envoyer]').forEach(function (b) { b.onclick = function () {
    confirmer('Envoyer ce mail maintenant ?', function () { appelMx('adminMailsProgrammeEnvoyer', [b.dataset.progEnvoyer], function (r) { toast('Envoyé ✓'); majProgrammesMx(r.liste); MX.cache = {}; if (MX.fil) ouvrirConversationMx(MX.fil.id, true); else chargerFilsMx(true); }); }, { oui: 'Envoyer' });
  }; });
  (racine || document).querySelectorAll('[data-prog-annuler]').forEach(function (b) { b.onclick = function () {
    dialogue({ titre: 'Annuler l\'envoi programmé', texte: 'Le mail ne partira pas. Garder son texte en brouillon ?', oui: 'Annuler et garder en brouillon', non: 'Annuler et supprimer', ok: function () { annuler(true); }, annuler: function () { annuler(false); } });
    function annuler(garder) { appelMx('adminMailsProgrammeAnnuler', [b.dataset.progAnnuler, garder], function (r) { toast('Envoi annulé' + (garder ? ' · brouillon gardé' : '') + ' ✓'); majProgrammesMx(r.liste); MX.cache = {}; if (MX.fil) ouvrirConversationMx(MX.fil.id, true); else chargerFilsMx(true); }); }
  }; });
  (racine || document).querySelectorAll('[data-prog-voir]').forEach(function (b) { b.onclick = function () { ouvrirConversationMx(b.dataset.progVoir); }; });
}
function majProgrammesMx(liste) {
  if (!liste) return chargerProgrammesMx();
  MX.programmes = liste; dessinerDossiersMx();
  if (MX.dossier === 'programmes' && !MX.libelle) dessinerFilsMx();
  majProgrammesFilMx(); chargerDossiersMx();
}

// ---------- Fenêtre d'écriture ----------
var ECRITURE = null; // éditeur ouvert
var SECOURS_MX = 'mails_en_cours';
function secoursLireMx() { var l = []; try { l = JSON.parse(lireLocal(SECOURS_MX) || '[]'); } catch (e) { l = []; } var lim = Date.now() - 30 * 864e5; return (Array.isArray(l) ? l : []).filter(function (x) { return x && x.cle && x.m && Number(x.t) > lim; }); }
function secoursEcrireMx(l) { try { if (!l.length) garderLocal(SECOURS_MX, ''); else garderLocal(SECOURS_MX, JSON.stringify(l.slice(0, 6))); } catch (e) { try { garderLocal(SECOURS_MX, JSON.stringify(l.slice(0, 1))); } catch (x) { /* mémoire indisponible */ } } }
function secoursGarderMx(e) { var l = secoursLireMx().filter(function (x) { return x.cle !== e.cle; }); l.unshift(e); secoursEcrireMx(l); }
function secoursEffacerMx(cle) { var l = secoursLireMx(), r = l.filter(function (x) { return x.cle !== cle; }); if (r.length !== l.length) secoursEcrireMx(r); }
var secoursVusMx = {};
function proposerSecoursMx() {
  if (!D || !droit('boite') || ECRITURE || $('#dialogue').classList.contains('ouvert')) return;
  var l = secoursLireMx().filter(function (x) { return !secoursVusMx[x.cle] && Date.now() - x.t > 8000; });
  if (!l.length) return;
  var e = l[0], m = e.m || {}; secoursVusMx[e.cle] = true;
  var quand = new Date(e.t); var txt = d2(quand.getDate()) + '.' + d2(quand.getMonth() + 1) + ' à ' + d2(quand.getHours()) + 'h' + d2(quand.getMinutes());
  dialogue({ titre: 'Mail en cours retrouvé', texte: 'Ce mail était en cours d\'écriture sur cet appareil et sa dernière version n\'a peut-être pas atteint Gmail :\n« ' + (m.objet || 'sans objet') + ' »' + (m.a ? ' à ' + m.a : '') + '\nDernière modification : ' + txt + '.\nLe rouvrir ? Rien n\'est envoyé.', oui: 'Rouvrir', non: 'Plus tard',
    ok: function () { if (vue !== 'boite') { $('nav [data-vue=boite]').click(); } setTimeout(function () { composerMx(e.mode || 'nouveau', { fil: m.filId ? (MX.fil && MX.fil.id === m.filId ? MX.fil : { id: m.filId, objet: m.objetFil || m.objet, messages: [] }) : null, a: m.a, cc: m.cc, cci: m.cci, objet: m.objet, corps: m.html, citation: m.citation || '', brouillonId: e.brouillonId || '', garderChamps: true, modifie: true, cleSecours: e.cle, messageId: m.messageId, pied: m.pied, traite: m.traite }); }, 50); },
    annuler: function () { toast('La copie reste sur cet appareil : elle sera proposée à la prochaine ouverture.'); } });
}
setInterval(proposerSecoursMx, 5000);
function htmlCollePropre(html) {
  var t = document.createElement('template'); t.innerHTML = String(html || '');
  var NOMS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', A: 'a', UL: 'ul', OL: 'ol', LI: 'li', P: 'p', BR: 'br', DIV: 'p', H1: 'p', H2: 'p', H3: 'p', H4: 'p', H5: 'p', H6: 'p', BLOCKQUOTE: 'p', PRE: 'p', TR: 'p', TABLE: 'div', TBODY: 'div', THEAD: 'div' };
  var IGNORER = /^(SCRIPT|STYLE|META|LINK|TITLE|HEAD|IMG|PICTURE|SVG|IFRAME|OBJECT|EMBED|VIDEO|AUDIO|CANVAS|BUTTON|INPUT|SELECT|TEXTAREA|NOSCRIPT|TEMPLATE)$/;
  var sortie = document.createElement('div');
  (function copier(n, dans) {
    Array.prototype.forEach.call(n.childNodes, function (c) {
      if (c.nodeType === 3) { dans.appendChild(document.createTextNode(c.nodeValue)); return; }
      if (c.nodeType !== 1 || IGNORER.test(c.tagName)) return;
      var st = String(c.getAttribute('style') || ''), nom = NOMS[c.tagName] || '', cible = dans;
      if (nom === 'b' && /font-weight\s*:\s*(normal|[1-4]00)/i.test(st)) nom = '';
      if (nom === 'a') { var h = String(c.getAttribute('href') || '').trim(); if (!/^(https?:|mailto:|tel:)/i.test(h)) nom = ''; }
      if (nom) { var e = document.createElement(nom); if (nom === 'a') e.setAttribute('href', c.getAttribute('href').trim()); dans.appendChild(e); cible = e; if (nom === 'br') return; }
      if (nom !== 'b' && /font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) { var g = document.createElement('b'); cible.appendChild(g); cible = g; }
      if (nom !== 'i' && /font-style\s*:\s*italic/i.test(st)) { var it = document.createElement('i'); cible.appendChild(it); cible = it; }
      copier(c, cible);
      if (c.tagName === 'TD' || c.tagName === 'TH') dans.appendChild(document.createTextNode(' '));
    });
  })(t.content, sortie);
  sortie.querySelectorAll('div').forEach(function (d) { while (d.firstChild) d.parentNode.insertBefore(d.firstChild, d); d.remove(); });
  return sortie.innerHTML;
}
function texteVersParagraphes(t) { return String(t || '').split(/\n{2,}/).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join(''); }
/** mode : nouveau, repondre, repondreTous, transferer. options : fil, message, a, cc, cci, objet, corps, citation, brouillonId, garderChamps, cleSecours, programme, pied, traite */
function composerMx(mode, options) {
  options = options || {};
  if (ECRITURE) { if (ECRITURE.cle === options.cleSecours) return; toast('Terminez d\'abord le mail en cours (ou fermez-le avec ×).', true); $('#mx-ecrire').classList.remove('reduit'); return; }
  var f = options.fil || null, recus = f && f.messages ? f.messages.filter(function (x) { return !x.brouillon && !x.programme; }) : [];
  var dernier = options.message && !options.message.brouillon ? options.message : (recus.length ? recus[recus.length - 1] : null);
  var moi = moiMail(), a = options.a || '', cc = options.cc || '', cci = options.cci || '', objet = options.objet || '', citation = options.citation || '';
  if (dernier && mode !== 'nouveau' && !options.garderChamps) {
    var autre = dernier.moi ? dernier.a : dernier.de;
    if (mode === 'repondre') a = adresseDe(autre);
    if (mode === 'repondreTous') { a = adresseDe(autre); cc = adressesDe(dernier.a + ',' + (dernier.cc || '')).filter(function (x) { return x !== a && x !== moi; }).join(', '); }
    objet = (mode === 'transferer' ? 'Tr : ' : 'Re : ') + String(f.objet || '').replace(/^(re|tr|fwd?)\s*:\s*/i, '');
    if (mode !== 'transferer') citation = '<p style="margin:0 0 8px;color:#777;font-size:13px">Le ' + esc(dateHeureFr(dernier.date)) + ', ' + esc(dernier.de) + ' a écrit :</p>' + dernier.html;
    else citation = '<p style="margin:0 0 8px;color:#777;font-size:13px">---------- Message transféré ----------<br>De : ' + esc(dernier.de) + '<br>Date : ' + esc(dateHeureFr(dernier.date)) + '<br>Objet : ' + esc(dernier.objet || f.objet) + '<br>À : ' + esc(dernier.a) + '</p>' + dernier.html;
  }
  var titre = { nouveau: 'Nouveau mail', repondre: 'Répondre', repondreTous: 'Répondre à tous', transferer: 'Transférer' }[mode] || 'Écrire';
  var cle = options.cleSecours || ('m' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  var resas = f && f.resas ? f.resas : [];
  var E = ECRITURE = { cle: cle, mode: mode, fil: f, messageId: options.message ? options.message.id : (options.messageId || (dernier ? dernier.id : '')), brouillonId: options.brouillonId || '', programme: options.programme || null,
    pieces: [], piecesGardees: options.piecesGardees || [], modifie: !!options.modifie, minuterie: null, premier: 0, enCours: false, attente: [], ferme: false, parti: false, dernierSauve: '' };
  var z = $('#mx-ecrire'); z.hidden = false; z.classList.remove('reduit'); z.classList.toggle('grand', !!lireLocal('mails_ecrire_grand'));
  var pied = options.pied !== undefined ? !!options.pied : lireLocal('mails_sans_pied') !== '1';
  z.innerHTML = '<div class="ec-tete"><b id="ec-titre">' + esc(titre) + '</b><span class="etat" id="ec-etat"></span><button type="button" id="ec-reduire" title="Réduire" aria-label="Réduire">—</button><button type="button" id="ec-grand" title="Agrandir" aria-label="Agrandir">⤢</button><button type="button" id="ec-fermer" title="Fermer (le brouillon est gardé dans Gmail)" aria-label="Fermer">×</button></div>' +
    '<div class="ec-corps">' +
    '<div class="ec-ligne"><label>De</label><span class="doux" style="font-size:14px;overflow:hidden;text-overflow:ellipsis">' + esc(D.reglages.nomFestival || 'Festival') + (moi ? ' <' + esc(moi) + '>' : '') + '</span></div>' +
    '<div class="ec-ligne"><label for="ec-a-in">À</label><div class="chips" id="ec-a" data-champ="a"><input id="ec-a-in" type="email" multiple autocomplete="off" placeholder="adresse@exemple.ch" aria-label="Destinataires"></div><div class="liens"><button type="button" id="ec-voir-cc">Cc</button><button type="button" id="ec-voir-cci">Cci</button></div></div>' +
    '<div class="ec-ligne" id="ec-ligne-cc" hidden><label for="ec-cc-in">Cc</label><div class="chips" id="ec-cc" data-champ="cc"><input id="ec-cc-in" type="email" multiple autocomplete="off" aria-label="Copie"></div></div>' +
    '<div class="ec-ligne" id="ec-ligne-cci" hidden><label for="ec-cci-in">Cci</label><div class="chips" id="ec-cci" data-champ="cci"><input id="ec-cci-in" type="email" multiple autocomplete="off" aria-label="Copie cachée"></div></div>' +
    '<div class="ec-ligne"><label for="ec-objet">Objet</label><input id="ec-objet" type="text" value="' + esc(objet) + '" placeholder="Objet du mail"></div>' +
    '<div class="ec-outils"><button type="button" data-cmd="bold" title="Gras (Ctrl+B)"><b>G</b></button><button type="button" data-cmd="italic" title="Italique (Ctrl+I)"><i>I</i></button><button type="button" data-cmd="underline" title="Souligné"><u>S</u></button><button type="button" data-cmd="insertUnorderedList" title="Liste">• Liste</button><button type="button" data-cmd="lien" title="Lien">🔗 Lien</button><button type="button" data-cmd="nettoyer" title="Retirer les couleurs et polices collées">⌫ Format</button>' +
    (resas.length || mode !== 'nouveau' ? '<select id="ec-rapide" aria-label="Réponses toutes prêtes"><option value="">Réponses toutes prêtes…</option>' + REPONSES_RAPIDES.map(function (x, i) { return '<option value="' + i + '">' + esc(x[0]) + '</option>'; }).join('') + '</select>' : '') +
    '<span class="espace"></span><button type="button" id="ec-joindre" title="Joindre un fichier">📎 Joindre</button><input type="file" id="ec-fichier" multiple hidden></div>' +
    '<div id="ec-texte" contenteditable="true" spellcheck="true"></div>' +
    '<div class="ec-pieces" id="ec-pieces"></div>' +
    (citation ? '<details class="ec-citation" id="ec-citation"><summary>' + (mode === 'transferer' ? 'Message transféré (envoyé avec le mail)' : 'Conversation citée (envoyée avec le mail)') + '</summary><div class="cadre" id="ec-citation-html"></div></details>' : '') +
    '</div>' +
    '<div class="ec-bas"><button type="button" class="btn plein" id="ec-envoyer">' + (E.programme ? 'Reprogrammer' : 'Envoyer') + '</button><button type="button" class="btn" id="ec-programmer">' + (E.programme ? 'Envoyer maintenant' : 'Programmer…') + '</button>' +
    (E.programme ? '' : '<button type="button" class="lien" id="ec-sauver">Enregistrer</button><button type="button" class="lien danger" id="ec-supprimer">Supprimer le brouillon</button>') +
    '<label class="coche"><input type="checkbox" id="ec-pied"' + (pied ? ' checked' : '') + '> Pied de page du festival</label></div>';
  var texte = $('#ec-texte');
  texte.innerHTML = options.corps || '<p><br></p>';
  if (citation) $('#ec-citation-html').innerHTML = citation;
  E.citation = citation;
  // Destinataires sous forme de pastilles
  function chips(id) { return Array.prototype.map.call($('#' + id).querySelectorAll('.chip'), function (c) { return c.dataset.a; }); }
  function ajouterChip(id, adr) {
    adr = String(adr || '').trim().replace(/[,;]$/, ''); if (!adr) return;
    var zone = $('#' + id), inp = zone.querySelector('input'), a = adresseDe(adr) || adr.toLowerCase();
    if (chips(id).indexOf(a) >= 0) return;
    var ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a), c = document.createElement('span'); c.className = 'chip' + (ok ? '' : ' mauvais') + (ok && (D.reservations || []).some(function (r) { return String(r.email || '').toLowerCase() === a; }) ? ' resa' : ''); c.dataset.a = a;
    c.innerHTML = '<span title="' + esc(adr) + '">' + esc(a) + '</span><button type="button" aria-label="Retirer">×</button>';
    c.querySelector('button').onclick = function () { c.remove(); changement(); };
    zone.insertBefore(c, inp); changement();
  }
  ['ec-a', 'ec-cc', 'ec-cci'].forEach(function (id) {
    var inp = $('#' + id + '-in');
    inp.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';' || ev.key === 'Tab' && inp.value.trim()) { if (inp.value.trim()) { ev.preventDefault(); ajouterChip(id, inp.value); inp.value = ''; } } else if (ev.key === 'Backspace' && !inp.value) { var l = $('#' + id).querySelectorAll('.chip'); if (l.length) { l[l.length - 1].remove(); changement(); } } };
    inp.onblur = function () { if (inp.value.trim()) { ajouterChip(id, inp.value); inp.value = ''; } };
    inp.onpaste = function (ev) { var t = (ev.clipboardData || window.clipboardData).getData('text/plain'); if (/[,;\s]/.test(t.trim())) { ev.preventDefault(); adressesDe(t).forEach(function (x) { ajouterChip(id, x); }); } };
    $('#' + id).onclick = function (ev) { if (ev.target === this) inp.focus(); };
  });
  adressesDe(a).forEach(function (x) { ajouterChip('ec-a', x); });
  if (cc) { $('#ec-ligne-cc').hidden = false; adressesDe(cc).forEach(function (x) { ajouterChip('ec-cc', x); }); }
  if (cci) { $('#ec-ligne-cci').hidden = false; adressesDe(cci).forEach(function (x) { ajouterChip('ec-cci', x); }); }
  $('#ec-voir-cc').onclick = function () { $('#ec-ligne-cc').hidden = false; $('#ec-cc-in').focus(); };
  $('#ec-voir-cci').onclick = function () { $('#ec-ligne-cci').hidden = false; $('#ec-cci-in').focus(); };
  E.modifie = !!options.modifie;
  function lire() {
    return { mode: mode, filId: f ? f.id : '', messageId: E.messageId || '', a: chips('ec-a').join(', '), cc: chips('ec-cc').join(', '), cci: chips('ec-cci').join(', '), objet: $('#ec-objet').value.trim(), html: texte.innerHTML,
      citation: E.citation, pied: $('#ec-pied').checked, brouillonId: E.brouillonId, cleSecours: cle, pieces: E.pieces.filter(function (p) { return p.base64; }).map(function (p) { return { nom: p.nom, type: p.type, base64: p.base64 }; }), traite: !!E.traite, objetFil: f ? f.objet : '' };
  }
  function etat(txt, ok) { var e = $('#ec-etat'); if (e) { e.textContent = txt; e.classList.toggle('ok', !!ok); } }
  function copier() { if (!E.modifie || E.parti) return; var m = lire(); if (!m.a && !m.objet && !texteDeHtml(m.html)) return; secoursGarderMx({ cle: cle, t: Date.now(), mode: mode, m: Object.assign({}, m, { pieces: undefined }), brouillonId: E.brouillonId }); }
  function changement() {
    E.modifie = true; if (!E.premier) E.premier = Date.now();
    clearTimeout(E.copie); E.copie = setTimeout(copier, 800);
    if (E.programme) return etat('Modifié · « Reprogrammer » enregistre');
    etat('Modifié…');
    clearTimeout(E.minuterie);
    var attente = Date.now() - E.premier > 20000 ? 0 : 5000;
    E.minuterie = setTimeout(function () { sauver(false); }, attente);
  }
  function sauver(manuel, apres) {
    if (E.programme) { if (apres) apres(); return; }
    var m = lire();
    if (!m.a && !m.objet && !texteDeHtml(m.html) && !m.pieces.length) { if (apres) apres(); return; }
    if (E.enCours) { E.attente.push(function () { sauver(manuel, apres); }); return; }
    var sig = JSON.stringify([m.a, m.cc, m.cci, m.objet, m.html, m.pied, m.pieces.length]);
    if (!manuel && sig === E.dernierSauve) { if (apres) apres(); return; }
    E.enCours = true; E.premier = 0; etat('Enregistrement…');
    appelMx('adminMailsBrouillon', [m], function (r) {
      E.enCours = false; E.dernierSauve = sig;
      if (r.dejaParti) { etat('Déjà envoyé'); }
      else { E.brouillonId = r.brouillonId || E.brouillonId; if (r.filId && !E.filNeuf) E.filNeuf = r.filId; E.modifie = false; var d = new Date(); etat('Enregistré ' + d2(d.getHours()) + 'h' + d2(d.getMinutes()), true); secoursEffacerMx(cle); }
      var s = E.attente.splice(0); s.forEach(function (x) { x(); });
      if (apres) apres(r);
      if (f) { delete MX.filsGardes[f.id]; } MX.cache = {};
    }, function (e) { E.enCours = false; etat('Pas enregistré : ' + (e.message || e)); copier(); var s = E.attente.splice(0); s.forEach(function (x) { x(); }); return true; }, true);
  }
  E.copier = copier; E.sauver = sauver;
  texte.addEventListener('input', changement);
  $('#ec-objet').addEventListener('input', changement);
  $('#ec-pied').addEventListener('change', function () { garderLocal('mails_sans_pied', this.checked ? '' : '1'); changement(); });
  texte.addEventListener('paste', function (ev) {
    var dt = ev.clipboardData || window.clipboardData; if (!dt) return;
    var html = dt.getData('text/html'), txt = dt.getData('text/plain');
    if (!html && !txt) return;
    ev.preventDefault();
    document.execCommand('insertHTML', false, html ? htmlCollePropre(html) : esc(txt).replace(/\n/g, '<br>'));
  });
  texte.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'b') { ev.preventDefault(); document.execCommand('bold'); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'i') { ev.preventDefault(); document.execCommand('italic'); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); $('#ec-envoyer').click(); }
  });
  z.querySelectorAll('[data-cmd]').forEach(function (b) {
    b.onmousedown = function (ev) { ev.preventDefault(); };
    b.onclick = function () {
      var c = b.dataset.cmd; texte.focus();
      if (c === 'lien') { var sel = String(getSelection()); return demander('Adresse du lien (https://…) :', function (u) { if (!/^https?:\/\//i.test(u)) u = 'https://' + u; texte.focus(); if (sel) document.execCommand('createLink', false, u); else document.execCommand('insertHTML', false, '<a href="' + esc(u) + '">' + esc(u) + '</a>'); changement(); }, { titre: 'Insérer un lien', oui: 'Insérer', placeholder: 'https://' }); }
      if (c === 'nettoyer') { texte.querySelectorAll('*').forEach(function (el) { ['background', 'background-color', 'color', 'font-family', 'font-size', 'line-height'].forEach(function (p) { if (el.style) el.style.removeProperty(p); }); if (el.getAttribute('style') === '') el.removeAttribute('style'); if (el.tagName === 'FONT' || (el.tagName === 'SPAN' && !el.attributes.length)) { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); } }); changement(); return toast('Mise en forme collée retirée'); }
      document.execCommand(c); changement();
    };
  });
  var rapide = $('#ec-rapide'); if (rapide) rapide.onchange = function () {
    var i = rapide.value; rapide.value = ''; if (i === '') return;
    var r = resas[0] || {}, v = { prenom: String(r.nom || '').split(/\s+/)[0] || '', titre: r.titre || '', date: r.date ? dateLongueFr(r.date) : '', places: r.places || '', festival: D.reglages.nomFestival || '' };
    function mettre() { texte.innerHTML = texteVersParagraphes(MAIL.remplir(REPONSES_RAPIDES[i][1], v)); changement(); texte.focus(); }
    if (texteDeHtml(texte.innerHTML)) confirmer('Remplacer le texte déjà écrit ?', mettre, { oui: 'Remplacer' }); else mettre();
  };
  // Pièces jointes : lues sur l'appareil, envoyées avec le brouillon (15 Mo par fichier, 20 Mo en tout)
  function dessinerPieces() {
    var zp = $('#ec-pieces'); if (!zp) return;
    zp.innerHTML = E.piecesGardees.map(function (p) { return '<div class="pj"><span class="nom">' + esc(p.nom) + '</span><small>' + tailleLisible(p.taille) + ' · déjà jointe</small></div>'; }).join('') +
      E.pieces.map(function (p, i) { return '<div class="pj' + (p.base64 ? '' : ' envoi') + '"><span class="nom" title="' + esc(p.nom) + '">' + esc(p.nom) + '</span><small>' + tailleLisible(p.taille) + (p.base64 ? '' : ' · lecture…') + '</small><button type="button" class="btn petit" data-retirer-pj="' + i + '" aria-label="Retirer">×</button></div>'; }).join('');
    zp.querySelectorAll('[data-retirer-pj]').forEach(function (b) { b.onclick = function () { E.pieces.splice(Number(b.dataset.retirerPj), 1); dessinerPieces(); changement(); }; });
  }
  $('#ec-joindre').onclick = function () { $('#ec-fichier').click(); };
  $('#ec-fichier').onchange = function () {
    Array.prototype.forEach.call(this.files, function (fich) {
      var total = E.pieces.reduce(function (s, p) { return s + p.taille; }, 0) + fich.size;
      if (fich.size > 15e6) return toast('« ' + fich.name + ' » : trop lourd (15 Mo au plus). Partagez-le plutôt par un lien.', true);
      if (total > 20e6) return toast('Pièces jointes trop lourdes (20 Mo au plus en tout).', true);
      var p = { nom: fich.name, type: fich.type || 'application/octet-stream', taille: fich.size, base64: '' }; E.pieces.push(p); dessinerPieces();
      var lecteur = new FileReader();
      lecteur.onload = function () { p.base64 = String(lecteur.result).split(',')[1] || ''; dessinerPieces(); changement(); };
      lecteur.onerror = function () { E.pieces = E.pieces.filter(function (x) { return x !== p; }); dessinerPieces(); toast('Fichier illisible : ' + fich.name, true); };
      lecteur.readAsDataURL(fich);
    });
    this.value = '';
  };
  dessinerPieces();
  $('#ec-reduire').onclick = function () { z.classList.toggle('reduit'); };
  $('#ec-grand').onclick = function () { z.classList.toggle('grand'); garderLocal('mails_ecrire_grand', z.classList.contains('grand') ? '1' : ''); };
  $('.ec-tete').ondblclick = function (ev) { if (!ev.target.closest('button')) z.classList.toggle('reduit'); };
  function fermer() {
    if (E.ferme) return; E.ferme = true; clearTimeout(E.minuterie); clearTimeout(E.copie);
    ECRITURE = null; z.hidden = true; z.innerHTML = '';
    if (vue === 'boite') { if (MX.fil) ouvrirConversationMx(MX.fil.id, true); chargerFilsMx(true); chargerDossiersMx(); }
  }
  $('#ec-fermer').onclick = function () {
    if (E.programme) { if (!E.modifie) return fermer(); return confirmer('Fermer sans reprogrammer ? Les changements seront perdus (le mail programmé reste tel quel).', fermer, { oui: 'Fermer', non: 'Rester' }); }
    var m = lire(), vide = !m.a && !m.objet && !texteDeHtml(m.html) && !m.pieces.length;
    if (vide) { if (E.brouillonId) appelMx('adminMailsSupprimerBrouillon', [E.brouillonId], function () {}, function () { return true; }, true); secoursEffacerMx(cle); E.parti = true; return fermer(); }
    if (!E.modifie && !E.enCours) return fermer();
    etat('Enregistrement…');
    sauver(true, function () { toast('Brouillon gardé dans Gmail ✓'); fermer(); });
  };
  if ($('#ec-sauver')) $('#ec-sauver').onclick = function () { sauver(true, function () { toast('Brouillon enregistré ✓'); }); };
  if ($('#ec-supprimer')) $('#ec-supprimer').onclick = function () {
    confirmer('Supprimer ce brouillon ? Le texte sera perdu.', function () {
      E.parti = true; clearTimeout(E.minuterie); secoursEffacerMx(cle);
      var id = E.brouillonId; if (id) appelMx('adminMailsSupprimerBrouillon', [id], function () { toast('Brouillon supprimé ✓'); }, function (e) { toast(e.message || e, true); return true; }, true);
      fermer();
    }, { oui: 'Supprimer', danger: true });
  };
  function verifier() {
    var m = lire();
    if (!adressesDe(m.a).length) { toast('Indiquez au moins un destinataire.', true); $('#ec-a-in').focus(); return null; }
    var mauvais = chips('ec-a').concat(chips('ec-cc'), chips('ec-cci')).filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
    if (mauvais.length) { toast('Adresse incorrecte : ' + mauvais[0], true); return null; }
    if (E.pieces.some(function (p) { return !p.base64; })) { toast('Une pièce jointe se lit encore : un instant.', true); return null; }
    return m;
  }
  function envoyer(m) {
    E.parti = true; clearTimeout(E.minuterie); clearTimeout(E.copie);
    var b = $('#ec-envoyer'); b.disabled = true; b.textContent = 'Envoi…'; $('#ec-programmer').disabled = true;
    MX.envoisEnCours = (MX.envoisEnCours || []).concat([{ fil: f ? f.id : '', objet: m.objet.trim().toLowerCase() }]);
    appelMx('adminMailsEnvoyer', [m], function (r) {
      secoursEffacerMx(cle); toast('Envoyé à ' + r.a + ' ✓');
      setTimeout(function () { MX.envoisEnCours = []; }, 20000);
      MX.cache = {}; if (f) delete MX.filsGardes[f.id];
      fermer();
      if (vue === 'boite') { if (r.fil && (!surTelephone() || (MX.fil && MX.fil.id === r.fil))) ouvrirConversationMx(r.fil, true); }
    }, function (e) { E.parti = false; MX.envoisEnCours = []; b.disabled = false; b.textContent = 'Envoyer'; $('#ec-programmer').disabled = false; toast('Pas envoyé : ' + (e.message || e), true); copier(); return true; });
  }
  function programmer(m) {
    choisirHeureEnvoi(E.programme ? E.programme.prevu : 0, 'Le mail « ' + (m.objet || 'sans objet') + ' » à ' + m.a + ' partira tout seul à l\'heure choisie.', function (ms) {
      E.parti = true; clearTimeout(E.minuterie); clearTimeout(E.copie);
      var b = $('#ec-programmer'); b.disabled = true; $('#ec-envoyer').disabled = true;
      appelMx('adminMailsProgrammer', [m, ms, E.programme ? E.programme.id : ''], function (r) {
        secoursEffacerMx(cle); toast('Programmé : part ' + texteHeureGeneve(r.prevu) + ' ✓'); majProgrammesMx(r.liste); MX.cache = {}; if (f) delete MX.filsGardes[f.id]; fermer();
      }, function (e) { E.parti = false; b.disabled = false; $('#ec-envoyer').disabled = false; toast(e.message || e, true); return true; });
    });
  }
  $('#ec-envoyer').onclick = function () {
    var m = verifier(); if (!m) return;
    if (E.programme) return programmer(m);
    var n = adressesDe(m.a + ',' + m.cc + ',' + m.cci).length, proposerTraite = f && (f.resas || []).length && !f.traite;
    dialogue({ titre: 'Envoyer ce mail ?', html: '<p>À ' + esc(m.a) + (n > 1 ? ' (et ' + (n - 1) + ' autre' + (n > 2 ? 's' : '') + ')' : '') + '. Impossible de rappeler un mail parti.</p>' + (f && !f.traite ? '<label class="coche"><input type="checkbox" id="dlgTraite"' + (proposerTraite ? ' checked' : '') + '> Marquer la conversation comme traitée</label>' : ''), oui: 'Envoyer', ok: function () { E.traite = !!($('#dlgTraite') && $('#dlgTraite').checked); envoyer(lire()); } });
  };
  $('#ec-programmer').onclick = function () {
    var m = verifier(); if (!m) return;
    if (E.programme) return confirmer('Envoyer ce mail maintenant (au lieu de l\'heure programmée) ?', function () { appelMx('adminMailsProgrammer', [m, Date.now() + 90000, E.programme.id], function () { appelMx('adminMailsProgrammeEnvoyer', [E.programme.id], function (r) { E.parti = true; secoursEffacerMx(cle); toast('Envoyé ✓'); majProgrammesMx(r.liste); MX.cache = {}; fermer(); }); }); }, { oui: 'Envoyer maintenant' });
    programmer(m);
  };
  if (E.modifie) changement();
  setTimeout(function () { (chips('ec-a').length ? texte : $('#ec-a-in')).focus(); }, 60);
}
document.addEventListener('visibilitychange', function () { if (document.hidden && ECRITURE && ECRITURE.modifie && !ECRITURE.parti) { try { ECRITURE.copier(); ECRITURE.sauver(false); } catch (e) { /* éditeur fermé */ } } });
window.addEventListener('pagehide', function () { if (ECRITURE && ECRITURE.modifie && !ECRITURE.parti) { try { ECRITURE.copier(); } catch (e) { /* éditeur fermé */ } } });
window.addEventListener('beforeunload', function (e) { if (ECRITURE && ECRITURE.modifie && !ECRITURE.parti) { e.preventDefault(); e.returnValue = ''; } });

// ---------- Colonnes fixes (ordinateur) : rien ne défile sauf les colonnes, séparateurs glissables ----------
(function () {
  var CLE = 'mails_colonnes', largeurs = null;
  try { largeurs = JSON.parse(lireLocal(CLE) || 'null'); } catch (e) { largeurs = null; }
  function borner(W, c1, c2) {
    c1 = Math.max(150, Math.min(320, Math.round(c1)));
    var max2 = W - c1 - 28 - 380;
    c2 = Math.max(280, Math.min(Math.round(c2), max2));
    if (c2 > max2) { c1 = Math.max(150, W - 28 - 380 - 280); c2 = Math.max(280, W - c1 - 28 - 380); }
    return { c1: c1, c2: c2 };
  }
  function parDefaut(W) { return { c1: W < 1200 ? 190 : 220, c2: Math.max(300, Math.min(460, Math.round(W * 0.34))) }; }
  function appliquer() {
    var g = $('#mx'); if (!g) return null;
    var W = g.clientWidth || 1000, v = largeurs || parDefaut(W), b = borner(W, v.c1, v.c2);
    g.style.setProperty('--mc1', b.c1 + 'px'); g.style.setProperty('--mc2', b.c2 + 'px');
    return b;
  }
  function majHauteur() {
    var g = $('#mx'); if (!g || !mxFixe()) return;
    if (window.scrollY) window.scrollTo(0, 0);
    var h = Math.max(360, Math.floor(window.innerHeight - g.getBoundingClientRect().top - 10)) + 'px';
    if (g.style.getPropertyValue('--mx-haut') !== h) g.style.setProperty('--mx-haut', h);
  }
  window.majMxFixe = function () {
    var g = $('#mx');
    var oui = !!g && vue === 'boite' && innerWidth >= 1000 && innerHeight >= 520;
    document.documentElement.classList.toggle('mx-fixe', oui);
    if (oui) { window.scrollTo(0, 0); appliquer(); majHauteur(); }
  };
  var gl = null;
  document.addEventListener('pointerdown', function (e) {
    var s = e.target.closest && e.target.closest('.mx-sep'); if (!s || !mxFixe()) return;
    e.preventDefault();
    var b = appliquer(); gl = { n: s.dataset.sep, x: e.clientX, c1: b.c1, c2: b.c2, W: $('#mx').clientWidth, s: s };
    try { s.setPointerCapture(e.pointerId); } catch (x) { /* ancien navigateur */ }
    s.classList.add('actif'); document.documentElement.classList.add('glisse-col');
  });
  document.addEventListener('pointermove', function (e) { if (!gl) return; var d = e.clientX - gl.x; largeurs = borner(gl.W, gl.n === '1' ? gl.c1 + d : gl.c1, gl.n === '2' ? gl.c2 + d : gl.c2); appliquer(); });
  function fin() { if (!gl) return; gl.s.classList.remove('actif'); document.documentElement.classList.remove('glisse-col'); gl = null; if (largeurs) garderLocal(CLE, JSON.stringify(largeurs)); }
  document.addEventListener('pointerup', fin); document.addEventListener('pointercancel', fin);
  document.addEventListener('dblclick', function (e) { if (e.target.closest && e.target.closest('.mx-sep')) { largeurs = null; garderLocal(CLE, ''); appliquer(); } });
  document.addEventListener('keydown', function (e) {
    var s = e.target.closest && e.target.closest('.mx-sep'); if (!s || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault(); var b = appliquer(), d = e.key === 'ArrowLeft' ? -20 : 20;
    largeurs = borner($('#mx').clientWidth, s.dataset.sep === '1' ? b.c1 + d : b.c1, s.dataset.sep === '2' ? b.c2 + d : b.c2); appliquer(); garderLocal(CLE, JSON.stringify(largeurs));
  });
  window.addEventListener('resize', function () { clearTimeout(majMxFixe.t); majMxFixe.t = setTimeout(majMxFixe, 120); });
  setInterval(function () { if (mxFixe()) { if (vue !== 'boite' || !$('#mx')) majMxFixe(); else majHauteur(); } }, 700);
  window.addEventListener('scroll', function () { if (mxFixe() && window.scrollY) window.scrollTo(0, 0); }, { passive: true });
})();
