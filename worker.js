// Point d'entrée du Worker Cloudflare :
// - /api/feedback : retour de Claude (fonction serveur) ;
// - /api/auth/*, /api/progress, /api/texts : comptes et données synchronisées ;
// - /api/billing/* : abonnement (Stripe) et codes d'accès ;
// - /api/report : signalement d'une erreur sur une fiche ;
// - /api/push/* : abonnement aux rappels quotidiens (envoyés par le cron, scheduled) ;
// - tout le reste est servi depuis le dossier public (fichiers statiques).
import { onRequestGet, onRequestPost } from "./functions/api/feedback.js";
import { isAccountRoute, handleAccount } from "./functions/api/account.js";
import { isPushRoute, handlePush, runDaily } from "./functions/api/push.js";
import { handleReport } from "./functions/api/report.js";
import { isBillingRoute, handleBilling } from "./functions/api/billing.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/feedback") {
      if (request.method === "POST") return onRequestPost({ request, env, ctx });
      if (request.method === "GET") return onRequestGet({ request, env, ctx });
      return new Response("Méthode non autorisée", { status: 405, headers: { allow: "GET, POST" } });
    }
    if (isAccountRoute(url.pathname)) return handleAccount(request, env);
    if (isPushRoute(url.pathname)) return handlePush(request, env);
    if (url.pathname === "/api/report") return handleReport(request, env);
    if (isBillingRoute(url.pathname)) return handleBilling(request, env);
    return env.ASSETS.fetch(request);
  },
  // Toutes les 15 minutes (wrangler.jsonc, triggers) : rappels quotidiens.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDaily(env, new Date(event.scheduledTime)).catch((e) => console.error("Rappels :", String(e && e.stack || e))));
  },
};
