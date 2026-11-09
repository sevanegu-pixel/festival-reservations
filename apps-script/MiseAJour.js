// ---------- Mise à jour automatique du script depuis GitHub ----------
// Le code de référence est a-coller.gs dans le dépôt GitHub. Toutes les heures (et sur demande depuis l'appli),
// le script compare sa version à celle du dépôt ; si elle diffère, il remplace son propre code, crée une version
// et met à jour le déploiement de l'application web. Plus rien à coller à la main.
// Une seule fois : activer l'API Apps Script sur https://script.google.com/home/usersettings, coller le manifeste
// appsscript.json (autorisations), puis menu Festival → « Activer la mise à jour automatique ».

var VERSION_CODE = '__VERSION__';
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
  return;
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
  // Désactivée (09.11.2026) : le projet Google Cloud caché du script n'autorise pas l'API Apps Script, et un
  // redéploiement automatique changerait le compte d'envoi des e-mails. On supprime les déclencheurs restants.
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === MAJ.fonctionTrigger) ScriptApp.deleteTrigger(t); });
  return 'Mise à jour automatique désactivée : le code se colle dans Apps Script, puis Déployer › Nouvelle version avec le compte du festival.';
}
function verifierMiseAJourAncienne_() {
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
    if (/insufficient|ACCESS_TOKEN_SCOPE|scope/i.test(t)) throw new Error('Le script n\'a pas encore le droit de se modifier lui-même : dans l\'éditeur Apps Script, Paramètres du projet → cochez « Afficher le fichier manifeste appsscript.json », remplacez son contenu par celui du dépôt GitHub (apps-script/appsscript.json), enregistrez, puis menu Festival → « Activer la mise à jour automatique » pour redonner l\'autorisation.');
    if (/has not been used|is disabled|PERMISSION_DENIED/.test(t)) throw new Error('L\'API Apps Script n\'est pas activée pour ce compte Google (ou vient de l\'être : patientez 2 minutes) : ouvrez script.google.com/home/usersettings et activez « API Google Apps Script ». Détail : ' + t.slice(0, 200));
    throw new Error('API Apps Script : ' + r.getResponseCode() + ' ' + t.slice(0, 300));
  }
  return JSON.parse(r.getContentText() || '{}');
}
