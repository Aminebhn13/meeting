// api/claude.js — Vercel Serverless Function (Node 18+, ESM, fetch natif)
//
// Deux modes :
//
//   mode "live"    — analyse temps réel, modèle rapide.
//     Entrée  : { topic?, transcript, questions: [{id, text}], answered?: string[] }
//     Sortie  : { answered:[{id,answer}], obsolete:[id], new:[texte] }
//               (toujours cette forme : en cas d'échec de parsing, listes vides)
//
//   mode "summary" — bilan de fin de réunion, modèle principal.
//     Entrée  : { topic?, transcript, qa?: [{question,answer}], open?: string[] }
//     Sortie  : { text }
//
// La clé ANTHROPIC_API_KEY ne quitte jamais le serveur.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MODEL_FAST = 'claude-haiku-4-5-20251001';

const MODES = ['live', 'summary'];
const MAX_TRANSCRIPT_SUMMARY = 60000;   // bilan : toute la réunion
const MAX_TRANSCRIPT_LIVE = 4000;       // temps réel : seulement la fin
const MAX_LIST_ITEMS = 60;
const TARGET_QUESTIONS = 3;

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

function clampTranscript(transcript, max) {
  const t = typeof transcript === 'string' ? transcript.trim() : '';
  if (t.length <= max) return t;
  return '[...début tronqué...]\n' + t.slice(-max);
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(-MAX_LIST_ITEMS);
}

function cleanQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((q) => (q && typeof q === 'object'
      ? { id: String(q.id || '').trim(), text: String(q.text || '').trim() }
      : null))
    .filter((q) => q && q.id && q.text)
    .slice(0, 20);
}

function topicLine(topic) {
  const t = (topic || '').trim();
  return t ? `Sujet de la réunion : ${t}` : 'Sujet de la réunion : non précisé';
}

/* ------------------------------------------------------------------ live -- */

function buildLivePrompt({ topic, transcript, questions, answered }) {
  const tr = clampTranscript(transcript, MAX_TRANSCRIPT_LIVE);
  const active = cleanQuestions(questions);
  const done = cleanList(answered);

  const parts = [
    topicLine(topic),
    '',
    'Fin de la transcription (reconnaissance vocale, orateurs non distingués) :',
    '"""',
    tr || '(vide)',
    '"""',
    ''
  ];

  if (active.length) {
    parts.push(
      "Questions actuellement affichées à l'écran :",
      active.map((q) => `${q.id} : ${q.text}`).join('\n'),
      ''
    );
  } else {
    parts.push("Aucune question n'est affichée pour l'instant.", '');
  }

  if (done.length) {
    parts.push(
      'Questions déjà traitées plus tôt — ne les repropose pas :',
      done.map((q) => '- ' + q).join('\n'),
      ''
    );
  }

  parts.push(
    'Ta tâche, en trois temps :',
    '',
    "1. RÉPONDUES — pour chaque question affichée, détermine si l'interlocuteur y a répondu",
    "   dans cette portion de transcription. Compte comme répondue une réponse donnée :",
    "   même sans reprendre les mots de la question, même si la personne que tu assistes n'a",
    "   pas posé la question, et même si le sujet a été abordé spontanément.",
    "   Résume la réponse obtenue en UNE phrase factuelle, tirée de la transcription.",
    "   Ne déclare pas répondue une question simplement effleurée sans information concrète.",
    '',
    '2. OBSOLÈTES — les questions devenues hors sujet parce que la conversation est passée',
    '   à autre chose. Uniquement celles-là : dans le doute, garde la question.',
    '',
    `3. NOUVELLES — propose autant de questions que nécessaire pour qu'il en reste exactement`,
    `   ${TARGET_QUESTIONS} à l'écran une fois les répondues et les obsolètes retirées.`,
    '   Questions courtes, naturelles, à poser maintenant, en rebondissant sur ce qui vient',
    "   d'être dit. Priorités : clarifier les zones floues, obtenir chiffres, délais, budget et",
    '   responsables, faire émerger risques et dépendances, faire avancer vers une décision.',
    '   Aucun doublon avec les questions affichées ou déjà traitées.',
    `   Si rien ne justifie une nouvelle question, renvoie une liste vide.`,
    '',
    'Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, sans bloc de code :',
    '{"answered":[{"id":"<id>","answer":"<réponse en une phrase>"}],"obsolete":["<id>"],"new":["<question>"]}',
    '',
    'Les trois clés sont obligatoires, même vides. Les id doivent être ceux fournis ci-dessus.'
  );
  return parts.join('\n');
}

// Extraction tolérante : bloc de code, texte autour, accolades déséquilibrées.
function extractJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try { return JSON.parse(s); } catch { /* on continue */ }

  const start = s.indexOf('{');
  if (start === -1) return null;

  // On cherche la fin réelle de l'objet, en ignorant les accolades dans les chaînes.
  let depth = 0, inStr = false, escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function normalizeLive(parsed, validIds) {
  const empty = { answered: [], obsolete: [], new: [] };
  if (!parsed || typeof parsed !== 'object') return empty;

  const ids = new Set(validIds);

  const answered = Array.isArray(parsed.answered)
    ? parsed.answered
        .map((a) => (a && typeof a === 'object'
          ? { id: String(a.id || '').trim(), answer: String(a.answer || '').trim() }
          : null))
        .filter((a) => a && a.id && a.answer && ids.has(a.id))
        .slice(0, 20)
    : [];

  const answeredIds = new Set(answered.map((a) => a.id));

  const obsolete = Array.isArray(parsed.obsolete)
    ? parsed.obsolete
        .map((id) => String(id || '').trim())
        .filter((id) => id && ids.has(id) && !answeredIds.has(id))
        .slice(0, 20)
    : [];

  const fresh = Array.isArray(parsed.new)
    ? parsed.new
        .map((q) => (typeof q === 'string' ? q.trim().replace(/^[-–•*]\s*/, '').replace(/^\d+[.)]\s*/, '') : ''))
        .filter((q) => q.length > 3)
        .slice(0, 6)
    : [];

  return { answered, obsolete, new: fresh };
}

/* --------------------------------------------------------------- summary -- */

function buildSummaryPrompt({ topic, transcript, qa, open }) {
  const parts = [
    topicLine(topic),
    '',
    'Transcription complète (horodatée [mm:ss], reconnaissance vocale, orateurs non distingués) :',
    '"""',
    clampTranscript(transcript, MAX_TRANSCRIPT_SUMMARY) || '(vide)',
    '"""',
    ''
  ];

  const pairs = Array.isArray(qa)
    ? qa.map((x) => (x && typeof x === 'object'
        ? { q: String(x.question || '').trim(), a: String(x.answer || '').trim() }
        : null)).filter((x) => x && x.q).slice(0, MAX_LIST_ITEMS)
    : [];

  if (pairs.length) {
    parts.push(
      'Questions traitées pendant la réunion, avec la réponse obtenue :',
      pairs.map((x) => `- ${x.q}\n  → ${x.a || 'non précisé'}`).join('\n'),
      ''
    );
  }

  const openQ = cleanList(open);
  if (openQ.length) {
    parts.push(
      'Questions encore ouvertes à la fin de la réunion :',
      openQ.map((q) => '- ' + q).join('\n'),
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
    'QUESTIONS & RÉPONSES OBTENUES',
    '- <question> → <réponse obtenue>',
    pairs.length
      ? '  Reprends ici les questions traitées listées plus haut, en reformulant la réponse à partir de la transcription.'
      : '  Si aucune question n’a été traitée, écris « non précisé ».',
    '',
    'QUESTIONS RESTÉES SANS RÉPONSE / POINTS OUVERTS',
    '- <question restée ouverte, sujet non tranché, dépendance, risque>',
    openQ.length
      ? '  Inclus les questions encore ouvertes listées plus haut, ainsi que tout autre point non tranché.'
      : '',
    '',
    'OÙ ON EN EST',
    "<l'étape actuelle, en une seule phrase>",
    '',
    'PROCHAINE ÉTAPE RECOMMANDÉE',
    '<1 à 3 phrases : la prochaine action la plus utile, et pourquoi>'
  );
  return parts.filter((l) => l !== '').join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ------------------------------------------------------------------ http -- */

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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Méthode non autorisée : utilisez POST.' });
  }

  const appPassword = process.env.APP_PASSWORD;
  if (appPassword) {
    const provided = req.headers['x-app-password'];
    if (!provided || provided !== appPassword) {
      return sendJson(res, 401, { error: 'Mot de passe de l’application invalide ou manquant.' });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Configuration serveur incomplète : la variable d’environnement ANTHROPIC_API_KEY est absente.'
    });
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return sendJson(res, 400, { error: err.message }); }

  const { mode, topic, transcript, questions, answered, qa, open } = body || {};

  if (!mode || MODES.indexOf(mode) === -1) {
    return sendJson(res, 400, { error: 'Paramètre « mode » invalide : attendu "live" ou "summary".' });
  }

  const isLive = mode === 'live';
  const activeQuestions = isLive ? cleanQuestions(questions) : [];

  const userPrompt = isLive
    ? buildLivePrompt({ topic, transcript, questions: activeQuestions, answered })
    : buildSummaryPrompt({ topic, transcript, qa, open });

  const model = isLive
    ? (process.env.CLAUDE_MODEL_FAST || DEFAULT_MODEL_FAST)
    : (process.env.CLAUDE_MODEL || DEFAULT_MODEL);
  const maxTokens = isLive ? 400 : 3000;

  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION
  };
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
    const noCredit = /credit balance is too low/i.test(detail);
    const hint =
      noCredit ? ' — crédit API épuisé : rechargez le compte sur console.anthropic.com → Plans & Billing (compte séparé de l’abonnement Claude)' :
      needsWorkspace ? ' — votre clé n’est rattachée à aucun workspace : créez une clé dans un workspace, ou définissez la variable ANTHROPIC_WORKSPACE_ID' :
      upstream.status === 401 ? ' (clé ANTHROPIC_API_KEY invalide ?)' :
      upstream.status === 429 ? ' (limite de débit atteinte, réessayez dans quelques secondes)' :
      upstream.status === 404 ? ` (modèle « ${model} » introuvable ?)` : '';
    const message = (noCredit || needsWorkspace)
      ? `Erreur API Anthropic ${upstream.status}${hint}.`
      : `Erreur API Anthropic ${upstream.status}${hint} : ${detail}`;
    return sendJson(res, upstream.status, { error: message });
  }

  const text = Array.isArray(data && data.content)
    ? data.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim()
    : '';

  if (isLive) {
    // Parsing tolérant : un échec ne doit jamais casser l'affichage en réunion.
    const parsed = extractJson(text);
    return sendJson(res, 200, normalizeLive(parsed, activeQuestions.map((q) => q.id)));
  }

  if (!text) return sendJson(res, 502, { error: 'Réponse vide reçue de l’API Anthropic.' });
  return sendJson(res, 200, { text });
}
