-- Visites des pages (functions/api/event.js, recordView) : un compteur par jour et par valeur
-- d'une dimension (k = page, src provenance, dev appareil, cc pays, uv visiteurs du jour).
-- Ni cookie, ni identifiant, ni adresse IP. Créée aussi par le Worker au premier usage.
CREATE TABLE IF NOT EXISTS views (
  day TEXT NOT NULL,
  k   TEXT NOT NULL,
  v   TEXT NOT NULL,
  n   INTEGER NOT NULL,
  PRIMARY KEY (day, k, v)
);
