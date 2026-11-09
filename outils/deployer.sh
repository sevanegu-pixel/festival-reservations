#!/bin/zsh
# Mise en ligne du script Google du festival (Apps Script) avec clasp, depuis le Mac (session Remote Control).
#   bash outils/deployer.sh              → assemble, pousse le code, nouvelle version du déploiement de l'appli web
#   bash outils/deployer.sh connexion    → (une fois) connexion clasp au compte Google du festival : Sévane choisit le compte dans la page Google
#   bash outils/deployer.sh verifier     → assemble et vérifie, sans rien envoyer
# La connexion clasp du festival est gardée sous le nom d'utilisateur « festival » : celle des applis Origami (par défaut) n'est jamais touchée.
# Une fois pour toutes, avec le compte du festival : activer l'API Apps Script sur https://script.google.com/home/usersettings
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/Desktop/Claude outputs/compta/outils/env.sh" ] && source "$HOME/Desktop/Claude outputs/compta/outils/env.sh"   # Node + clasp portables
command -v clasp >/dev/null || { echo "clasp introuvable (ni dans le PATH, ni dans compta/outils/node/bin)"; exit 1; }
DEPLOIEMENT="AKfycbwWdo5fOb68E1Civ7ToZe5EDYxvq_9GDl97nmEwv7aPYHtQn-vSN_uhZgsjmjZIrLph"   # déploiement de l'appli web : l'adresse /exec ne change pas
ENVOI="apps-script/envoi"                                                              # dossier poussé : un seul fichier de code + le manifeste
ID_FICHIER="outils/script-id.txt"                                                      # identifiant du script (adresse de l'éditeur : /projects/<ID>/edit)
LOG="outils/deploy.log"
C() { clasp --user festival "$@"; }

if [ "${1:-}" = "connexion" ]; then
  echo "→ Une page Google s'ouvre : choisir le compte du festival (pas celui de la compagnie)."
  C login --no-localhost
  echo "→ Scripts visibles avec ce compte :"; C list-scripts 2>/dev/null || C list 2>/dev/null || true
  exit 0
fi

echo "→ Assemblage (a-coller.gs + gestion.html)"
python3 apps-script/assembler.py
node -e "new Function(require('fs').readFileSync('apps-script/a-coller.gs','utf8'))" && echo "   syntaxe du script : ok"
VERSION=$(grep -o "var VERSION_CODE = '[0-9a-f]*'" apps-script/a-coller.gs | grep -o "[0-9a-f]\{6,\}")
[ "${1:-}" = "verifier" ] && { echo "Version $VERSION prête (rien envoyé)."; exit 0; }
[ -s "$ID_FICHIER" ] || { echo "Il manque l'identifiant du script dans $ID_FICHIER (lancer d'abord : bash outils/deployer.sh connexion, qui liste les scripts)."; exit 1; }
SCRIPT_ID=$(tr -d ' \n\r' < "$ID_FICHIER")

rm -rf "$ENVOI"; mkdir -p "$ENVOI"
cp apps-script/a-coller.gs "$ENVOI/Code.js"
cp apps-script/appsscript.json "$ENVOI/appsscript.json"
printf '{"scriptId":"%s","rootDir":"%s"}\n' "$SCRIPT_ID" "$ENVOI" > "$ENVOI/.clasp.json"
: > "$LOG"
cd "$ENVOI"
echo "→ Envoi du code (version $VERSION)"
C push -f | tee -a "../../$LOG"
echo "→ Nouvelle version du déploiement de l'appli web"
C create-deployment -i "$DEPLOIEMENT" -d "Version $VERSION ($(date '+%d.%m.%Y %H:%M'))" | tee -a "../../$LOG"
C list-deployments >> "../../$LOG" 2>&1 || true
cd ../..; rm -rf "$ENVOI"
echo "✓ Script en ligne (version $VERSION). Ensuite : pousser gestion.html sur GitHub (branche main) si l'écran a changé."
