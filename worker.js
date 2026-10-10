// Point d'entrée du Worker Cloudflare : /api/feedback est traité par la fonction
// serveur, tout le reste est servi depuis le dossier public (fichiers statiques).
import { onRequestGet, onRequestPost } from "./functions/api/feedback.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/feedback") {
      if (request.method === "POST") return onRequestPost({ request, env, ctx });
      if (request.method === "GET") return onRequestGet({ request, env, ctx });
      return new Response("Méthode non autorisée", { status: 405, headers: { allow: "GET, POST" } });
    }
    return env.ASSETS.fetch(request);
  },
};
