# Bristol EPS — mettre le site en ligne

Ce dépôt contient le site complet, déployé comme **Worker Cloudflare** (offre gratuite) :

- Abonnement (Stripe) : `functions/api/billing.js` et `plan.js`, table `subscriptions` (créée au premier usage). Version découverte : un écrit, 5 nouvelles fiches par jour ; accès complet : pass session (paiement unique jusqu'à `PASS_UNTIL`) ou abonnement mensuel. Réglages Cloudflare : secrets `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET`, variables `STRIPE_PRICE_PASS` et `STRIPE_PRICE_MONTHLY` (identifiants `price_…`), facultatives `PRICE_PASS_LABEL`, `PRICE_MONTHLY_LABEL`, `PASS_UNTIL`. Webhook Stripe : `https://<site>/api/billing/webhook`, événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `charge.refunded`, `charge.dispute.created` (un remboursement total ou une contestation coupent l'accès). Dans le portail client Stripe, régler la résiliation sur « à la fin de la période ». Le paiement exige la case de renonciation au droit de rétractation (CGV, article 5), tracée dans les métadonnées Stripe. Les codes de `ACCESS_CODES` donnent l'accès complet (« J'ai un code d'accès »). Le retour de Claude est autorisé pour un compte abonné, ou avec un ancien code bêta.
- Signalements d'erreurs sur les fiches : `functions/api/report.js`, table `reports` (créée au premier signalement), 10 par heure et par adresse. Pour les lire : Cloudflare → D1 → `bristol-db` → Console, `SELECT datetime(created_at/1000,'unixepoch'), card, kind, msg, q FROM reports ORDER BY created_at DESC;`
- Rappels quotidiens par notification (Progrès › Rappels, compte requis) : `functions/api/push.js` (Web Push chiffré, clés VAPID créées et gardées dans D1, table `push_subs`) ; le cron du Worker (`triggers` dans `wrangler.jsonc`, toutes les 15 minutes) envoie le rappel une fois par jour à l'heure choisie (heure de Paris), seulement si la personne n'a pas encore révisé ; le dimanche, le bilan de la semaine.
- Répétition espacée : algorithme FSRS-5 (stabilité et difficulté par carte), boîtes 1 à 5 affichées comme paliers de stabilité.
- CAPEPS externe bac+3 : sujets au format 2026 (écrit 1 thématique + questions, écrit 2 notion + quatre épisodes), méthode et encadré « Ce que le jury attend » tirés du rapport 2026 (pages citées). Retours de Claude : `fmt: "b3"` sur `/api/feedback`, prompt `promptB3` identique dans la page et sur le serveur.
- Concours blanc (onglet Écrire) : copie stockée avec les textes rédigés ; sa correction par Claude (`kind: "copie"` sur `/api/feedback`) compte pour deux retours dans le quota mensuel.
- `public/` : le site (fiches, fils rouges, entraînements, suivi), servi tel quel ;
  `public/manifest.webmanifest`, `public/sw.js` et `public/icons/` rendent le site installable et utilisable hors ligne (la page et les polices sont mises en cache, jamais `/api/*`) ;
- `functions/api/feedback.js` : la fonction serveur qui appelle Claude avec **ta** clé d'API, après avoir vérifié le code d'accès et le quota ;
- `worker.js` et `wrangler.jsonc` : le point d'entrée et la configuration du Worker ;
- `source/bristol-eps.html` et `build.py` : la source de l'application et le script qui fabrique `public/app/index.html` (servie sous `/app/`) ;
- `source/landing.html` : la page de présentation servie à la racine (`public/index.html`), complétée par `build.py` avec les chiffres et les fiches d'essai tirés de la source ; les captures sont dans `public/img/`. Un visiteur qui a déjà utilisé l'application sur l'appareil est renvoyé vers `/app/` (`/?accueil` pour voir la présentation).

Sur ce site, le retour de Claude ne touche plus à tes limites personnelles : il est facturé à l'usage sur ton compte API, environ 1 centime par retour avec Claude Sonnet 5.5.

Adresse : https://eps-bristol.fr (l'ancienne adresse https://bristol-eps.corentin-gillet53.workers.dev redirige vers le domaine)

---

## 1. Créer ta clé d'API Claude

1. Va sur la console Anthropic (platform.claude.com) et crée un compte.
2. Dans la facturation, ajoute un petit crédit (5 € suffisent largement pour la bêta).
3. Dans les limites du compte, **fixe un plafond de dépenses mensuel** (par exemple 10 €). C'est ta protection en cas d'abus.
4. Crée une clé d'API et copie-la. Garde-la secrète : ne l'envoie à personne, ne la colle dans aucune conversation, ne la mets jamais dans un fichier du dépôt. Elle ira uniquement dans les réglages de Cloudflare (étape 2).

## 2. Brancher Claude et les codes d'accès

Dans Cloudflare : **Workers & Pages → bristol-eps → Settings → Variables and Secrets → Add**. Ajoute :

| Nom | Valeur | Type |
|---|---|---|
| `ANTHROPIC_API_KEY` | ta clé d'API | **Secret** |
| `ACCESS_CODES` | tes codes bêta séparés par des virgules, par exemple `EPS-ALICE-7Q2,EPS-BRUNO-K9F` | **Secret** |
| `BUDGET_CENTS` | coût réel maximal par abonné et par mois, en centimes (usage raisonnable invisible) | Texte (facultatif, 200 par défaut) |
| `DAILY_SHORT` / `DAILY_COPIES` | retours courts et corrections de copie par jour et par abonné | Texte (facultatif, 25 et 3) |
| `MIN_INTERVAL_S` | délai minimal entre deux demandes d'un même abonné, en secondes | Texte (facultatif, 60) |
| `GLOBAL_DAILY_CENTS` | coupe-circuit : dépense totale maximale par jour, en centimes | Texte (facultatif, 1000) |
| `PRICE_IN` / `PRICE_OUT` | prix du modèle en dollars par million de jetons, pour le calcul du coût | Texte (facultatif, 2 et 10) |
| `TRIAL_PER_IP` | essais gratuits de retour par connexion internet et par jour | Texte (facultatif, 3) |
| `CODE_MAX_USES` | nombre maximal de comptes par code d'accès | Texte (facultatif, 30) |
| `ADMIN_TOKEN` | jeton (16 caractères au moins) pour lire le diagnostic de `/api/feedback` et le parcours des candidats (`/api/stats`) | **Secret** (facultatif) |
| `ANTHROPIC_WORKSPACE_ID` | ID de l'espace de travail de la console, **seulement** si ta clé n'est rattachée à aucun espace de travail | Texte (facultatif) |

Mets bien les deux premières en **Secret** : elles restent ainsi cachées et ne sont jamais effacées par un nouveau déploiement.

Donne un code différent à chaque testeur : tu pourras en retirer un sans gêner les autres. Choisis des codes difficiles à deviner.

## 3. Quota mensuel

Déjà en place : la table D1 `usage` tient l'usage raisonnable (coût réel par abonné et par mois, plafonds journaliers, délai entre deux demandes, coupe-circuit, essais gratuits, codes). Chaque demande réserve d'abord son coût maximal en une seule requête atomique, puis le coût réel est compté même si le visiteur ferme la page. Les clés échues sont effacées chaque nuit. L'espace KV `bristol-quota` garde 30 jours les retours déjà produits : un texte identique renvoyé sur le même sujet ne déclenche pas de nouvel appel. Il est déclaré dans `wrangler.jsonc` (une liaison ajoutée seulement dans le tableau de bord serait effacée au déploiement suivant).

## 4. Vérifier

1. Chaque envoi sur GitHub redéploie le Worker automatiquement (une minute environ). Après avoir ajouté des secrets, tu peux aussi relancer le dernier déploiement depuis l'onglet **Deployments**.
2. Sans jeton, https://eps-bristol.fr/api/feedback répond seulement `{"ok":true}`. Pour le diagnostic, enregistre le secret `ADMIN_TOKEN` puis, dans un terminal : `curl -H "x-admin-token: <ton jeton>" https://eps-bristol.fr/api/feedback`. Tu dois voir une ligne comme :
   `{"ok":true,"apiKey":true,"accessCodes":2,"quotaStore":true,"monthlyLimit":30,"model":"claude-sonnet-5-5"}`
   - `apiKey: false` : la clé n'est pas enregistrée (étape 2) ;
   - `accessCodes: 0` : aucun code (étape 2) ;
   - `quotaStore: false` : la liaison KV manque (étape 3).
   - Pour tester aussi la clé et le modèle sans consommer de crédit, ajoute `?probe=1` à l'adresse (avec le même en-tête) : `"keyAndModel":"ok"` signifie que tout est bon.
3. Sur le site, va dans **Écrire → Sujets**, tire un sujet, écris quelques lignes, saisis ton code, puis demande un retour.
4. Parcours des candidats (mesure anonyme, sans cookie) et résultats déclarés après les écrits : ouvre `https://eps-bristol.fr/api/stats?t=<ton jeton ADMIN_TOKEN>` dans le navigateur. Les tables `stats` et `results` se créent seules ; `migrations/0005_stats_resultats.sql` les décrit.

---

## Comptes et synchronisation

Les visiteurs peuvent créer un compte (bouton « Se connecter ») pour retrouver leur progression sur tous leurs appareils.

- **Données** : base D1 `bristol-db` (tables `users`, `sessions`, `progress` et `texts` pour les textes rédigés, créée automatiquement à la première utilisation ; schéma dans `migrations/`, à appliquer avec `npx wrangler d1 migrations apply bristol-db --remote`).
- **Mots de passe** : jamais envoyés ni stockés. Le navigateur en dérive une clé (PBKDF2-SHA256, 310 000 itérations) ; le serveur n'en garde qu'une empreinte salée.
- **Mot de passe oublié** : une clé de secours est affichée une seule fois à l'inscription. Il n'y a pas encore de récupération par e-mail.
- **Synchronisé** : progression des fiches, cartes perso, références, scores Frise et « Qui ? », date du concours, calendrier de régularité et succès. Les textes rédigés (plans, introductions, paragraphes) restent sur chaque appareil.
- **Connexion avec Google** : identifiant client dans `wrangler.jsonc` (`GOOGLE_CLIENT_ID`), secret dans Cloudflare (`GOOGLE_CLIENT_SECRET`, type Secret). URI de redirection à déclarer chez Google : `https://eps-bristol.fr/api/auth/google/callback`. Quand Google se relie à un compte à mot de passe existant de même adresse, ce mot de passe est désactivé (protection contre la création d'un compte par un tiers avec ton adresse). Tant que l'application Google est en mode test, seuls les utilisateurs test déclarés peuvent se connecter : publie-la dans Google Auth Platform → Audience avant d'ouvrir le site.
- **Suppression** : chaque utilisateur peut supprimer son compte et ses données depuis « Mon compte ».
- **Voir les comptes** : Cloudflare → Storage & Databases → D1 → `bristol-db` → Console, par exemple `SELECT email, created_at FROM users;`

## Mettre à jour le site

Chaque modification envoyée sur la branche `main` est déployée automatiquement.

Si tu modifies `source/bristol-eps.html` ou `source/landing.html`, fabrique d'abord les pages avec : `python3 build.py`. Le script réécrit aussi `public/_headers` (en-têtes de sécurité) : la politique de contenu n'autorise que les scripts du site, reconnus par leur empreinte. Une page modifiée sans relancer `build.py` resterait bloquée par le navigateur.

## Identité visuelle

- **L'idée** : la fiche bristol. Chaque section de la page d'accueil est une fiche du paquet du candidat (papier clair, ligne d'en-tête verte), et la première se retourne.
- **Couleurs** : fond os `#e5e1d8`, papier `#f3f3f0`, encre chocolat `#2a1d17`, un seul vert `#456f3a` pour l'action ; variantes sombres dans les deux pages.
- **Typographie** : Imbue (titres et grands chiffres) et Albert Sans (texte), servies par le site lui-même depuis `public/fonts/` (licence SIL OFL) : aucune requête vers Google.
- **Images** : uniquement des captures réelles de l'application (`public/img/`), et une courte vidéo d'une séance (`session.webm`). À refaire quand l'interface change.

## Sécurité

- **En-têtes** (`public/_headers`, écrit par `build.py`) : politique de contenu stricte (aucun script extérieur ni injecté), HTTPS imposé (HSTS), pas d'affichage dans un cadre, pas de caméra, micro ni localisation.
- **API** : JSON et même origine exigés sur toutes les requêtes qui modifient quelque chose ; corps limité à 256 Ko pour les retours de Claude.
- **Comptes** : cookie de session `HttpOnly`, `Secure`, `SameSite=Lax` ; 10 essais par heure et par compte ; par connexion internet, 10 inscriptions et 30 échecs de connexion par heure (adresse IP conservée seulement hachée, 2 heures). Les sessions expirées sont effacées chaque nuit.
- **Coûts** : usage raisonnable par abonné et plafond global quotidien (voir le tableau des variables).

## Bon à savoir

- **Le prompt est construit côté serveur.** Un visiteur ne peut pas se servir de ta clé pour autre chose qu'un retour sur un sujet, avec un texte de 6 000 caractères maximum et une réponse plafonnée.
- **Changer de modèle** : ajoute une variable `MODEL` (par exemple `claude-opus-5-5`, environ deux fois plus cher).
- **Retirer un testeur** : enlève son code du secret `ACCESS_CODES`.
- **Le site n'est pas indexé par les moteurs de recherche** pendant la bêta (balise `noindex` dans la page).
- **Tester en local**, si tu es à l'aise avec un terminal : crée un fichier `.dev.vars` (jamais envoyé sur GitHub) contenant `ANTHROPIC_API_KEY=...` et `ACCESS_CODES=...`, puis lance `npx wrangler dev`.

## Avant de faire payer

- Déclare ton activité à ton administration (cumul d'activités des fonctionnaires) et crée ton statut d'auto-entrepreneur.
- Ajoute des mentions légales, des conditions de vente et une politique de confidentialité qui indique que les textes envoyés pour un retour transitent par Anthropic.
- Les étapes suivantes du produit : comptes utilisateurs, paiement Stripe, quota par abonné à la place des codes bêta.
