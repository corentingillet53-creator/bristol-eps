# Bristol EPS — mettre le site en ligne

Ce dossier contient le site complet, prêt à déployer sur **Cloudflare Pages** (offre gratuite) :

- `public/index.html` : le site (fiches, fils rouges, entraînements, suivi) ;
- `functions/api/feedback.js` : la fonction serveur qui appelle Claude avec **ta** clé d'API, après avoir vérifié le code d'accès et le quota ;
- `source/bristol-eps.html` et `build.py` : la source de la page et le script qui fabrique `public/index.html`.

Sur ce site, le retour de Claude ne touche plus à tes limites personnelles : il est facturé à l'usage sur ton compte API, environ 1 centime par retour avec Claude Sonnet 5.5.

Compte environ 30 minutes la première fois.

---

## 1. Créer ta clé d'API Claude

1. Va sur la console Anthropic (platform.claude.com) et crée un compte.
2. Dans la facturation, ajoute un petit crédit (5 € suffisent largement pour la bêta).
3. Dans les limites du compte, **fixe un plafond de dépenses mensuel** (par exemple 10 €). C'est ta protection en cas d'abus.
4. Crée une clé d'API et copie-la. Garde-la secrète : ne l'envoie à personne, ne la colle dans aucune conversation, ne la mets jamais dans un fichier du site. Elle ira uniquement dans les réglages de Cloudflare (étape 4).

## 2. Mettre le dossier sur GitHub

1. Crée un compte sur github.com si tu n'en as pas.
2. Crée un nouveau dépôt (**New repository**), nommé par exemple `bristol-eps`, en **Private**.
3. Sur la page du dépôt vide, clique sur **uploading an existing file**.
4. Glisse **le contenu** du dossier décompressé (les dossiers `public`, `functions`, `source` et les fichiers `build.py`, `README.md`), pas le dossier lui-même : `functions` doit se trouver à la racine du dépôt.
5. Clique sur **Commit changes**.

## 3. Créer le site sur Cloudflare Pages

1. Crée un compte sur cloudflare.com (offre gratuite).
2. Va dans **Workers & Pages**, crée une application, choisis **Pages**, puis connecte ton compte GitHub et sélectionne le dépôt `bristol-eps`.
3. Réglages de build :
   - Framework preset : **None**
   - Build command : laisse vide
   - Build output directory : **public**
4. Lance le déploiement. Ton site est en ligne à une adresse du type `bristol-eps.pages.dev`. Les fiches marchent déjà ; le retour de Claude, pas encore.

## 4. Brancher Claude et les codes d'accès

Dans le projet Pages, va dans **Settings → Variables and Secrets** (environnement Production) et ajoute :

| Nom | Valeur | Type |
|---|---|---|
| `ANTHROPIC_API_KEY` | ta clé d'API | **Secret** |
| `ACCESS_CODES` | tes codes bêta séparés par des virgules, par exemple `EPS-ALICE-7Q2,EPS-BRUNO-K9F` | Texte |
| `MONTHLY_LIMIT` | nombre de retours par code et par mois, par exemple `30` | Texte (facultatif, 30 par défaut) |

Donne un code différent à chaque testeur : tu pourras en retirer un sans gêner les autres. Choisis des codes difficiles à deviner.

## 5. Activer le quota mensuel (recommandé)

Sans cette étape, le site marche mais ne compte pas les retours : seul ton plafond de dépenses te protège.

1. Dans Cloudflare, ouvre **KV** (dans Storage & Databases) et crée un espace de noms, par exemple `bristol-quota`.
2. Retourne dans le projet Pages : **Settings → Bindings → Add → KV namespace**.
3. Nom de la variable : **`QUOTA`** (exactement), espace de noms : `bristol-quota`.

## 6. Redéployer et vérifier

1. Les réglages ne s'appliquent qu'au prochain déploiement : dans **Deployments**, relance le dernier déploiement.
2. Ouvre `https://<ton-projet>.pages.dev/api/feedback` dans ton navigateur. Tu dois voir une ligne comme :
   `{"ok":true,"apiKey":true,"accessCodes":2,"quotaStore":true,"monthlyLimit":30,"model":"claude-sonnet-5-5"}`
   - `apiKey: false` : la clé n'est pas enregistrée (étape 4) ;
   - `accessCodes: 0` : aucun code (étape 4) ;
   - `quotaStore: false` : la liaison KV manque (étape 5).
3. Sur le site, va dans **S'entraîner → Sujets**, tire un sujet, écris quelques lignes, saisis ton code, puis demande un retour.

---

## Mettre à jour le site

Quand la page évolue, il suffit de remplacer `public/index.html` dans le dépôt GitHub (bouton **Add file → Upload files**). Cloudflare redéploie tout seul en une minute.

Si tu modifies `source/bristol-eps.html`, fabrique d'abord la nouvelle page avec : `python3 build.py`

## Bon à savoir

- **Ta progression ne se synchronise pas encore entre appareils sur ce site** : elle reste dans le navigateur. La synchronisation reviendra avec les comptes utilisateurs.
- **Le prompt est construit côté serveur.** Un visiteur ne peut pas se servir de ta clé pour autre chose qu'un retour sur un sujet, avec un texte de 6 000 caractères maximum et une réponse plafonnée.
- **Changer de modèle** : ajoute une variable `MODEL` (par exemple `claude-opus-5-5`, environ deux fois plus cher).
- **Retirer un testeur** : enlève son code de `ACCESS_CODES`, puis redéploie.
- **Le site n'est pas indexé par les moteurs de recherche** pendant la bêta (balise `noindex` dans la page).
- **Alternative sans GitHub**, si tu es à l'aise avec un terminal : depuis ce dossier, `npx wrangler pages deploy public --project-name bristol-eps`.

## Avant de faire payer

- Déclare ton activité à ton administration (cumul d'activités des fonctionnaires) et crée ton statut d'auto-entrepreneur.
- Ajoute des mentions légales, des conditions de vente et une politique de confidentialité qui indique que les textes envoyés pour un retour transitent par Anthropic.
- Les étapes suivantes du produit : comptes utilisateurs, paiement Stripe, quota par abonné à la place des codes bêta.
