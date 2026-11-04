/**
 * Réservations du festival — application Google Apps Script liée à la feuille du festival.
 *
 * Menu « Festival » de la feuille :
 *   - Lien de l'appli : affiche l'adresse pour le site et le lien personnel de l'appli de gestion.
 *   - Changer la clé du lien : l'ancien lien personnel ne marche plus.
 */

var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Festival')
    .addItem("Lien de l'appli de gestion", 'lienAppli')
    .addItem('Changer la clé du lien', 'changerCleAppli')
    .addToUi();
}

/** "2026-10-17" -> "17 octobre 2026" (et "1er" pour le premier du mois). */
function texteDate_(iso) {
  var p = iso.split('-').map(Number);
  return (p[2] === 1 ? '1er' : p[2]) + ' ' + MOIS[p[1] - 1] + ' ' + p[0];
}
