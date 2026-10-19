// Base D1 simulée pour les tests : SQLite en mémoire (node:sqlite), schéma de migrations/.
// Chaque requête attend un tour de boucle, comme un vrai aller-retour réseau : des demandes
// lancées en même temps s'entrelacent donc entre deux requêtes, ce qui éprouve les compteurs.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../migrations/", import.meta.url);
const tick = () => new Promise((r) => setImmediate(r));
const val = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const stmt = (sql, args = []) => {
    const exec = (mode) => {
      const s = db.prepare(sql), a = args.map(val);
      if (mode === "first") return s.get(...a) ?? null;
      if (mode === "all") return { results: s.all(...a), success: true, meta: {} };
      if (/\bRETURNING\b/i.test(sql)) { const rows = s.all(...a); return { results: rows, success: true, meta: { changes: rows.length } }; }
      const r = s.run(...a); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    };
    return {
      bind: (...a) => stmt(sql, a),
      first: async (col) => { await tick(); const r = exec("first"); return col && r ? r[col] : r; },
      all: async () => { await tick(); return exec("all"); },
      run: async () => { await tick(); return exec("run"); },
      _exec: exec,
    };
  };
  return {
    sqlite: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => { await tick(); db.exec("BEGIN"); try { const out = list.map((s) => s._exec("run")); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } },
    exec: async (sql) => { await tick(); db.exec(sql); return { count: 1 }; },
  };
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Crée un compte et une session ; renvoie le cookie à envoyer.
export async function seedUser(DB, id = "u1", email = id + "@ex.fr") {
  const tok = (id + "0".repeat(64)).replace(/[^0-9a-f]/g, "a").slice(0, 64);
  DB.sqlite.prepare("INSERT INTO users (id, email, key_salt, key_hash, recovery_hash, created_at) VALUES (?, ?, '', '', '', 0)").run(id, email);
  DB.sqlite.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, 0, ?)").run(await sha256Hex(tok), id, Date.now() + 864e5);
  return "bsess=" + tok;
}
