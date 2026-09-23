// api/claude.js — Vercel Serverless Function (Node 18+, ESM, fetch natif)
//
// Deux modes, tous deux diffusés en SSE vers le front.
//
//   mode "live"    — analyse temps réel, modèle rapide.
//     Entrée : { topic, transcript, questions:[{id,text}], answered?:[string] }
//     SSE    : event delta {t}  … puis  event done
//              { answered:[{id,answer}], obsolete:[id], new:[{question,why}] }
//
//   mode "summary" — bilan de fin de réunion, modèle principal.
//     Entrée : { topic, transcript, qa?:[{question,answer,why}], open?:[string] }
//     SSE    : event delta {t}  … puis  event done { text }
//
// Le sujet de la réunion est obligatoire : c'est la référence de tout le reste.
// La clé ANTHROPIC_API_KEY ne quitte jamais le serveur.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MODEL_FAST = 'claude-haiku-4-5-20251001';

const MODES = ['live', 'summary'];
const MIN_TOPIC_CHARS = 10;
const MAX_TRANSCRIPT_SUMMARY = 60000;
const MAX_TRANSCRIPT_LIVE = 4000;
const MAX_LIST_ITEMS = 60;
const TARGET_QUESTIONS = 3;
const MAX_TOKENS_LIVE = 700;      // 3 questions + « pourquoi » + réponses
const MAX_TOKENS_SUMMARY = 3000;

function systemPrompt(topic) {
  return [
    "Tu es le copilote d'une personne en pleine visioconférence. Tu l'aides à mener la conversation",
    "face à son interlocuteur, en direct.",
    '',
    'SUJET ET OBJECTIF DE LA RÉUNION — ta référence principale :',
    '"""',
    topic,
    '"""',
    '',
    "Tout ce que tu produis doit servir cet objectif. Une question n'a de valeur que si elle fait",
    "avancer ce sujet. Quand la conversation dérive sur des points sans rapport, ignore la digression",
    'et ramène vers l’objectif.',
    '',
    "La transcription qui t'est fournie provient d'une reconnaissance vocale automatique imparfaite :",
    'erreurs de mots, coupures, ponctuation approximative, et aucune distinction entre les orateurs.',
    'Ne commente jamais ces défauts : interprète au mieux et raisonne sur le fond.',
    '',
    'Règles de réponse, sans exception :',
    '- Réponds toujours en français.',
    '- Sois concis et directement exploitable.',
    "- Aucun préambule, aucune formule de politesse, aucune méta-phrase du type « Voici ».",
    "- N'invente jamais un fait, un chiffre, un nom ou une date absent de la transcription.",
    '  Si une information manque, écris « non précisé ».',
    '- Respecte strictement le format demandé.'
  ].join('\n');
}

function clampTranscript(transcript, max) {
  const t = typeof transcript === 'string' ? transcript.trim() : '';
  if (t.length <= max) return t;
  return '[...début tronqué...]\n' + t.slice(-max);
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean).slice(-MAX_LIST_ITEMS);
}

function cleanQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((q) => (q && typeof q === 'object'
      ? { id: String(q.id || '').trim(), text: String(q.text || '').trim() } : null))
    .filter((q) => q && q.id && q.text)
    .slice(0, 20);
}

/* ------------------------------------------------------------------ live -- */

function buildLivePrompt({ transcript, questions, answered }) {
  const tr = clampTranscript(transcript, MAX_TRANSCRIPT_LIVE);
  const active = questions;
  const done = cleanList(answered);
  const parts = [];

  if (tr) {
    parts.push('Fin de la transcription (reconnaissance vocale, orateurs non distingués) :',
      '"""', tr, '"""', '');
  } else {
    parts.push("La réunion n'a pas encore commencé : aucune parole n'a été transcrite.",
      "Propose les questions d'ouverture qui serviront le mieux l'objectif ci-dessus.", '');
  }

  if (active.length) {
    parts.push("Questions actuellement affichées à l'écran :",
      active.map((q) => `${q.id} : ${q.text}`).join('\n'), '');
  } else {
    parts.push("Aucune question n'est affichée pour l'instant.", '');
  }

  if (done.length) {
    parts.push('Questions déjà traitées plus tôt — ne les repropose pas :',
      done.map((q) => '- ' + q).join('\n'), '');
  }

  parts.push(
    'Ta tâche, en trois temps :',
    '',
    "1. RÉPONDUES — pour chaque question affichée, détermine si l'interlocuteur y a répondu dans",
    '   cette portion de transcription. Compte comme répondue une réponse donnée même sans reprendre',
    "   les mots de la question, même si la personne que tu assistes n'a pas posé la question, et",
    '   même si le sujet a été abordé spontanément. Résume la réponse obtenue en UNE phrase',
    '   factuelle, tirée de la transcription. Une question simplement effleurée, sans information',
    "   concrète, n'est pas répondue.",
    '',
    '2. OBSOLÈTES — les questions qui ne servent plus l’objectif de la réunion, parce que la',
    '   conversation a tranché le point ou est passée à autre chose. Dans le doute, garde la question.',
    '',
    `3. NOUVELLES — de quoi revenir à exactement ${TARGET_QUESTIONS} questions à l'écran une fois les`,
    '   répondues et les obsolètes retirées. Chaque question : courte, naturelle, à poser maintenant,',
    "   au service de l'objectif de la réunion. Priorités : clarifier les zones floues, obtenir",
    '   chiffres, délais, budget et responsables, faire émerger risques et dépendances, faire avancer',
    '   vers une décision. Aucun doublon avec les questions affichées ou déjà traitées.',
    '',
    '   Pour chaque nouvelle question, ajoute un « why » : UNE phrase de 15 mots maximum expliquant',
    "   son intérêt stratégique, au regard de l'objectif et de ce qui vient d'être dit.",
    '   Exemple : "Il a évoqué un délai sans date précise — il faut le verrouiller."',
    '',
    'Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, sans bloc de code :',
    '{"answered":[{"id":"<id>","answer":"<réponse en une phrase>"}],' +
      '"obsolete":["<id>"],' +
      '"new":[{"question":"<question>","why":"<pourquoi, 15 mots max>"}]}',
    '',
    'Les trois clés sont obligatoires, même vides. Les id doivent être ceux fournis ci-dessus.'
  );
  return parts.join('\n');
}

// Extraction tolérante : bloc de code, texte autour, accolades dans les chaînes.
function extractJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* on continue */ }

  const start = s.indexOf('{');
  if (start === -1) return null;
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
          ? { id: String(a.id || '').trim(), answer: String(a.answer || '').trim() } : null))
        .filter((a) => a && a.id && a.answer && ids.has(a.id)).slice(0, 20)
    : [];
  const answeredIds = new Set(answered.map((a) => a.id));

  const obsolete = Array.isArray(parsed.obsolete)
    ? parsed.obsolete.map((id) => String(id || '').trim())
        .filter((id) => id && ids.has(id) && !answeredIds.has(id)).slice(0, 20)
    : [];

  const fresh = Array.isArray(parsed.new)
    ? parsed.new.map(normalizeNewQuestion).filter(Boolean).slice(0, 6)
    : [];

  return { answered, obsolete, new: fresh };
}

// Accepte {question, why} et, par tolérance, une simple chaîne.
function normalizeNewQuestion(q) {
  if (typeof q === 'string') {
    const t = q.trim().replace(/^[-–•*]\s*/, '').replace(/^\d+[.)]\s*/, '');
    return t.length > 3 ? { question: t, why: '' } : null;
  }
  if (!q || typeof q !== 'object') return null;
  const question = String(q.question || q.text || '').trim();
  const why = String(q.why || '').trim();
  return question.length > 3 ? { question, why } : null;
}

/* --------------------------------------------------------------- summary -- */

function buildSummaryPrompt({ topic, transcript, qa, open }) {
  const parts = [
    'Transcription complète (horodatée [mm:ss], reconnaissance vocale, orateurs non distingués) :',
    '"""',
    clampTranscript(transcript, MAX_TRANSCRIPT_SUMMARY) || '(vide)',
    '"""',
    ''
  ];

  const pairs = Array.isArray(qa)
    ? qa.map((x) => (x && typeof x === 'object'
        ? { q: String(x.question || '').trim(), a: String(x.answer || '').trim() } : null))
        .filter((x) => x && x.q).slice(0, MAX_LIST_ITEMS)
    : [];
  if (pairs.length) {
    parts.push('Questions traitées pendant la réunion, avec la réponse obtenue :',
      pairs.map((x) => `- ${x.q}\n  → ${x.a || 'non précisé'}`).join('\n'), '');
  }

  const openQ = cleanList(open);
  if (openQ.length) {
    parts.push('Questions encore ouvertes à la fin de la réunion :',
      openQ.map((q) => '- ' + q).join('\n'), '');
  }

  parts.push(
    'Rédige le bilan complet en suivant EXACTEMENT la structure ci-dessous, titres inclus,',
    'en majuscules, sans rien ajouter avant ni après.',
    '',
    "N'invente rien. Si une information n'apparaît pas dans la transcription, écris « non précisé ».",
    'Si une section entière est vide, écris « non précisé » sous son titre.',
    '',
    'SUJET DE LA RÉUNION',
    '<rappel du sujet et de l’objectif, en une ou deux phrases>',
    '',
    'OBJECTIF ATTEINT ?',
    "<ce qui a été obtenu par rapport à l'objectif, puis ce qui manque encore. Sois franc :",
    ' si l’objectif n’est pas atteint, dis-le et dis ce qui bloque.>',
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
    '',
    'QUESTIONS RESTÉES SANS RÉPONSE / POINTS OUVERTS',
    '- <question restée ouverte, sujet non tranché, dépendance, risque>',
    '',
    'OÙ ON EN EST',
    "<l'étape actuelle, en une seule phrase>",
    '',
    'PROCHAINE ÉTAPE RECOMMANDÉE',
    '<1 à 3 phrases : la prochaine action la plus utile, et pourquoi>'
  );
  return parts.join('\n');
}

/* ------------------------------------------------------------------ http -- */

function sendJson(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sse(res, event, data) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
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

function upstreamErrorMessage(status, detail, model) {
  const needsWorkspace = status === 400 && /anthropic-workspace-id/i.test(detail);
  const noCredit = /credit balance is too low/i.test(detail);
  const hint =
    noCredit ? ' — crédit API épuisé : rechargez le compte sur console.anthropic.com → Plans & Billing (compte séparé de l’abonnement Claude)' :
    needsWorkspace ? ' — votre clé n’est rattachée à aucun workspace : créez une clé dans un workspace, ou définissez la variable ANTHROPIC_WORKSPACE_ID' :
    status === 401 ? ' (clé ANTHROPIC_API_KEY invalide ?)' :
    status === 429 ? ' (limite de débit atteinte, réessayez dans quelques secondes)' :
    status === 404 ? ` (modèle « ${model} » introuvable ?)` : '';
  return (noCredit || needsWorkspace)
    ? `Erreur API Anthropic ${status}${hint}.`
    : `Erreur API Anthropic ${status}${hint} : ${detail}`;
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

  // Le sujet est la référence de tout : sans lui, on ne produit rien.
  const cleanTopic = typeof topic === 'string' ? topic.trim() : '';
  if (cleanTopic.length < MIN_TOPIC_CHARS) {
    return sendJson(res, 400, {
      error: `Sujet de la réunion obligatoire : décris le sujet et l’objectif (${MIN_TOPIC_CHARS} caractères minimum).`
    });
  }

  const isLive = mode === 'live';
  const activeQuestions = isLive ? cleanQuestions(questions) : [];
  const userPrompt = isLive
    ? buildLivePrompt({ transcript, questions: activeQuestions, answered })
    : buildSummaryPrompt({ topic: cleanTopic, transcript, qa, open });

  const model = isLive
    ? (process.env.CLAUDE_MODEL_FAST || DEFAULT_MODEL_FAST)
    : (process.env.CLAUDE_MODEL || DEFAULT_MODEL);
  const maxTokens = isLive ? MAX_TOKENS_LIVE : MAX_TOKENS_SUMMARY;

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
        stream: true,
        system: systemPrompt(cleanTopic),
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
  } catch (err) {
    return sendJson(res, 502, {
      error: 'Impossible de joindre l’API Anthropic : ' + (err && err.message ? err.message : 'erreur réseau')
    });
  }

  // Erreur avant tout octet diffusé : on répond en JSON classique.
  if (!upstream.ok) {
    const raw = await upstream.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { /* non JSON */ }
    const detail = (data && data.error && data.error.message) || raw.slice(0, 300) || 'aucun détail';
    return sendJson(res, upstream.status, { error: upstreamErrorMessage(upstream.status, detail, model) });
  }

  // À partir d'ici : réponse diffusée en SSE.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // pas de tampon intermédiaire

  let full = '';
  try {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();                       // ligne éventuellement incomplète
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt = null;
        try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.type === 'content_block_delta' && evt.delta && typeof evt.delta.text === 'string') {
          full += evt.delta.text;
          sse(res, 'delta', { t: evt.delta.text });
        } else if (evt.type === 'error' && evt.error) {
          sse(res, 'error', { error: 'Erreur API Anthropic : ' + (evt.error.message || 'inconnue') });
        }
      }
    }
  } catch (err) {
    sse(res, 'error', { error: 'Flux interrompu : ' + (err && err.message ? err.message : 'erreur réseau') });
  }

  // Événement final : la source de vérité, même si le flux a été mal découpé.
  if (isLive) {
    sse(res, 'done', normalizeLive(extractJson(full), activeQuestions.map((q) => q.id)));
  } else {
    sse(res, 'done', { text: full.trim() });
  }
  res.end();
}
