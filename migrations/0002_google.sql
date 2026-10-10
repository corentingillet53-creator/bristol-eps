-- Connexion avec Google : identifiant Google (« sub ») rattaché au compte.
-- Un compte créé par Google n'a pas de mot de passe : key_salt, key_hash et
-- recovery_hash y valent la chaîne vide.
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_sub) WHERE google_sub IS NOT NULL;
