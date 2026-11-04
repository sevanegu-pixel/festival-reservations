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
