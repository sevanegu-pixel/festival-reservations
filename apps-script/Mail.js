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
