// E-mails de réservation : composition partagée entre le script (envoi) et l'appli (aperçu en direct).
// Aucune dépendance Apps Script ici : ce fichier est aussi inséré dans Admin.html par assembler.py.
var MAIL = (function () {
  var VARIABLES = [
    ['nom', 'Prénom et nom', 'Camille Dupont'], ['prenom', 'Prénom', 'Camille'], ['places', 'Nombre de places', '2'],
    ['titre', 'Titre du spectacle', 'Hurler sous l\'eau'], ['date', 'Date (en toutes lettres)', 'vendredi 4 décembre 2026'], ['heure', 'Heure', '19:45'],
    ['lieu', 'Lieu et adresse', 'Théâtricul, Rue de Genève 64, Chêne-Bourg'], ['adresse', 'Adresse seule', 'Rue de Genève 64, Chêne-Bourg'],
    ['tarif', 'Tarif', 'Prix libre, 10 francs conseillés'], ['numero', 'Numéro de réservation', 'R-7F3K2'], ['email', 'E-mail de la personne', 'camille@example.ch'],
    ['telephone', 'Téléphone de la personne', '079 000 00 00'], ['message', 'Message laissé', ''], ['festival', 'Nom du festival', 'Le Petit Festival au Théâtricul'],
    ['site', 'Adresse du site', 'https://petit-festival.ch'], ['lien', 'Page du spectacle sur le site', 'https://petit-festival.ch/apercu/programme.html#ev1']
  ];
  // Un modèle par cas de figure. auto : envoyé tout seul ; sinon envoyé depuis la page de l'événement, à la demande.
  var TYPES = {
    confirmation: { nom: 'Confirmation de réservation', sujet: 'sujet', message: 'message', billet: true, auto: true,
      quand: 'Envoyé tout de suite quand quelqu\'un réserve sur le site, ou quand vous ajoutez une réservation à la main en cochant « prévenir ».' },
    attente: { nom: 'Liste d\'attente', sujet: 'sujetAttente', message: 'messageAttente', billet: false, auto: true,
      quand: 'Envoyé quand quelqu\'un s\'inscrit sur la liste d\'attente d\'un événement complet.' },
    liberee: { nom: 'Une place s\'est libérée', sujet: 'sujetLiberee', message: 'messageLiberee', billet: true, auto: true,
      quand: 'Envoyé quand vous passez une inscription de la liste d\'attente à « Confirmée ».' },
    annulation: { nom: 'Réservation annulée', sujet: 'sujetAnnulation', message: 'messageAnnulation', billet: false, auto: true,
      quand: 'Envoyé quand vous annulez une réservation en choisissant « prévenir ».' },
    rappel: { nom: 'Rappel avant le spectacle', sujet: 'sujetRappel', message: 'messageRappel', billet: true, auto: false, groupe: true,
      quand: 'À envoyer la veille ou le matin même, à toutes les personnes inscrites, depuis la page de l\'événement (bouton « Écrire aux inscrits »).' },
    evenementAnnule: { nom: 'Spectacle annulé ou déplacé', sujet: 'sujetEvenementAnnule', message: 'messageEvenementAnnule', billet: false, auto: false, groupe: true, attente: true,
      quand: 'À envoyer depuis la page de l\'événement à toutes les personnes inscrites (liste d\'attente comprise) si le spectacle est annulé, déplacé ou si l\'horaire change.' },
    merci: { nom: 'Merci après le spectacle', sujet: 'sujetMerci', message: 'messageMerci', billet: false, auto: false, groupe: true,
      quand: 'À envoyer le lendemain depuis la page de l\'événement : un mot de remerciement, le reste du programme, un lien pour donner son avis…' }
  };
  var THEMES = {
    festival: { nom: 'Festival (nuit)', fond: '#120f24', papier: '#f7f3ff', texte: '#1b1733', doux: '#5b5570', accent: '#ff1fb4', accent2: '#6b2cff', bord: '#1b1733', sur: '#f7f3ff' },
    clair: { nom: 'Clair', fond: '#f7f0e1', papier: '#ffffff', texte: '#1b1733', doux: '#5b5570', accent: '#c81f74', accent2: '#1f5bff', bord: '#1b1733', sur: '#f7f3ff' },
    corail: { nom: 'Corail', fond: '#ff6b57', papier: '#fff8f3', texte: '#2a1410', doux: '#7a4a40', accent: '#c81f74', accent2: '#ff6b57', bord: '#2a1410', sur: '#ffffff' },
    sobre: { nom: 'Sobre (sans couleur)', fond: '#ffffff', papier: '#ffffff', texte: '#111111', doux: '#666666', accent: '#111111', accent2: '#111111', bord: '#111111', sur: '#ffffff' }
  };
  var PIEDS = { simple: 'Simple (filet)', encadre: 'Encadré', bandeau: 'Bandeau de couleur' };
  var OPTIONS_DEFAUT = { theme: 'festival', visuel: true, entete: true, bouton: '', lienBouton: 'lien', billet: null, separateur: 'etoiles' };

  function echapper(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function urlSure(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  function remplir(modele, valeurs) {
    return String(modele == null ? '' : modele).replace(/\{(\w+)\}/g, function (tout, cle) { return cle in valeurs ? String(valeurs[cle] == null ? '' : valeurs[cle]) : tout; })
      .replace(/[ \t]+\n/g, '\n');
  }
  // Options d'un type d'e-mail : réglage optionsMail (JSON) + défauts.
  function options(r, type) {
    var tous = {};
    try { tous = JSON.parse(r.optionsMail || '{}') || {}; } catch (e) { tous = {}; }
    var o = {}; Object.keys(OPTIONS_DEFAUT).forEach(function (k) { o[k] = OPTIONS_DEFAUT[k]; });
    var t = tous[type] || {}; Object.keys(t).forEach(function (k) { o[k] = t[k]; });
    if (!THEMES[o.theme]) o.theme = 'festival';
    var def = TYPES[type] || TYPES.confirmation;
    if (o.billet == null) o.billet = def.billet && String(r.billet || '') === 'Oui';
    return o;
  }
  // Texte → paragraphes HTML ; **gras**, *italique*, liens cliquables.
  function enLigne(t, p) {
    return echapper(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<i>$2</i>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + p.accent + '">$1</a>');
  }
  function texteVersHtml(texte, p, couleur) {
    p = p || THEMES.festival;
    return String(texte || '').trim().split(/\n\s*\n/).map(function (par) { return '<p style="margin:0 0 14px' + (couleur ? ';color:' + couleur : '') + '">' + enLigne(par, p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }
  function police() { return 'Georgia,\'Times New Roman\',serif'; }
  function sans() { return 'Arial,Helvetica,sans-serif'; }
  // Billet : récapitulatif encadré, à présenter à l'entrée.
  function billetHtml(v, p) {
    p = p || THEMES.festival;
    var ligne = function (l, t) { return t ? '<tr><td style="padding:4px 12px 4px 0;color:' + p.doux + ';font:13px/1.4 ' + sans() + ';text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;vertical-align:top">' + l + '</td><td style="padding:4px 0;font-size:16px;vertical-align:top;color:' + p.texte + '">' + echapper(t) + '</td></tr>' : ''; };
    return '<div style="margin:20px 0;border:2px solid ' + p.bord + ';background:#f7f0e1;box-shadow:5px 5px 0 ' + p.accent2 + '">' +
      '<table width="100%" style="border-collapse:collapse;background:' + p.bord + ';color:' + p.sur + '"><tr><td style="padding:10px 16px;font:700 13px/1.4 ' + sans() + ';text-transform:uppercase;letter-spacing:.14em">' + echapper(v.festival || 'Billet') + '</td><td align="right" style="padding:10px 16px;font:700 13px/1.4 ' + sans() + ';text-transform:uppercase;letter-spacing:.14em;color:' + p.accent + ';white-space:nowrap">Billet</td></tr></table>' +
      '<div style="padding:16px 18px"><div style="font:700 24px/1.15 ' + police() + ';margin:0 0 10px;color:' + p.texte + '">' + echapper(v.titre || '') + '</div><table style="border-collapse:collapse">' +
      ligne('Date', v.date) + ligne('Heure', v.heure) + ligne('Lieu', v.lieu) + ligne('Au nom de', v.nom) + ligne('Places', v.places) + (v.tarif ? ligne('Tarif', v.tarif) : '') + ligne('N°', v.numero) +
      '</table><p style="margin:12px 0 0;font:13px/1.4 ' + sans() + ';color:' + p.doux + '">Présentez ce billet (sur votre téléphone, c\'est parfait) à l\'entrée. Paiement sur place.</p></div></div>';
  }
  function separateurHtml(style, p) {
    if (style === 'ligne') return '<div style="border-top:2px solid ' + p.accent + ';margin:18px auto;width:80px;font-size:0;line-height:0">&nbsp;</div>';
    if (style === 'etoiles') return '<div style="text-align:center;color:' + p.accent + ';font-size:16px;letter-spacing:10px;margin:14px 0;font-family:' + sans() + '">✦ ✦ ✦</div>';
    return '';
  }
  function boutonHtml(texte, lien, p) {
    lien = urlSure(lien); if (!texte || !lien) return '';
    return '<div style="text-align:center;margin:22px 0"><a href="' + echapper(lien) + '" style="display:inline-block;background:' + p.accent + ';color:#ffffff;text-decoration:none;font:700 15px/1.2 ' + sans() + ';padding:13px 24px;border:2px solid ' + p.bord + ';box-shadow:4px 4px 0 ' + p.bord + '">' + echapper(texte) + '</a></div>';
  }
  function reseauxHtml(r, couleur) {
    var l = [];
    if (urlSure(r.siteUrl)) l.push(['Site', String(r.siteUrl).replace(/\/apercu\/?$/, '')]);
    if (urlSure(r.instagram)) l.push(['Instagram', r.instagram]);
    if (urlSure(r.facebook)) l.push(['Facebook', r.facebook]);
    return l.map(function (x) { return '<a href="' + echapper(x[1]) + '" style="color:' + couleur + ';font:700 13px ' + sans() + ';text-decoration:none">' + x[0] + '</a>'; }).join(' <span style="color:' + couleur + '">·</span> ');
  }
  function piedHtml(pied, r, p) {
    var style = PIEDS[r.piedStyle] ? r.piedStyle : 'simple', reseaux = reseauxHtml(r, style === 'bandeau' ? p.sur : p.accent);
    var corps = (pied.trim() ? texteVersHtml(pied, p, style === 'bandeau' ? p.sur : p.doux).replace(/margin:0 0 14px/g, 'margin:0 0 6px') : '') + (reseaux ? '<div style="margin-top:10px">' + reseaux + '</div>' : '');
    if (!corps) return '';
    if (style === 'encadre') return '<div style="margin-top:28px;padding:16px 18px;border:1px solid ' + p.bord + ';font-size:13px;line-height:1.5;color:' + p.doux + '">' + corps + '</div>';
    if (style === 'bandeau') return '<div style="margin-top:28px;padding:18px 20px;background:' + p.bord + ';color:' + p.sur + ';font-size:13px;line-height:1.5">' + corps.replace(/color:[^;"]+/g, 'color:' + p.sur) + '</div>';
    return '<div style="margin-top:28px;padding-top:14px;border-top:1px solid #dccfb4;font-size:13px;line-height:1.5;color:' + p.doux + '">' + corps + '</div>';
  }
  // Mail complet d'un type donné, d'après les réglages r et les valeurs v.
  function composer(type, r, v) {
    var t = TYPES[type] || TYPES.confirmation, o = options(r, type), p = THEMES[o.theme];
    var sujet = remplir(r[t.sujet] || '', v), corps = remplir(r[t.message] || '', v), pied = remplir(r.piedDePage || '', v);
    var avecBillet = !!o.billet, image = o.visuel && urlSure(v.image), lienBouton = o.lienBouton === 'site' ? v.site : v.lien;
    var h = '<div style="background:' + p.fond + ';padding:24px 12px;font-family:' + police() + '"><div style="max-width:600px;margin:0 auto;background:' + p.papier + ';color:' + p.texte + ';font-size:16px;line-height:1.55;border:2px solid ' + p.bord + ';box-shadow:6px 6px 0 ' + p.accent2 + '">';
    if (o.entete) h += '<div style="padding:10px 22px;border-bottom:2px solid ' + p.bord + ';font:700 12px/1.4 ' + sans() + ';text-transform:uppercase;letter-spacing:.16em;color:' + p.texte + '">' + echapper(v.festival || '') + '</div>';
    if (image) h += '<img src="' + echapper(image) + '" alt="' + echapper(v.titre || '') + '" width="600" style="display:block;width:100%;height:auto;max-height:340px;object-fit:cover;border-bottom:2px solid ' + p.bord + '">';
    h += '<div style="padding:24px 22px 8px">' + texteVersHtml(corps, p) + (avecBillet ? billetHtml(v, p) : '') + boutonHtml(remplir(o.bouton || '', v), lienBouton, p) + separateurHtml(o.separateur, p) + piedHtml(pied, r, p) + '</div></div></div>';
    var texte = corps + (avecBillet ? '\n\n— Billet —\n' + [v.titre, v.date + (v.heure ? ' à ' + v.heure : ''), v.lieu, 'Au nom de ' + v.nom + ' · ' + v.places + ' place(s)', 'N° ' + v.numero].filter(Boolean).join('\n') : '') +
      (o.bouton && urlSure(lienBouton) ? '\n\n' + remplir(o.bouton, v) + ' : ' + lienBouton : '') + (pied.trim() ? '\n\n--\n' + pied : '');
    return { sujet: sujet, texte: texte, html: h };
  }
  function exemple() { var v = {}; VARIABLES.forEach(function (x) { v[x[0]] = x[2]; }); v.image = ''; return v; }
  return { VARIABLES: VARIABLES, TYPES: TYPES, THEMES: THEMES, PIEDS: PIEDS, OPTIONS_DEFAUT: OPTIONS_DEFAUT, options: options, remplir: remplir, texteVersHtml: texteVersHtml, billetHtml: billetHtml, composer: composer, exemple: exemple, echapper: echapper, urlSure: urlSure };
})();
