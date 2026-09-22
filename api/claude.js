// api/claude.js — Vercel Serverless Function (Node 18+, ESM, fetch natif)
//
// Contrat d'entrée (POST, JSON) :
//   { mode: "questions" | "summary",
//     topic?: string,        // sujet de la réunion (optionnel)
//     transcript?: string,
//     proposed?: string[],   // questions déjà proposées — à ne pas répéter
//     asked?: string[] }     // questions déjà posées à voix haute
//
// Contrat de sortie :
//   200 -> { text: string }
//   4xx/5xx -> { error: string }
//
// La clé ANTHROPIC_API_KEY ne quitte jamais le serveur.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';

const MODES = ['questions', 'summary'];
const MAX_TRANSCRIPT_CHARS = 60000;
const MAX_LIST_ITEMS = 60;

const SYSTEM_PROMPT = [
  "Tu es le copilote d'une personne en pleine visioconférence. Tu l'aides à mener la conversation",
  "face à son interlocuteur, en direct.",
  "",
  "La transcription qui t'est fournie provient d'une reconnaissance vocale automatique imparfaite :",
  "erreurs de mots, coupures, ponctuation approximative, et aucune distinction entre les orateurs.",
  "Ne commente jamais ces défauts : interprète au mieux et raisonne sur le fond.",
  "",
  "Règles de réponse, sans exception :",
  "- Réponds toujours en français.",
  "- Sois concis et directement exploitable.",
  "- Aucun préambule, aucune formule de politesse, aucune méta-phrase du type « Voici » ou « Bien sûr ».",
  "- N'invente jamais un fait, un chiffre, un nom ou une date absent de la transcription.",
  "  Si une information manque, écris « non précisé ».",
  "- Respecte strictement le format demandé."
].join('\n');

function clampTranscript(transcript) {
  const t = typeof transcript === 'string' ? transcript.trim() : '';
  if (t.length <= MAX_TRANSCRIPT_CHARS) return t;
  return '[...début de la réunion tronqué...]\n' + t.slice(-MAX_TRANSCRIPT_CHARS);
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(-MAX_LIST_ITEMS);
}

function topicBlock(topic) {
  const t = (topic || '').trim();
  return t ? `Sujet de la réunion : ${t}` : 'Sujet de la réunion : non précisé';
}

function transcriptBlock(transcript) {
  const t = clampTranscript(transcript);
  if (!t) return "Transcription : (vide — la réunion vient de commencer)";
  return `Transcription (horodatée [mm:ss], reconnaissance vocale, orateurs non distingués) :\n"""\n${t}\n"""`;
}

function buildQuestionsPrompt({ topic, transcript, proposed, asked }) {
  const parts = [topicBlock(topic), '', transcriptBlock(transcript), ''];

  const prev = cleanList(proposed);
  if (prev.length) {
    parts.push(
      'Questions DÉJÀ PROPOSÉES — ne les répète pas, et ne propose pas de simples reformulations :',
      prev.map((q) => '- ' + q).join('\n'),
      ''
    );
  }
  const done = cleanList(asked);
  if (done.length) {
    parts.push(
      'Questions DÉJÀ POSÉES à voix haute — le sujet est couvert, passe à autre chose :',
      done.map((q) => '- ' + q).join('\n'),
      ''
    );
  }

  parts.push(
    "Propose 3 questions courtes et naturelles que je peux poser MAINTENANT à mon interlocuteur,",
    "en rebondissant sur ce qui vient d'être dit.",
    '',
    'Priorités, dans cet ordre :',
    '1. Clarifier les zones floues.',
    '2. Obtenir des chiffres, des délais, un budget, des responsables nommés.',
    '3. Faire émerger les risques et les dépendances.',
    '4. Faire avancer vers une décision.',
    '',
    'Contraintes :',
    "- Formulation parlée, telle que je la prononcerai. Une phrase, courte.",
    '- Ancrée dans ce qui vient réellement d’être dit. Aucune question générique.',
    '- Aucune question déjà répondue dans la transcription.',
    '',
    'Format : une question par ligne, exactement 3 lignes.',
    'Pas de numérotation, pas de tiret, pas de titre, rien d’autre.'
  );
  return parts.join('\n');
}

function buildSummaryPrompt({ topic, transcript, asked }) {
  const parts = [topicBlock(topic), '', transcriptBlock(transcript), ''];

  const done = cleanList(asked);
  if (done.length) {
    parts.push(
      'Questions que j’ai posées pendant la réunion :',
      done.map((q) => '- ' + q).join('\n'),
      ''
    );
  }

  parts.push(
    'Rédige le bilan complet de cette réunion en suivant EXACTEMENT la structure ci-dessous,',
    'titres inclus, en majuscules, sans rien ajouter avant ni après.',
    '',
    "N'invente rien. Si une information n'apparaît pas dans la transcription, écris « non précisé ».",
    'Si une section entière est vide, écris « non précisé » sous son titre.',
    '',
    'RÉSUMÉ',
    "<ce qui s'est dit, dans l'ordre chronologique, en paragraphes courts>",
    '',
    'POINTS CLÉS & INFORMATIONS OBTENUES',
    '- <chiffres, dates, noms, contraintes — un par ligne>',
    '',
    'DÉCISIONS PRISES',
    '- <décision réellement actée>',
    '',
    'ACTIONS À FAIRE',
    '- <qui> → <quoi> → <échéance>',
    '',
    'QUESTIONS RESTÉES SANS RÉPONSE / POINTS OUVERTS',
    '- <question soulevée sans réponse, sujet non tranché, dépendance, risque>',
    '',
    'OÙ ON EN EST',
    "<l'étape actuelle, en une seule phrase>",
    '',
    'PROCHAINE ÉTAPE RECOMMANDÉE',
    '<1 à 3 phrases : la prochaine action la plus utile, et pourquoi>'
  );
  return parts.join('\n');
}

function sendJson(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
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

  const { mode, topic, transcript, proposed, asked } = body || {};

  if (!mode || MODES.indexOf(mode) === -1) {
    return sendJson(res, 400, {
      error: 'Paramètre « mode » invalide : attendu "questions" ou "summary".'
    });
  }

  const userPrompt = mode === 'summary'
    ? buildSummaryPrompt({ topic, transcript, asked })
    : buildQuestionsPrompt({ topic, transcript, proposed, asked });

  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const maxTokens = mode === 'summary' ? 3000 : 500;

  // --- Appel de l'API Anthropic --------------------------------------------
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION
  };
  // Une clé créée au niveau de l'organisation n'est rattachée à aucun workspace :
  // Anthropic exige alors ce header. Sans la variable, on n'envoie rien.
  const workspaceId = (process.env.ANTHROPIC_WORKSPACE_ID || '').trim();
  if (workspaceId) headers['anthropic-workspace-id'] = workspaceId;

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers,
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
    const needsWorkspace = upstream.status === 400 && /anthropic-workspace-id/i.test(detail);
    const hint =
      needsWorkspace ? ' — votre clé n’est rattachée à aucun workspace : créez une clé dans un workspace, ou définissez la variable ANTHROPIC_WORKSPACE_ID' :
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
