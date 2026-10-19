-- Mesure d'audience anonyme (functions/api/event.js) : un compteur par jour, étape du parcours
-- et concours. Aucun identifiant ni adresse IP. Créée aussi par le Worker au premier usage.
CREATE TABLE IF NOT EXISTS stats (
  day TEXT NOT NULL,
  e   TEXT NOT NULL,
  c   TEXT NOT NULL,
  n   INTEGER NOT NULL,
  PRIMARY KEY (day, e, c)
);

-- Résultats du concours déclarés par les candidats après les écrits, avec un témoignage
-- facultatif ; anonymes (prénom gardé seulement si la personne accepte la publication).
CREATE TABLE IF NOT EXISTS results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  c          TEXT NOT NULL,
  y          INTEGER NOT NULL,
  r          TEXT NOT NULL,
  txt        TEXT NOT NULL DEFAULT '',
  pub        INTEGER NOT NULL DEFAULT 0,
  prenom     TEXT NOT NULL DEFAULT ''
);
