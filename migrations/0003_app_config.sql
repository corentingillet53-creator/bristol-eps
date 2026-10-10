-- Réglages applicatifs stockés en base (hors dépôt GitHub), par exemple un secret
-- qui n'a pas pu être enregistré comme secret Cloudflare. Un secret Cloudflare de
-- même nom reste prioritaire.
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
