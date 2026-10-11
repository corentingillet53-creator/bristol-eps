-- Textes rédigés (introductions, paragraphes, copies, retours de Claude, grilles
-- d'auto-évaluation), une ligne par texte. Le Worker crée aussi la table à la
-- première utilisation : ce fichier documente le schéma.
CREATE TABLE IF NOT EXISTS texts (
  user_id TEXT NOT NULL,
  k       TEXT NOT NULL,
  v       TEXT NOT NULL,
  t       INTEGER NOT NULL,
  PRIMARY KEY (user_id, k)
);
