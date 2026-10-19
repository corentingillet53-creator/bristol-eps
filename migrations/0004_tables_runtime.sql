-- Tables créées par le Worker à la première utilisation (plan.js, push.js, report.js,
-- waitlist.js, usage.js). Ce fichier documente leur schéma et permet de les créer d'avance ;
-- tout est en IF NOT EXISTS, donc sans effet sur une base où elles existent déjà.

-- Abonnements et pass (Stripe ou code d'accès).
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id         TEXT PRIMARY KEY,
  plan            TEXT NOT NULL,
  status          TEXT NOT NULL,
  until           INTEGER NOT NULL,
  stripe_customer TEXT,
  stripe_sub      TEXT,
  updated_at      INTEGER NOT NULL
);

-- Notifications de rappel (Web Push) et clés VAPID.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  hm         TEXT NOT NULL,
  origin     TEXT NOT NULL,
  last_day   TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS config (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- Signalements d'erreurs sur les fiches (effacés après un an, anonymisés à la suppression du compte).
CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  card       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  msg        TEXT NOT NULL,
  q          TEXT NOT NULL,
  user_id    TEXT,
  created_at INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'nouveau',
  email      TEXT
);

-- Liste d'attente de la page de présentation.
CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT PRIMARY KEY,
  concours   TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Compteurs atomiques (usage raisonnable, essais gratuits, codes) ; exp en millisecondes.
CREATE TABLE IF NOT EXISTS usage (
  k   TEXT PRIMARY KEY,
  n   INTEGER NOT NULL,
  exp INTEGER NOT NULL
);
