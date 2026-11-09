#!/bin/bash
# Mise en ligne du script Google du festival (Apps Script) avec clasp, depuis le Mac.
# Usage :  bash outils/deployer.sh                 → assemble, pousse le code et met à jour le déploiement de l'appli web
#          bash outils/deployer.sh connexion       → (une fois) connexion clasp au compte Google du festival
#          bash outils/deployer.sh verifier        → assemble et vérifie, sans rien envoyer
# La connexion est gardée dans ~/.clasprc-festival.json : elle ne touche jamais la connexion clasp des applis Origami.
# Il faut avoir activé l'API Apps Script une fois : https://script.google.com/home/usersettings (compte du festival).
set -euo pipefail
cd "$(dirname "$0")/.."
AUTH="$HOME/.clasprc-festival.json"
DEPLOIEMENT="AKfycbwWdo5fOb68E1Civ7ToZe5EDYxvq_9GDl97nmEwv7aPYHtQn-vSN_uhZgsjmjZIrLph"   # déploiement de l'appli web (l'adresse /exec ne change pas)
ENVOI="apps-script/envoi"                                                              # dossier poussé : un seul fichier de code + le manifeste
CLASP() { npx --yes @google/clasp@2.4.2 --auth "$AUTH" "$@"; }

if [ "${1:-}" = "connexion" ]; then
  echo "→ Une page Google va s'ouvrir : choisissez le compte du festival (pas celui de la compagnie)."
  CLASP login --no-localhost
  exit 0
fi
[ -f "$AUTH" ] || { echo "Pas encore connecté au compte du festival : lancez  bash outils/deployer.sh connexion"; exit 1; }

echo "→ Assemblage (a-coller.gs + gestion.html)"
python3 apps-script/assembler.py
node -e "new Function(require('fs').readFileSync('apps-script/a-coller.gs','utf8'))" && echo "   syntaxe du script : ok"
VERSION=$(grep -o "var VERSION_CODE = '[0-9a-f]*'" apps-script/a-coller.gs | grep -o "[0-9a-f]\{6,\}")
[ "${1:-}" = "verifier" ] && { echo "Version $VERSION prête (rien envoyé)."; exit 0; }

# Identifiant du script : gardé dans outils/script-id.txt (à remplir une fois ; il est dans l'adresse de l'éditeur Apps Script : /projects/<ID>/edit)
ID_FICHIER="outils/script-id.txt"
if [ ! -s "$ID_FICHIER" ]; then
  echo "→ Recherche du script dans le compte connecté…"
  CLASP list 2>/dev/null | grep -i -E "festival|réserv|reserv" | head -5 || true
  echo "Collez l'identifiant du script (la partie après /projects/ dans l'adresse de l'éditeur) dans $ID_FICHIER puis relancez."
  exit 1
fi
SCRIPT_ID=$(tr -d ' \n\r' < "$ID_FICHIER")

rm -rf "$ENVOI"; mkdir -p "$ENVOI"
cp apps-script/a-coller.gs "$ENVOI/Code.js"
cp apps-script/appsscript.json "$ENVOI/appsscript.json"
printf '{"scriptId":"%s","rootDir":"%s"}\n' "$SCRIPT_ID" "$ENVOI" > .clasp.json
echo "→ Envoi du code (version $VERSION)"
CLASP push --force
echo "→ Nouvelle version du déploiement de l'appli web"
CLASP deploy -i "$DEPLOIEMENT" -d "Version $VERSION ($(date '+%d.%m.%Y %H:%M'))"
rm -f .clasp.json; rm -rf "$ENVOI"
echo "✓ Script en ligne (version $VERSION). Pensez à pousser gestion.html sur GitHub (branche main) si l'écran a changé."
