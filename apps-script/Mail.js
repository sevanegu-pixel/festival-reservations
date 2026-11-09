// E-mails de réservation : composition partagée entre le script (envoi) et l'appli (aperçu en direct).
// Aucune dépendance Apps Script ici : ce fichier est aussi inséré dans Admin.html par assembler.py.
var MAIL = (function () {
  var VARIABLES = [
    ['nom', 'Prénom et nom', 'Camille Dupont'], ['prenom', 'Prénom', 'Camille'], ['places', 'Nombre de places', '2'],
    ['titre', 'Titre du spectacle', 'Hurler sous l\'eau'], ['date', 'Date (en toutes lettres)', 'vendredi 4 décembre 2026'], ['heure', 'Heure', '19:45'],
    ['lieu', 'Lieu et adresse', 'Théâtricul, Rue de Genève 64, Chêne-Bourg'], ['adresse', 'Adresse seule', 'Rue de Genève 64, Chêne-Bourg'],
    ['tarif', 'Tarif', 'Prix libre, 10 francs conseillés'], ['numero', 'Numéro de réservation', 'R-7F3K2'], ['email', 'E-mail de la personne', 'camille@example.ch'],
    ['telephone', 'Téléphone de la personne', '079 000 00 00'], ['message', 'Message laissé', ''], ['festival', 'Nom du festival', 'Le Petit Festival au Théâtricul'],
    ['options', 'Options choisies (ex. billet + livre)', ''], ['site', 'Adresse du site', 'https://petit-festival.ch'], ['lien', 'Page du spectacle sur le site', 'https://petit-festival.ch/apercu/programme.html#ev1']
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
    festival: { nom: 'Festival (nuit)', fond: '#120f24', papier: '#f7f3ff', texte: '#1b1733', doux: '#5b5570', accent: '#ff1fb4', boutonTexte: '#ffffff', accent2: '#6b2cff', bord: '#1b1733', sur: '#f7f3ff', billet: '#f7f0e1', filet: '#d9cdb3' },
    clair: { nom: 'Clair', fond: '#f7f0e1', papier: '#ffffff', texte: '#1b1733', doux: '#5b5570', accent: '#c81f74', boutonTexte: '#ffffff', accent2: '#1f5bff', bord: '#1b1733', sur: '#f7f3ff', billet: '#f7f0e1', filet: '#d9cdb3' },
    corail: { nom: 'Corail', fond: '#ff6b57', papier: '#fff8f3', texte: '#2a1410', doux: '#7a4a40', accent: '#c81f74', boutonTexte: '#ffffff', accent2: '#2a1410', bord: '#2a1410', sur: '#ffffff', billet: '#fff1e8', filet: '#ecc9bb' },
    sobre: { nom: 'Sobre (sans couleur)', fond: '#ffffff', papier: '#ffffff', texte: '#111111', doux: '#666666', accent: '#111111', boutonTexte: '#ffffff', accent2: '#111111', bord: '#111111', sur: '#ffffff', billet: '#ffffff', filet: '#dddddd' }
  };
  // Couleurs réglables une à une (elles remplacent celles du thème choisi comme point de départ)
  var COULEURS = [
    ['fond', 'Fond autour du mail'], ['papier', 'Fond du mail'], ['texte', 'Texte'], ['doux', 'Texte discret'],
    ['accent', 'Liens, bouton, étoiles'], ['boutonTexte', 'Texte du bouton'], ['accent2', 'Ombre portée'],
    ['bord', 'Cadres et bandeaux'], ['sur', 'Texte sur les bandeaux'], ['billet', 'Fond du billet'], ['filet', 'Filets du billet']
  ];
  var PIEDS = { simple: 'Simple (filet)', encadre: 'Encadré', bandeau: 'Bandeau de couleur' };
  var OPTIONS_DEFAUT = { theme: 'festival', couleurs: null, ombre: true, visuel: true, entete: true, bouton: '', lienBouton: 'lien', billet: null, billetModele: 'classique', separateur: 'etoiles' };

  function echapper(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function urlSure(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  function remplir(modele, valeurs) {
    return String(modele == null ? '' : modele).replace(/\{(\w+)\}/g, function (tout, cle) { return cle in valeurs ? String(valeurs[cle] == null ? '' : valeurs[cle]) : tout; })
      .replace(/[ \t]+\n/g, '\n');
  }
  function couleurSure(c) { c = String(c || '').trim(); return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : ''; }
  // Palette d'un e-mail : le thème de départ, puis les couleurs choisies une à une.
  function palette(o) {
    var base = THEMES[o.theme] || THEMES.festival, p = {};
    Object.keys(base).forEach(function (k) { p[k] = base[k]; });
    var c = o.couleurs || {}; COULEURS.forEach(function (x) { var v = couleurSure(c[x[0]]); if (v) p[x[0]] = v; });
    return p;
  }
  // Ombre portée en dur (Gmail supprime box-shadow) : un tableau qui ajoute une bande de couleur décalée à droite et en bas.
  function ombre(interieur, couleur, d, largeur, dessous) {
    if (!couleur) return interieur;
    var vide = 'font-size:0;line-height:0;mso-line-height-rule:exactly';
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0"' + (largeur ? ' width="' + largeur + '"' : '') + ' style="border-collapse:collapse' + (largeur ? ';width:' + largeur : '') + '">' +
      '<tr><td valign="top" style="padding:0">' + interieur + '</td>' +
      '<td width="' + d + '" valign="top" bgcolor="' + couleur + '" style="width:' + d + 'px;background:' + couleur + ';' + vide + '"><div style="height:' + d + 'px;background:' + dessous + ';' + vide + '">&nbsp;</div></td></tr>' +
      '<tr><td bgcolor="' + couleur + '" style="background:' + couleur + ';padding:0;' + vide + '"><div style="width:' + d + 'px;height:' + d + 'px;background:' + dessous + ';' + vide + '">&nbsp;</div></td>' +
      '<td width="' + d + '" height="' + d + '" bgcolor="' + couleur + '" style="width:' + d + 'px;height:' + d + 'px;background:' + couleur + ';' + vide + '">&nbsp;</td></tr></table>';
  }
  // Options d'un type d'e-mail : réglage optionsMail (JSON) + défauts.
  function options(r, type) {
    var tous = {};
    try { tous = JSON.parse(r.optionsMail || '{}') || {}; } catch (e) { tous = {}; }
    var o = {}; Object.keys(OPTIONS_DEFAUT).forEach(function (k) { o[k] = OPTIONS_DEFAUT[k]; });
    var t = tous[type] || {}; Object.keys(t).forEach(function (k) { o[k] = t[k]; });
    if (!THEMES[o.theme]) o.theme = 'festival';
    if (!o.couleurs || typeof o.couleurs !== 'object') o.couleurs = {};
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
  // Billets : plusieurs modèles, tous en tableaux (Gmail) et lisibles dès 320 px de large.
  var BILLETS = { classique: 'Classique (cadre et lignes)', compact: 'Compact (une carte resserrée)', affiche: 'Affiche (grand titre en couleur)', minimal: 'Minimal (sans cadre)' };
  function lignesBillet(v) {
    return [['Date', v.date], ['Heure', v.heure], ['Lieu', v.lieu], ['Au nom de', v.nom], ['Places', v.places]].concat(v.tarif ? [['Tarif', v.tarif]] : [])
      .concat(v.options ? [['Options', v.options]] : []).concat([['N°', v.numero]]).filter(function (x) { return x[1]; });
  }
  function tableLignes(v, p, filet) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">' + lignesBillet(v).map(function (x, i, l) {
      var b = filet && i < l.length - 1 ? 'border-bottom:1px solid ' + p.filet + ';' : '';
      return '<tr><td width="84" valign="top" style="width:84px;padding:7px 10px 7px 0;' + b + 'color:' + p.doux + ';font:700 11px/1.5 ' + sans() + ';text-transform:uppercase;letter-spacing:.06em">' + x[0] + '</td>' +
        '<td valign="top" style="padding:6px 0;' + b + 'font:15px/1.4 ' + police() + ';color:' + p.texte + ';word-break:break-word">' + echapper(x[1]) + '</td></tr>';
    }).join('') + '</table>';
  }
  var MENTION = 'Présentez ce billet (sur votre téléphone, c\'est parfait) à l\'entrée. Paiement sur place.';
  function billetHtml(v, p, modele) {
    p = p || THEMES.festival; modele = BILLETS[modele] ? modele : 'classique';
    var avecOmbre = p.ombre === false ? '' : p.accent2, carte;
    var titre = function (taille, couleur) { return '<div style="font:700 ' + taille + 'px/1.2 ' + police() + ';margin:0 0 8px;color:' + (couleur || p.texte) + '">' + echapper(v.titre || '') + '</div>'; };
    var mention = '<p style="margin:10px 0 0;font:12px/1.45 ' + sans() + ';color:' + p.doux + '">' + MENTION + '</p>';
    var tete = '<tr><td bgcolor="' + p.bord + '" style="background:' + p.bord + ';padding:8px 14px"><div style="font:700 11px/1.4 ' + sans() + ';letter-spacing:.14em;text-transform:uppercase;color:' + p.accent + '">Billet</div>' +
      '<div style="font:700 11px/1.4 ' + sans() + ';letter-spacing:.08em;text-transform:uppercase;color:' + p.sur + '">' + echapper(v.festival || '') + '</div></td></tr>';
    if (modele === 'minimal') {
      return '<div style="margin:22px 0;padding:14px 0;border-top:2px solid ' + p.bord + ';border-bottom:2px solid ' + p.bord + '"><div style="font:700 11px/1.4 ' + sans() + ';letter-spacing:.14em;text-transform:uppercase;color:' + p.accent + ';margin-bottom:6px">Votre billet</div>' +
        titre(19) + tableLignes(v, p, false) + mention + '</div>';
    }
    if (modele === 'compact') {
      var quand = [v.date, v.heure].filter(Boolean).join(' · ');
      carte = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + p.billet + '" style="border-collapse:collapse;width:100%;border:2px solid ' + p.bord + ';background:' + p.billet + '"><tr><td style="padding:14px 16px">' +
        '<div style="font:700 11px/1.4 ' + sans() + ';letter-spacing:.14em;text-transform:uppercase;color:' + p.accent + '">Billet · ' + echapper(v.numero || '') + '</div>' + titre(18) +
        '<div style="font:15px/1.45 ' + police() + ';color:' + p.texte + '">' + echapper(quand) + '<br>' + echapper(v.lieu || '') + '</div>' +
        '<div style="margin-top:8px;padding-top:8px;border-top:1px solid ' + p.filet + ';font:14px/1.45 ' + police() + ';color:' + p.texte + '"><b>' + echapper(v.places || '') + ' place' + (Number(v.places) > 1 ? 's' : '') + '</b> au nom de ' + echapper(v.nom || '') +
        (v.tarif ? '<br><span style="color:' + p.doux + '">' + echapper(v.tarif) + '</span>' : '') + (v.options ? '<br>' + echapper(v.options) : '') + '</div>' + mention + '</td></tr></table>';
      return '<div style="margin:20px 0">' + ombre(carte, avecOmbre, 4, '100%', p.papier) + '</div>';
    }
    if (modele === 'affiche') {
      carte = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + p.billet + '" style="border-collapse:collapse;width:100%;border:2px solid ' + p.bord + ';background:' + p.billet + '">' +
        '<tr><td bgcolor="' + p.accent + '" style="background:' + p.accent + ';padding:16px">' +
        '<div style="font:700 11px/1.4 ' + sans() + ';letter-spacing:.14em;text-transform:uppercase;color:' + p.boutonTexte + '">' + echapper(v.festival || '') + ' · Billet</div>' +
        '<div style="font:700 24px/1.15 ' + police() + ';color:' + p.boutonTexte + ';margin-top:6px">' + echapper(v.titre || '') + '</div>' +
        '<div style="font:15px/1.4 ' + police() + ';color:' + p.boutonTexte + ';margin-top:6px">' + echapper([v.date, v.heure].filter(Boolean).join(' · ')) + '</div></td></tr>' +
        '<tr><td style="padding:12px 16px">' + tableLignes({ lieu: v.lieu, nom: v.nom, places: v.places, tarif: v.tarif, options: v.options, numero: v.numero }, p, true) + mention + '</td></tr></table>';
      return '<div style="margin:20px 0">' + ombre(carte, avecOmbre, 5, '100%', p.papier) + '</div>';
    }
    carte = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + p.billet + '" style="border-collapse:collapse;width:100%;border:2px solid ' + p.bord + ';background:' + p.billet + '">' + tete +
      '<tr><td style="padding:14px 16px">' + titre(20) + tableLignes(v, p, true) + mention + '</td></tr></table>';
    return '<div style="margin:20px 0">' + ombre(carte, avecOmbre, 5, '100%', p.papier) + '</div>';
  }
  function separateurHtml(style, p) {
    if (style === 'ligne') return '<div style="border-top:2px solid ' + p.accent + ';margin:18px auto;width:80px;font-size:0;line-height:0">&nbsp;</div>';
    if (style === 'etoiles') return '<div style="text-align:center;color:' + p.accent + ';font-size:16px;letter-spacing:10px;margin:14px 0;font-family:' + sans() + '">✦ ✦ ✦</div>';
    return '';
  }
  function boutonHtml(texte, lien, p) {
    lien = urlSure(lien); if (!texte || !lien) return '';
    var b = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td bgcolor="' + p.accent + '" style="background:' + p.accent + ';border:2px solid ' + p.bord + '">' +
      '<a href="' + echapper(lien) + '" style="display:inline-block;color:' + p.boutonTexte + ';text-decoration:none;font:700 15px/1.2 ' + sans() + ';padding:13px 24px">' + echapper(texte) + '</a></td></tr></table>';
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:22px 0"><tr><td align="center">' + ombre(b, p.ombre === false ? '' : p.bord, 4, '', p.papier) + '</td></tr></table>';
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
    return '<div style="margin-top:28px;padding-top:14px;border-top:1px solid ' + p.filet + ';font-size:13px;line-height:1.5;color:' + p.doux + '">' + corps + '</div>';
  }
  // Mail complet d'un type donné, d'après les réglages r et les valeurs v.
  function composer(type, r, v) {
    var t = TYPES[type] || TYPES.confirmation, o = options(r, type), p = palette(o);
    if (!o.ombre) p.ombre = false;
    var sujet = remplir(r[t.sujet] || '', v), corps = remplir(r[t.message] || '', v), pied = remplir(r.piedDePage || '', v);
    var avecBillet = !!o.billet, image = o.visuel && urlSure(v.image), lienBouton = o.lienBouton === 'site' ? v.site : v.lien;
    var c = '';
    if (o.entete) c += '<div style="padding:10px 18px;border-bottom:2px solid ' + p.bord + ';font:700 12px/1.4 ' + sans() + ';text-transform:uppercase;letter-spacing:.16em;color:' + p.texte + '">' + echapper(v.festival || '') + '</div>';
    if (image) c += '<img src="' + echapper(image) + '" alt="' + echapper(v.titre || '') + '" width="600" style="display:block;width:100%;max-width:100%;height:auto;max-height:340px;object-fit:cover;border:0;border-bottom:2px solid ' + p.bord + '">';
    c += '<div style="padding:22px 18px 8px">' + texteVersHtml(corps, p) + (avecBillet ? billetHtml(v, p, o.billetModele) : '') + boutonHtml(remplir(o.bouton || '', v), lienBouton, p) + separateurHtml(o.separateur, p) + piedHtml(pied, r, p) + '</div>';
    // Carte du mail : tableau (fond, cadre) + ombre en dur ; mêmes techniques que celles que Gmail affiche.
    var carte = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + p.papier + '" style="border-collapse:collapse;width:100%;background:' + p.papier + ';border:2px solid ' + p.bord + '"><tr><td style="padding:0;color:' + p.texte + ';font-family:' + police() + ';font-size:16px;line-height:1.55">' + c + '</td></tr></table>';
    var h = '<div style="background:' + p.fond + ';padding:18px 8px;font-family:' + police() + '"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + p.fond + '" style="border-collapse:collapse;background:' + p.fond + '"><tr><td align="center" style="padding:0">' +
      '<div style="max-width:606px;margin:0 auto;text-align:left">' + ombre(carte, p.ombre === false ? '' : p.accent2, 6, '100%', p.fond) + '</div></td></tr></table></div>';
    var texte = corps + (avecBillet ? '\n\n— Billet —\n' + [v.titre, v.date + (v.heure ? ' à ' + v.heure : ''), v.lieu, 'Au nom de ' + v.nom + ' · ' + v.places + ' place(s)', 'N° ' + v.numero].filter(Boolean).join('\n') : '') +
      (o.bouton && urlSure(lienBouton) ? '\n\n' + remplir(o.bouton, v) + ' : ' + lienBouton : '') + (pied.trim() ? '\n\n--\n' + pied : '');
    return { sujet: sujet, texte: texte, html: h };
  }
  function exemple() { var v = {}; VARIABLES.forEach(function (x) { v[x[0]] = x[2]; }); v.image = ''; return v; }
  return { VARIABLES: VARIABLES, TYPES: TYPES, THEMES: THEMES, COULEURS: COULEURS, BILLETS: BILLETS, palette: palette, couleurSure: couleurSure, PIEDS: PIEDS, OPTIONS_DEFAUT: OPTIONS_DEFAUT, options: options, remplir: remplir, texteVersHtml: texteVersHtml, billetHtml: billetHtml, composer: composer, exemple: exemple, echapper: echapper, urlSure: urlSure };
})();
