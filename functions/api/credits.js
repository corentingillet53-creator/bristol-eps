// Bristol EPS — crédits de retours de Claude.
// Chaque abonné reçoit MONTHLY_CREDITS crédits par mois (60 par défaut), renouvelés le 1er (UTC),
// et peut en racheter (recharge Stripe, functions/api/billing.js). Les crédits du mois servent d'abord,
// puis les crédits rechargés, valables jusqu'à la fin de la session (PASS_UNTIL + 30 jours).
// Coût d'une demande : 1 crédit pour un retour court, 3 pour une copie tapée, 4 pour une copie en photos.
// Le coût réel d'un crédit est borné par max_tokens et la taille des entrées (≈ 0,05 $ au plus pour un retour court avec max_tokens 4 000, voir feedback.js).
// Clés D1 (table usage) : cr:<qui>:<mois> (crédits du mois utilisés), topup:<qui> (crédits rechargés restants).
import { take, bump, peek, spend } from "./usage.js";
import { passUntil } from "./plan.js";

const DAY = 864e5;
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
export const CREDIT_COST = { court: 1, copie: 3, photos: 4 };
export const creditCost = (isCopie, images) => (images ? CREDIT_COST.photos : isCopie ? CREDIT_COST.copie : CREDIT_COST.court);
export const monthlyCredits = (env) => num(env.MONTHLY_CREDITS, 60);
export const topupCredits = (env) => num(env.TOPUP_CREDITS, 50);
const monthKey = (who, now) => `cr:${who}:${new Date(now).toISOString().slice(0, 7)}`;
const topKey = (who) => "topup:" + who;
const topTtl = (env, now) => Math.max(passUntil(env) + 30 * DAY - now, 30 * DAY);
const nextMonth = (now) => { const d = new Date(now); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); };

export async function creditState(env, who, now = Date.now()) {
  const allowance = monthlyCredits(env);
  const used = Math.min(allowance, await peek(env, monthKey(who, now), now));
  const topup = Math.max(0, await peek(env, topKey(who), now));
  return { allowance, used, month: allowance - used, topup, left: allowance - used + topup, renews: nextMonth(now) };
}

// Prend cost crédits : sur le mois si possible, sinon sur la recharge. Renvoie { undo } ou null.
export async function chargeCredits(env, who, cost, now = Date.now()) {
  const mk = monthKey(who, now);
  if (await take(env, mk, cost, monthlyCredits(env), 40 * DAY, now) !== null) return { undo: () => bump(env, mk, -cost, 40 * DAY, now) };
  if (await spend(env, topKey(who), cost, now) !== null) return { undo: () => bump(env, topKey(who), cost, topTtl(env, now), now) };
  return null;
}

// Recharge payée (ou retirée, n < 0, après un remboursement).
export async function addTopup(env, who, n, now = Date.now()) {
  return bump(env, topKey(who), n, topTtl(env, now), now);
}
