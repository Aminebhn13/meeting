// api/claude.js — Vercel Serverless Function (Node 18+, ESM, fetch natif)
//
// Contrat d'entrée (POST, JSON) :
//   { mode: "questions" | "answer" | "summary",
//     domain?: string, goal?: string, transcript?: string, question?: string }
//
// Contrat de sortie :
//   200 -> { text: string }
//   4xx/5xx -> { error: string }
//
// La clé ANTHROPIC_API_KEY ne quitte jamais le serveur.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';

// On ne garde que la fin de la transcription : c'est la partie la plus utile
// et cela borne le coût / la latence sur les réunions longues.
const MAX_TRANSCRIPT_CHARS = 60000;

const SYSTEM_PROMPT = [
  "Tu es un copilote de réunion. Tu assistes en direct une personne qui participe à une visioconférence.",
  "",
  "La transcription qui t'est fournie provient d'une reconnaissance vocale automatique imparfaite :",
  "elle contient des erreurs de mots, des coupures, de la ponctuation approximative, et elle ne distingue",
  "pas les orateurs. Ne relève jamais ces défauts, ne commente pas la qualité de la transcription :",
  "interprète-la au mieux et raisonne sur le fond.",
  "",
  "Règles de réponse, sans exception :",
  "- Réponds toujours en français.",
  "- Sois concis et directement exploitable à l'oral.",
  "- Aucun préambule, aucune formule de politesse, aucune méta-phrase du type « Voici » ou « Bien sûr ».",
  "- N'invente jamais un fait, un chiffre, un nom ou une date qui n'est pas dans la transcription",
  "  ou dans le contexte fourni. Si une information manque, écris « non précisé ».",
  "- Respecte strictement le format demandé dans le message de l'utilisateur."
].join('\n');

function clampTranscript(transcript) {
  const t = typeof transcript === 'string' ? transcript.trim() : '';
  if (t.length <= MAX_TRANSCRIPT_CHARS) return t;
  return '[...début de la réunion tronqué...]\n' + t.slice(-MAX_TRANSCRIPT_CHARS);
}

function contextBlock(domain, goal) {
  const d = (domain || '').trim() || 'non précisé';
  const g = (goal || '').trim() || 'non précisé';
  return `Domaine et rôle de l'utilisateur : ${d}\nObjet et objectif de la réunion : ${g}`;
}

function transcriptBlock(transcript) {
  const t = clampTranscript(transcript);
  if (!t) {
    return "Transcription : (vide pour l'instant — la réunion vient de commencer)";
  }
  return `Transcription (horodatée [mm:ss], reconnaissance vocale, orateurs non distingués) :\n"""\n${t}\n"""`;
}

function buildUserPrompt({ mode, domain, goal, transcript, question }) {
  const ctx = contextBlock(domain, goal);
  const tr = transcriptBlock(transcript);

  if (mode === 'questions') {
    return [
      ctx,
      '',
      tr,
      '',
      "Propose EXACTEMENT 3 questions que l'utilisateur peut poser maintenant, à voix haute, dans cette réunion.",
      '',
      'Critères impératifs :',
      "- Chaque question doit être spécifique au domaine de l'utilisateur et à l'objectif de la réunion,",
      '  et s\'appuyer sur ce qui vient réellement d\'être dit.',
      '- Vise en priorité : les zones floues, les risques, les dépendances, les décisions non tranchées,',
      '  les délais manquants et les chiffres manquants.',
      '- Pas de question générique ni de question déjà répondue dans la transcription.',
      '- Une seule phrase par question, formulée telle qu\'elle sera prononcée.',
      '',
      'Format de sortie, rien d\'autre :',
      '1. <question>',
      '2. <question>',
      '3. <question>'
    ].join('\n');
  }

  if (mode === 'answer') {
    const q = (question || '').trim();
    return [
      ctx,
      '',
      tr,
      '',
      `Question de l'utilisateur : ${q || 'non précisé'}`,
      '',
      "Réponds de manière prête à être dite à l'oral, en 2 à 4 phrases maximum.",
      "Appuie-toi sur la transcription et le contexte quand c'est possible.",
      '',
      "Si — et seulement si — ta réponse repose sur une hypothèse, une information absente de la transcription",
      "ou un point que l'utilisateur devrait confirmer, ajoute à la fin une unique ligne commençant par",
      '« À vérifier : » suivie de ce point, en une phrase.',
      '',
      "N'ajoute aucun titre, aucune liste, aucun préambule."
    ].join('\n');
  }

  if (mode === 'summary') {
    return [
      ctx,
      '',
      tr,
      '',
      'Rédige le bilan de cette réunion en suivant EXACTEMENT la structure ci-dessous, titres inclus,',
      'sans rien ajouter avant ni après.',
      '',
      "N'invente rien. Si une information n'apparaît pas dans la transcription, écris « non précisé ».",
      "Si une section entière est vide, écris « non précisé » en dessous du titre.",
      '',
      'ÉTAPE ACTUELLE',
      "<1 à 2 phrases : où en est le sujet à la fin de cette réunion>",
      '',
      'DÉCISIONS',
      '- <décision réellement actée, une par ligne>',
      '',
      'ACTIONS',
      '- <qui> → <quoi> → <échéance>',
      '',
      'POINTS OUVERTS & RISQUES',
      '- <point non tranché, risque, dépendance, question en suspens>',
      '',
      'PROCHAINE ÉTAPE RECOMMANDÉE',
      '<1 à 3 phrases : la prochaine action la plus utile, et pourquoi>'
    ].join('\n');
  }

  return null;
}

function sendJson(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  // Vercel parse déjà le JSON dans req.body la plupart du temps ; on gère les deux cas.
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    try { return JSON.parse(req.body); } catch { throw new Error('Corps de requête JSON invalide.'); }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('Corps de requête JSON invalide.'); }
}

export default async function handler(req, res) {
  // --- Méthode : POST uniquement -------------------------------------------
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Méthode non autorisée : utilisez POST.' });
  }

  // --- Mot de passe applicatif ---------------------------------------------
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword) {
    const provided = req.headers['x-app-password'];
    if (!provided || provided !== appPassword) {
      return sendJson(res, 401, { error: 'Mot de passe de l’application invalide ou manquant.' });
    }
  }

  // --- Clé API (serveur uniquement) ----------------------------------------
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Configuration serveur incomplète : la variable d’environnement ANTHROPIC_API_KEY est absente.'
    });
  }

  // --- Corps de la requête --------------------------------------------------
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const { mode, domain, goal, transcript, question } = body || {};

  if (!mode || !['questions', 'answer', 'summary'].includes(mode)) {
    return sendJson(res, 400, {
      error: 'Paramètre « mode » invalide : attendu "questions", "answer" ou "summary".'
    });
  }
  if (mode === 'answer' && !(question && String(question).trim())) {
    return sendJson(res, 400, { error: 'Une question est requise pour le mode "answer".' });
  }

  const userPrompt = buildUserPrompt({ mode, domain, goal, transcript, question });
  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const maxTokens = mode === 'summary' ? 1500 : 500;

  // --- Appel de l'API Anthropic --------------------------------------------
  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
  } catch (err) {
    return sendJson(res, 502, {
      error: 'Impossible de joindre l’API Anthropic : ' + (err && err.message ? err.message : 'erreur réseau')
    });
  }

  const rawText = await upstream.text();
  let data = null;
  try { data = JSON.parse(rawText); } catch { /* réponse non JSON */ }

  if (!upstream.ok) {
    const detail =
      (data && data.error && data.error.message) ||
      (rawText ? rawText.slice(0, 300) : 'aucun détail');
    const hint =
      upstream.status === 401 ? ' (clé ANTHROPIC_API_KEY invalide ?)' :
      upstream.status === 429 ? ' (limite de débit atteinte, réessayez dans quelques secondes)' :
      upstream.status === 404 ? ` (modèle « ${model} » introuvable ?)` : '';
    return sendJson(res, upstream.status, {
      error: `Erreur API Anthropic ${upstream.status}${hint} : ${detail}`
    });
  }

  const text = Array.isArray(data && data.content)
    ? data.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim()
    : '';

  if (!text) {
    return sendJson(res, 502, { error: 'Réponse vide reçue de l’API Anthropic.' });
  }

  return sendJson(res, 200, { text });
}
