# Bristol EPS — consignes pour Claude

Site de révision payant pour les écrits du CAPEPS et de l'agrégation d'EPS, porté par Corentin (prof d'EPS).
- En ligne : https://bristol-eps.corentin-gillet53.workers.dev (Worker Cloudflare, déployé à chaque push sur `main`).
- Artifact claude.ai : https://claude.ai/artifact/MaC25hdMYQJomfsMBEv9be, publié depuis `source/bristol-eps.html`.
- Dépôt : `corentingillet53-creator/bristol-eps`.

## Règles
- Réponses en français, brèves et directes. S'arrêter dès que Corentin interrompt.
- Secrets uniquement dans Cloudflare (Variables and Secrets), jamais dans le dépôt ni dans la conversation. Ne jamais demander de coller une clé.
- Aucun paiement réel avant l'autorisation de cumul du rectorat, un Siret et les pages légales (CGV, mentions).
- Contenu (fiches, références, dates) : vérifié et croisé sur deux sources avant ajout ; une référence invérifiable est retirée. Crossref (`api.crossref.org/works/DOI`, `?query.title=`) et Semantic Scholar (une requête à la fois) fonctionnent depuis le conteneur ; PubMed, HAL, openedition sont bloqués.
- Toujours tester avant de committer. Commits terminés par :
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <lien de la session en cours>
  ```
- Après un changement de `source/bristol-eps.html` : build, tests, commit, push, puis republier l'artifact.

## Carte du dépôt
| Fichier | Rôle |
|---|---|
| `source/bristol-eps.html` (~8 300 lignes) | Toute l'application : HTML, CSS, données (cartes, annales, sujets), JS. Sans `<html>/<head>` (format artifact). |
| `source/landing.html` | Page de présentation servie à `/`. |
| `build.py` | Écrit `public/app/index.html` et `public/index.html`, met `SITE_MAJ` à la date du jour, régénère `public/_headers` (CSP par empreintes sha256 des scripts en ligne). Écrit aussi `robots.txt`, `sitemap.xml` et `llms.txt` ; `SITE_URL` (adresse publique) et `INDEXER` (False = noindex jusqu'au lancement, à passer à True seulement avec l'accord de Corentin) sont en tête du fichier. Ne jamais éditer `public/app/index.html` à la main. |
| `worker.js` | Routeur du Worker vers `functions/api/*`. |
| `functions/api/feedback.js` | Appel à Claude (retours d'écriture, correction de copie), quota KV, cache. Les prompts y sont dupliqués depuis la page : garder les deux identiques (`promptB3`, le bloc `FB_FMTS`/`FB_WHO`/`FB_SPEC`/`promptFb`, `COPIE_EPR`/`COPIE_MID` et la copie, `bilanTail`). `tests/prompts.mjs` vérifie l'égalité. |
| `functions/api/event.js` | Mesure d'audience anonyme (table `stats`, étapes envoyées par `track()` dans la page ou comptées par le serveur via `recordEvent`), résultats et témoignages après les écrits (table `results`), tableau `/api/stats?t=<ADMIN_TOKEN>`. |
| `functions/api/usage.js` | Compteurs atomiques D1 (table `usage`) : usage raisonnable, essais gratuits, codes. |
| `functions/api/credits.js` | Crédits de retours : `MONTHLY_CREDITS` par mois (60), puis recharge Stripe (`TOPUP_CREDITS`, 50) ; 1 crédit par retour, 3 par copie tapée, 4 en photos. Solde : `GET /api/billing/credits` et en-tête `x-credits` (mois/recharge/coût). |
| `functions/api/account.js`, `billing.js`, `plan.js`, `push.js`, `report.js` | Comptes (Google), Stripe, offre, notifications, signalements. |
| `migrations/` | Schéma D1 (`bristol-db`). |
| `wrangler.jsonc` | Config Worker (KV `QUOTA`, D1 `DB`, cron). |
| `tests/` | Tests locaux (non déployés), voir plus bas. |

## Repères dans `source/bristol-eps.html`
Chercher par nom avec Grep plutôt que lire le fichier.
- État : `prefs` (concours, examDate…), `progress` (FSRS), `texts` via `txGet`/`txSet` (= `noteGet`/`noteSet`), `ach`, `log`. Préfixes de `texts` : `i:`/`p:`/(rien) + id = intro / paragraphe / plan ; `f:` = retour de Claude enregistré ; `c:` = grille cochée ; `b:` = copie de concours blanc ; `bm:` = métadonnées du blanc ; `d:` = dossier du sujet relevé par le candidat. Au CAPEPS interne, `inConc` ne garde de l'écrit 2 que le thème `IN`.
- Concours : `CONCOURS`, `CPROF`, `sjPools(e)`, `relHas`/`relGroups`/`REL_GRP`, `relCards`, `isB3Conc`, `planEcrits`, `methFor`. Ids : `capeps-l3` (format B3), `capeps-m2`, `capeps-int` (étude de cas, écrit unique `ei`→e2), `capeps-3`, `agreg-ext`, `agreg-int`.
- Écriture : `askFeedback(kind)` (plan/intro/para), `askCopie(m)`, `promptCopie`, `promptB3`, `promptFb` (format selon `fbFmt()` : `cint`, `aint`, `aext` ou CAPEPS externe), `fbCtx` (dossier du sujet saisi par le candidat, clé `d:` + id), `annJury`/`concJury` (notes du jury envoyées à Claude), `mdLite` (affichage, masque la ligne `BILAN:`). Grilles : `gridKey(sujet, kind)` choisit la grille (affichage et suivi), `gridCrit`, `SK_GRID`.
- Niveau de préparation : `readiness(list)` (connaissances), compétences d'écriture `SK_*`, `skMeasures`, `skStats`, `writeReadiness`, `readyAll`, `skWeak`, `skTrain`, `writingHTML`, `readinessHTML`.
- Écrans : `render()`, `setView(v)`, `renderHome`/`homeTrain`/`homeTrain0`, `renderStats` (Progrès), `planWeeks`/`wTask`, concours blanc `blanc*`, sélecteur de concours `ccOpen`, routes `routePush`/`routeFromHash`, actions dans le gestionnaire `data-act`.
- Crédits : `bill.credits`, `credLoad`, `credLine`/`credPaint`, panneau `renderRecharge` (`paywall("recharge")`).
- Accès : `isPremium()`, `STANDALONE` (vrai sur le site, faux dans l'artifact où `window.claude` fait les appels).

## Modifier sans tout relire
- Remplacements par script Python avec `assert s.count(ancre) == 1` : beaucoup de fragments se répètent.
- Le CSS est dans le même fichier ; garder les variables (`--line`, `--paper`, `--muted`, `--r-m`…) et le thème sombre.
- Un nouveau script en ligne change la CSP : relancer `build.py`.

## Build et tests
```bash
python3 build.py
cd tests && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i   # une fois par session
node server.js &        # sert public/ avec les en-têtes de _headers, port 8766 (relancer après chaque build)
node smoke.js           # parcours des 6 concours → « ALL OK »
node skills.js capeps-l3   # volet Écriture (jsdom), un concours en argument → « errors [] »
node axe.js             # accessibilité : aucune sortie = aucune violation (lent)
node csp.js             # seule violation attendue : le script injecté exprès
node --no-warnings trial.mjs   # serveur : retour offert (D1 simulée par node:sqlite, tests/d1mock.mjs)
node --no-warnings usage.mjs   # serveur : crédits, recharge, codes, paiement, suppression de compte
node credits.js         # page : solde, refus faute de crédits, panneau de recharge (API simulée)
node --no-warnings event.mjs   # serveur : mesure anonyme, tableau /api/stats, résultats déclarés
node prompts.mjs        # prompts identiques page/serveur pour chaque concours → « ALL OK »
```
Chromium est dans `/opt/pw-browsers` ; ne pas lancer `playwright install`.

## En attente côté Corentin
Épreuves du 3e concours à vérifier ; sujets d'entraînement au format de l'interne et des agrégations (citation + dossier) ; pages légales / CGV ; rotation du secret Google ; signalements non notifiés (réponses manuelles).
