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
<meta name="theme-color" content="#e7e3da" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16110e" media="(prefers-color-scheme: dark)">
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
# Polices : la page source charge Google Fonts (pour l'artifact Claude) ; le site publié les sert lui-même.
FONTS = ('<link rel="preload" href="/fonts/albert-sans.woff2" as="font" type="font/woff2" crossorigin>\n'
         '<link rel="preload" href="/fonts/imbue-400.woff2" as="font" type="font/woff2" crossorigin>\n'
         '<link rel="stylesheet" href="/fonts/fonts.css">')
def self_host_fonts(html):
    html = _re.sub(r'<link rel="preconnect" href="https://fonts\.(googleapis|gstatic)\.com"[^>]*>\n?', '', html)
    html, n = _re.subn(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]*">', FONTS, html, count=1)
    assert n == 1, "lien Google Fonts introuvable"
    return html
page_app = self_host_fonts(page_app)
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
demo_ids = ["n02", "n221", "n53", "am02", "am01", "ex06", "po05", "po32", "po27"]
EPR_S = {"e1": "Écrit 1", "e2": "Écrit 2", "tx": "Textes officiels"}
unesc = lambda t: json.loads('"' + t + '"')
demo = [{"q": unesc(c[3]), "a": unesc(c[4]), "p": c[2], "th": themes.get(c[1], c[1]), "e": EPR_S.get(GROUP.get(c[1]), ""), "g": GROUP.get(c[1], "")} for i in demo_ids for c in cards if c[0] == i]
conc = []
for cid, t, tag in re.findall(r'\{ id: "((?:capeps|agreg)-[a-z0-9]+)", t: "([^"]+)", tag: "([^"]+)"', page):
    seg = page[page.index(f'{{ id: "{cid}"'):][:2000]
    ec = re.search(r'ecrits: "([^"]+)", d: "(\d{4}-\d{2}-\d{2})"', seg)
    # Apostrophes typographiques, comme le reste de la page de présentation.
    if ec: conc.append({"id": cid, "t": t.replace("'", "’"), "tag": tag, "ecrits": ec.group(1).replace("'", "’"), "d": ec.group(2)})
vals = {"CARDS": len(cards), "E1": count["e1"], "E2": count["e2"], "TX": count["tx"],
        "REFS": len(re.findall(r'\{id:"r\d+",g:"', page)), "ANN": len(years), "ANN_MIN": min(years), "ANN_MAX": max(years),
        "SUBJ": subj, "FILS": len(re.findall(r'\{id:"f\d+",t:"', page)),
        "DEMO_JSON": json.dumps(demo, ensure_ascii=False), "CONC_JSON": json.dumps(conc, ensure_ascii=False)}
land = self_host_fonts((here / "source" / "landing.html").read_text(encoding="utf-8"))
for k, v in vals.items(): land = land.replace("{{" + k + "}}", str(v))
assert "{{" not in land, re.findall(r"\{\{\w+\}\}", land)
lout = here / "public" / "index.html"
lout.write_text(land, encoding="utf-8")
print("Écrit :", lout, {k: v for k, v in vals.items() if not k.endswith("JSON")}, f"{len(demo)} fiches d'essai, {len(conc)} concours")

# Pages légales : source/legal/*.html (titre, description, corps), champs de l'éditeur dans
# source/legal/editeur.json. Une page statique par fichier, sans script, servie à /<nom>/.
LEGAL_HEAD = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
{meta}
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
:root{--bg:#e5e1d8;--paper:#f3f3f0;--ink:#2a1d17;--muted:#66574d;--accent:#456f3a;--accent-text:#3b6131;--line:#d3cdc1;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#16110e;--paper:#2a211c;--ink:#efe8de;--muted:#b9ab9f;--accent:#93bf81;--accent-text:#a8d095;--line:#3a302a;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 1.0625rem/1.6 "Albert Sans",system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent-text)}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.skip{position:absolute;left:12px;top:-60px;background:#2a1d17;color:#fff;padding:10px 16px;border-radius:10px;font-weight:700;text-decoration:none}
.skip:focus{top:12px}
header{max-width:760px;margin:0 auto;padding:24px 16px 0}
header a{font-family:"Imbue",Georgia,serif;font-size:1.6rem;color:var(--ink);text-decoration:none}
main{max-width:760px;margin:16px auto 48px;padding:32px clamp(16px,4vw,40px);background:var(--paper);border-top:6px solid var(--accent);border-radius:4px}
h1,h2{font-family:"Imbue",Georgia,serif;font-weight:400;letter-spacing:-.01em;line-height:1.05}
h1{font-size:clamp(2.25rem,1.6rem + 2.5vw,3.25rem);margin:0 0 8px}
h2{font-size:1.6rem;margin:32px 0 8px}
.lead{color:var(--muted)}
ul{padding-left:1.2em}
li+li{margin-top:6px}
</style>
</head>
<body>
<a class="skip" href="#contenu">Aller au contenu</a>
<header><a href="/">Bristol EPS</a></header>
<main id="contenu" tabindex="-1">
"""
_ed = json.loads((here / "source" / "legal" / "editeur.json").read_text(encoding="utf-8"))
_todo = sorted(k for k, v in _ed.items() if not k.startswith("_") and "[à compléter" in str(v))
for _f in sorted((here / "source" / "legal").glob("*.html")):
    _src = _f.read_text(encoding="utf-8")
    for k, v in _ed.items():
        if not k.startswith("_"): _src = _src.replace("{{" + k + "}}", v)
    assert "{{" not in _src, (_f.name, re.findall(r"\{\{\w+\}\}", _src))
    _meta = "\n".join(re.findall(r"^<(?:title|meta)\b.*$", _src, re.M))
    _body = re.sub(r"^<(?:title|meta)\b.*\n", "", _src, flags=re.M)
    _o = here / "public" / _f.stem / "index.html"
    _o.parent.mkdir(parents=True, exist_ok=True)
    _o.write_text(LEGAL_HEAD.replace("{meta}", _meta) + _body + "</main>\n</body>\n</html>\n", encoding="utf-8")
print("Pages légales :", ", ".join("/" + f.stem + "/" for f in sorted((here / "source" / "legal").glob("*.html"))),
      ("; champs à compléter dans source/legal/editeur.json : " + ", ".join(_todo)) if _todo else "")

# En-têtes de sécurité (public/_headers). La politique de contenu (CSP) n'autorise que les
# scripts du site : les deux pages ont des scripts en ligne, autorisés par leur empreinte
# sha256, recalculée à chaque construction. Une seule règle « /* » : Cloudflare fusionne les
# en-têtes de règles qui se recouvrent, et deux CSP fusionnées bloqueraient la page.
import base64, hashlib
def _script_hashes(html):
    out = []
    for attrs, body in re.findall(r"<script\b([^>]*)>(.*?)</script>", html, re.S):
        if "src=" in attrs or re.search(r'type="(?!text/javascript|module)', attrs): continue
        out.append("'sha256-" + base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode() + "'")
    return out
_app_html = out.read_text(encoding="utf-8")
hashes = sorted(set(_script_hashes(_app_html) + _script_hashes(land)))
csp = "; ".join([
    "default-src 'self'",
    "script-src 'self' " + " ".join(hashes),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
])
headers = f"""# Fichier écrit par build.py : ne pas modifier à la main.
/*
  Content-Security-Policy: {csp}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()

/sw.js
  Cache-Control: no-cache
  Service-Worker-Allowed: /

/manifest.webmanifest
  Content-Type: application/manifest+json
  Cache-Control: public, max-age=3600
"""
(here / "public" / "_headers").write_text(headers, encoding="utf-8")
print("Écrit : public/_headers", f"({len(hashes)} scripts en ligne autorisés)")
