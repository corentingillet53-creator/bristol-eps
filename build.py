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
<meta name="description" content="Réviser les écrits du CAPEPS et de l'agrégation d'EPS : fiches, annales, entraînement avec retour de Claude.">
<meta name="theme-color" content="#f3f5f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1412" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-title" content="Bristol EPS">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>
:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
img{max-width:100%}
[hidden]{display:none!important}
</style>
</head>
<body>
"""
# L'application est servie sous /app/ ; la racine présente le site (source/landing.html).
out = here / "public" / "app" / "index.html"
out.parent.mkdir(parents=True, exist_ok=True)
import datetime, re as _re
_MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"]
_d = datetime.date.today()
_maj = f"{_d.day}{'er' if _d.day == 1 else ''} {_MOIS[_d.month - 1]} {_d.year}"
page_app = _re.sub(r'const SITE_MAJ = "[^"]*";', f'const SITE_MAJ = "{_maj}";', page, count=1)
out.write_text(head + page_app + "\n</body>\n</html>\n", encoding="utf-8")
print("Écrit :", out, f"({out.stat().st_size // 1024} Ko)")

# Page de présentation : chiffres et fiches d'essai tirés de la source, pour rester à jour.
import json, re
def block(name, opener="["):
    i = page.index(f"const {name} = {opener}")
    j = page.index("\n];" if opener == "[" else "\n};", i)
    return page[i:j]
base = block("BASE")
cards = re.findall(r'\{id:"([^"]+)",th:"(\w+)",p:"([^"]*)",q:"((?:[^"\\]|\\.)*)",a:"((?:[^"\\]|\\.)*)"', base)
GROUP = {}
for gid, ths in re.findall(r'\{ id: "(e1|e2|tx)", t: "[^"]+", s: "[^"]+", th: \[([^\]]+)\]', page):
    for th in re.findall(r'"?(\w+)"?', ths): GROUP[th] = gid
ti = page.index("const THEMES = {")
themes = dict(re.findall(r'\b([A-Z]{1,2}):\s*"([^"]+)"', page[ti:page.index("};", ti)]))
count = {g: sum(1 for c in cards if GROUP.get(c[1]) == g) for g in ("e1", "e2", "tx")}
ann = re.findall(r'"id": "an\d+",[^}]*?"y": (\d{4})', block("ANNALES"), re.S)
years = [int(y) for y in ann]
subj = len(re.findall(r'\{\s*id:\s*"s\d+"', page)) + len(re.findall(r'\{id:"t\d+",epr', page)) + len(re.findall(r'\{id:"[qm]\d+",epr', page))
demo_ids = ["n02", "am02", "b05", "ex06", "b03", "am01"]
EPR_S = {"e1": "Écrit 1", "e2": "Écrit 2", "tx": "Textes officiels"}
unesc = lambda t: json.loads('"' + t + '"')
demo = [{"q": unesc(c[3]), "a": unesc(c[4]), "p": c[2], "th": themes.get(c[1], c[1]), "e": EPR_S.get(GROUP.get(c[1]), "")} for i in demo_ids for c in cards if c[0] == i]
conc = []
for cid, t, tag in re.findall(r'\{ id: "((?:capeps|agreg)-[a-z0-9]+)", t: "([^"]+)", tag: "([^"]+)"', page):
    seg = page[page.index(f'{{ id: "{cid}"'):][:2000]
    ec = re.search(r'ecrits: "([^"]+)", d: "(\d{4}-\d{2}-\d{2})"', seg)
    if ec: conc.append({"t": t, "tag": tag, "ecrits": ec.group(1), "d": ec.group(2)})
vals = {"CARDS": len(cards), "E1": count["e1"], "E2": count["e2"], "TX": count["tx"],
        "REFS": len(re.findall(r'\{id:"r\d+",g:"', page)), "ANN": len(years), "ANN_MIN": min(years), "ANN_MAX": max(years),
        "SUBJ": subj, "FILS": len(re.findall(r'\{id:"f\d+",t:"', page)),
        "DEMO_JSON": json.dumps(demo, ensure_ascii=False), "CONC_JSON": json.dumps(conc, ensure_ascii=False)}
land = (here / "source" / "landing.html").read_text(encoding="utf-8")
for k, v in vals.items(): land = land.replace("{{" + k + "}}", str(v))
assert "{{" not in land, re.findall(r"\{\{\w+\}\}", land)
lout = here / "public" / "index.html"
lout.write_text(land, encoding="utf-8")
print("Écrit :", lout, {k: v for k, v in vals.items() if not k.endswith("JSON")}, f"{len(demo)} fiches d'essai, {len(conc)} concours")
