# Bristol EPS — mettre le site en ligne

Ce dépôt contient le site complet, déployé comme **Worker Cloudflare** (offre gratuite) :

- `public/` : le site (fiches, fils rouges, entraînements, suivi), servi tel quel ;
- `functions/api/feedback.js` : la fonction serveur qui appelle Claude avec **ta** clé d'API, après avoir vérifié le code d'accès et le quota ;
- `worker.js` et `wrangler.jsonc` : le point d'entrée et la configuration du Worker ;
- `source/bristol-eps.html` et `build.py` : la source de la page et le script qui fabrique `public/index.html`.

Sur ce site, le retour de Claude ne touche plus à tes limites personnelles : il est facturé à l'usage sur ton compte API, environ 1 centime par retour avec Claude Sonnet 5.5.

Adresse actuelle : https://bristol-eps.corentin-gillet53.workers.dev

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
| `MONTHLY_LIMIT` | nombre de retours par code et par mois, par exemple `30` | Texte (facultatif, 30 par défaut) |
| `ANTHROPIC_WORKSPACE_ID` | ID de l'espace de travail de la console, **seulement** si ta clé n'est rattachée à aucun espace de travail | Texte (facultatif) |

Mets bien les deux premières en **Secret** : elles restent ainsi cachées et ne sont jamais effacées par un nouveau déploiement.

Donne un code différent à chaque testeur : tu pourras en retirer un sans gêner les autres. Choisis des codes difficiles à deviner.

## 3. Quota mensuel

Déjà en place : l'espace de stockage KV `bristol-quota` compte les retours par code et par mois. Il est déclaré dans `wrangler.jsonc` (une liaison ajoutée seulement dans le tableau de bord serait effacée au déploiement suivant).

## 4. Vérifier

1. Chaque envoi sur GitHub redéploie le Worker automatiquement (une minute environ). Après avoir ajouté des secrets, tu peux aussi relancer le dernier déploiement depuis l'onglet **Deployments**.
2. Ouvre https://bristol-eps.corentin-gillet53.workers.dev/api/feedback. Tu dois voir une ligne comme :
   `{"ok":true,"apiKey":true,"accessCodes":2,"quotaStore":true,"monthlyLimit":30,"model":"claude-sonnet-5-5"}`
   - `apiKey: false` : la clé n'est pas enregistrée (étape 2) ;
   - `accessCodes: 0` : aucun code (étape 2) ;
   - `quotaStore: false` : la liaison KV manque (étape 3).
   - Pour tester aussi la clé et le modèle sans consommer de crédit, ajoute `?probe=1` à l'adresse : `"keyAndModel":"ok"` signifie que tout est bon.
3. Sur le site, va dans **S'entraîner → Sujets**, tire un sujet, écris quelques lignes, saisis ton code, puis demande un retour.

---

## Comptes et synchronisation

Les visiteurs peuvent créer un compte (bouton « Se connecter ») pour retrouver leur progression sur tous leurs appareils.

- **Données** : base D1 `bristol-db` (tables `users`, `sessions`, `progress`, schéma dans `migrations/`).
- **Mots de passe** : jamais envoyés ni stockés. Le navigateur en dérive une clé (PBKDF2-SHA256, 310 000 itérations) ; le serveur n'en garde qu'une empreinte salée.
- **Mot de passe oublié** : une clé de secours est affichée une seule fois à l'inscription. Il n'y a pas encore de récupération par e-mail.
- **Synchronisé** : progression des fiches, cartes perso, références, scores Frise et « Qui ? », date du concours et calendrier de régularité. Les textes rédigés (plans, introductions, paragraphes) restent sur chaque appareil.
- **Connexion avec Google** : identifiant client dans `wrangler.jsonc` (`GOOGLE_CLIENT_ID`), secret dans Cloudflare (`GOOGLE_CLIENT_SECRET`, type Secret). URI de redirection à déclarer chez Google : `https://bristol-eps.corentin-gillet53.workers.dev/api/auth/google/callback`. Quand Google se relie à un compte à mot de passe existant de même adresse, ce mot de passe est désactivé (protection contre la création d'un compte par un tiers avec ton adresse). Tant que l'application Google est en mode test, seuls les utilisateurs test déclarés peuvent se connecter : publie-la dans Google Auth Platform → Audience avant d'ouvrir le site.
- **Suppression** : chaque utilisateur peut supprimer son compte et ses données depuis « Mon compte ».
- **Voir les comptes** : Cloudflare → Storage & Databases → D1 → `bristol-db` → Console, par exemple `SELECT email, created_at FROM users;`

## Mettre à jour le site

Chaque modification envoyée sur la branche `main` est déployée automatiquement.

Si tu modifies `source/bristol-eps.html`, fabrique d'abord la nouvelle page avec : `python3 build.py`

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
