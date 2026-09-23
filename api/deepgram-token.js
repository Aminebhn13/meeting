// api/deepgram-token.js — Vercel Edge Function
//
// Délivre un jeton Deepgram éphémère au navigateur. La clé DEEPGRAM_API_KEY
// ne quitte jamais le serveur ; le front n'obtient qu'un JWT de courte durée.
//
//   POST (x-app-password si APP_PASSWORD est défini)
//   -> 200 { access_token, expires_in }
//   -> 401 mot de passe manquant/invalide
//   -> 500 DEEPGRAM_API_KEY absente
//   -> 502 Deepgram injoignable ou refuse

export const config = { runtime: 'edge' };

const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';
// 30 s par défaut chez Deepgram : trop court pour ouvrir le micro puis le
// WebSocket, et pour les reconnexions. On demande 5 minutes.
const TTL_SECONDS = 300;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Méthode non autorisée : utilisez POST.' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST' }
    });
  }

  const appPassword = process.env.APP_PASSWORD;
  if (appPassword) {
    const provided = req.headers.get('x-app-password');
    if (!provided || provided !== appPassword) {
      return json(401, { error: 'Mot de passe de l’application invalide ou manquant.' });
    }
  }

  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return json(500, {
      error: 'Transcription professionnelle indisponible : la variable d’environnement DEEPGRAM_API_KEY est absente.'
    });
  }

  let upstream;
  try {
    upstream = await fetch(GRANT_URL, {
      method: 'POST',
      headers: { authorization: 'Token ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: TTL_SECONDS })
    });
  } catch (err) {
    return json(502, { error: 'Deepgram injoignable : ' + (err && err.message ? err.message : 'erreur réseau') });
  }

  const raw = await upstream.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* non JSON */ }

  if (!upstream.ok) {
    const detail = (data && (data.err_msg || data.message || data.error)) || raw.slice(0, 200) || 'aucun détail';
    const hint = upstream.status === 401 || upstream.status === 403
      ? ' (clé DEEPGRAM_API_KEY invalide, ou droits insuffisants — il faut au moins le rôle Member)'
      : '';
    return json(upstream.status === 401 ? 502 : upstream.status, {
      error: `Deepgram a refusé la demande de jeton (${upstream.status})${hint} : ${detail}`
    });
  }

  if (!data || !data.access_token) {
    return json(502, { error: 'Réponse Deepgram inattendue : aucun access_token.' });
  }

  return json(200, { access_token: data.access_token, expires_in: data.expires_in || TTL_SECONDS });
}
