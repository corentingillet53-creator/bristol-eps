"""Fabrique public/index.html à partir de la page source (bristol-eps.html).

La page source est écrite pour une page publiée sur Claude : elle n'a pas
d'en-tête <html>/<head>. Ce script l'enveloppe dans un document complet,
avec le petit jeu de styles de base que Claude ajoute automatiquement.
"""
import pathlib, sys

here = pathlib.Path(__file__).resolve().parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here / "source" / "bristol-eps.html"
page = src.read_text(encoding="utf-8")

head = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="description" content="Révision de l'histoire de l'EPS pour l'écrit 1 du CAPEPS et de l'agrégation interne.">
<style>
:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
img{max-width:100%}
[hidden]{display:none!important}
</style>
</head>
<body>
"""
out = here / "public" / "index.html"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(head + page + "\n</body>\n</html>\n", encoding="utf-8")
print("Écrit :", out, f"({out.stat().st_size // 1024} Ko)")
