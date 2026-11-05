# -*- coding: utf-8 -*-
"""Réunit l'application en un seul fichier à coller dans Apps Script : a-coller.gs

    python3 assembler.py

Code.js + Reservations.js + l'écran Admin.html (mis dans la variable ADMIN_HTML).
Pas besoin de appsscript.json : Google trouve tout seul les autorisations nécessaires.
"""
import json, os

ICI = os.path.dirname(os.path.abspath(__file__))


def lire(nom):
    return open(os.path.join(ICI, nom), encoding="utf-8").read()


morceaux = [
    "// Réservations du festival — fichier unique à coller dans Apps Script.\n"
    "// Fabriqué par assembler.py depuis Code.js, Reservations.js et Admin.html (dépôt GitHub festival-reservations) :\n"
    "// pour changer le code, modifier ces fichiers-là puis relancer l'assemblage.\n",
    lire("Code.js"),
    lire("Reservations.js"),
    "var ADMIN_HTML = " + json.dumps(lire("Admin.html"), ensure_ascii=False) + ";\n",
]
open(os.path.join(ICI, "a-coller.gs"), "w", encoding="utf-8").write("\n".join(morceaux))
print("a-coller.gs :", sum(len(m) for m in morceaux), "caractères")

# gestion.html : le même écran, hébergé sur GitHub Pages (pas de bandeau Google), qui parle au script par POST.
import re
index = open(os.path.join(ICI, "..", "index.html"), encoding="utf-8").read()
exec_defaut = re.search(r'var EXEC_DEFAUT = "([^"]*)"', index).group(1)
g = lire("Admin.html")
g = g.replace('<base target="_top">\n<meta charset="utf-8">',
    '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="robots" content="noindex">\n<title>Réservations</title>\n<link rel="manifest" href="manifest.webmanifest">\n'
    '<meta name="theme-color" content="#0b0a10">\n<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n<link rel="apple-touch-icon" href="icone_180.png">\n<link rel="icon" href="icone_192.png">')
g = g.replace("var CLE = <?!= JSON.stringify(cle) ?>;",
    'var EXEC = ' + json.dumps(exec_defaut) + ';\n'
    'var CLE = (function () { var q = new URLSearchParams(location.search), c = q.get("cle");\n'
    '  try { if (c && /^[A-Za-z0-9]{16,64}$/.test(c)) localStorage.setItem("festival_resa_cle", c); return localStorage.getItem("festival_resa_cle") || ""; } catch (e) { return c || ""; } })();\n'
    'if (!CLE) location.replace("./");')
debut = g.index("function appel(fn, args, ok) {")
fin = g.index("function recharger(res)")
g = g[:debut] + """function appel(fn, args, ok) {
  $('#charge').style.display = 'block';
  fetch(EXEC, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ api: 'admin', cle: CLE, fn: fn, args: args || [] }) })
    .then(function (r) { return r.json(); })
    .then(function (r) { $('#charge').style.display = 'none'; if (r.ok) ok(r.resultat); else toast(r.erreur || 'Erreur', true); })
    .catch(function () { $('#charge').style.display = 'none'; toast('Problème de connexion. Réessayez dans un instant.', true); });
}
""" + g[fin:]
open(os.path.join(ICI, "..", "gestion.html"), "w", encoding="utf-8").write(g)
print("gestion.html :", len(g), "caractères")
