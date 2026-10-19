// Point d'entrée du Worker Cloudflare :
// - /api/feedback : retour de Claude (fonction serveur) ;
// - /api/auth/*, /api/progress, /api/texts : comptes et données synchronisées ;
// - /api/billing/* : abonnement (Stripe) et codes d'accès ;
// - /api/report : signalement d'une erreur sur une fiche ;
// - /api/waitlist : adresse laissée pour être prévenu de l'ouverture du paiement ;
// - /api/push/* : abonnement aux rappels quotidiens (envoyés par le cron, scheduled) ;
// - tout le reste est servi depuis le dossier public (fichiers statiques).
import { onRequestGet, onRequestPost } from "./functions/api/feedback.js";
import { isAccountRoute, handleAccount, purgeExpiredSessions } from "./functions/api/account.js";
import { isPushRoute, handlePush, runDaily } from "./functions/api/push.js";
import { handleReport } from "./functions/api/report.js";
import { handleWaitlist } from "./functions/api/waitlist.js";
import { purgeUsage } from "./functions/api/usage.js";
import { isBillingRoute, handleBilling } from "./functions/api/billing.js";

/* Réponses de l'API : mêmes en-têtes de base que les fichiers statiques (public/_headers). */
const API_HEADERS = {
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};
function harden(res) {
  try { for (const [k, v] of Object.entries(API_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v); } catch (e) {}
  return res;
}

async function route(request, env, ctx, url) {
  if (url.pathname === "/api/feedback") {
    if (request.method === "POST") return onRequestPost({ request, env, ctx });
    if (request.method === "GET") return onRequestGet({ request, env, ctx });
    return new Response("Méthode non autorisée", { status: 405, headers: { allow: "GET, POST" } });
  }
  if (isAccountRoute(url.pathname)) return handleAccount(request, env);
  if (isPushRoute(url.pathname)) return handlePush(request, env);
  if (url.pathname === "/api/report") return handleReport(request, env);
  if (url.pathname === "/api/waitlist") return handleWaitlist(request, env);
  if (isBillingRoute(url.pathname)) return handleBilling(request, env);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    return harden(await route(request, env, ctx, url));
  },
  // Toutes les 15 minutes (wrangler.jsonc, triggers) : rappels quotidiens ;
  // une fois par jour (vers 3 h UTC), ménage des sessions expirées, des vieux signalements
  // et des compteurs d'usage échus.
  async scheduled(event, env, ctx) {
    const t = new Date(event.scheduledTime);
    ctx.waitUntil(runDaily(env, t).catch((e) => console.error("Rappels :", String(e && e.stack || e))));
    if (t.getUTCHours() === 3 && t.getUTCMinutes() < 15) {
      ctx.waitUntil(purgeExpiredSessions(env, t.getTime()).catch((e) => console.error("Ménage :", String(e && e.stack || e))));
      ctx.waitUntil(purgeUsage(env, t.getTime()).catch((e) => console.error("Ménage des compteurs :", String(e && e.stack || e))));
    }
  },
};
