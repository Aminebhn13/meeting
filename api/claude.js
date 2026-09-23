// api/claude.js — Vercel Edge Function (pas de cold start), réponse en SSE.
//
//   mode "ping"    — préchauffe la fonction, n'appelle pas Anthropic.
//   mode "live"    — analyse temps réel, modèle rapide. SSE delta… puis done :
//                    { answered:[{id,answer}], obsolete:[id], replaceNow:bool,
//                      ask:"", now:{question,why}, next:[{question}], later:[{question}] }
//   mode "digest"  — résumé roulant de la conversation (mémoire longue, appel de fond).
//   mode "summary" — bilan de fin de réunion, modèle principal.
//
// Le sujet de la réunion est obligatoire : c'est la référence de tout le reste.
// ANTHROPIC_API_KEY ne quitte jamais le serveur.

export const config = { runtime: 'edge' };

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MODEL_FAST = 'claude-haiku-4-5-20251001';

const MODES = ['ping', 'live', 'digest', 'summary'];
const MIN_TOPIC_CHARS = 10;

const MAX_TRANSCRIPT_SUMMARY = 60000;
const MAX_TRANSCRIPT_LIVE = 2500;    // seule la fin compte en temps réel
const MAX_TRANSCRIPT_DIGEST = 12000;
const MAX_LIST_ITEMS = 60;

const N_NOW = 1, N_NEXT = 4, N_LATER = 3;
const MAX_TOKENS_LIVE = 350;
const MAX_TOKENS_DIGEST = 300;
const MAX_TOKENS_SUMMARY = 3000;

/* ---------------------------------------------------------------- prompts -- */

// Bloc STABLE : identique à chaque appel d'un même mode → candidat au cache.
const STYLE_RULES = [
  "Tu es le copilote d'une personne en pleine visioconférence. Tu l'aides à mener la",
  'conversation face à son interlocuteur, en direct.',
  '',
  'La transcription provient d’une reconnaissance vocale automatique. Les interlocuteurs',
  'sont identifiés « Moi » (la personne que tu assistes) et « Client » (son interlocuteur).',
  'Un passage marqué [EN COURS] est une phrase encore en train d’être prononcée :',
  'anticipe où elle va et prépare la relance la plus pertinente sans attendre la fin.',
  '',
  'STYLE DES QUESTIONS — règles strictes :',
  '- 15 mots maximum. Langage parlé, tel qu’on le dit à voix haute.',
  '- Vouvoiement par défaut.',
  '- Rebondis sur les mots exacts du client quand c’est possible.',
  '  Exemple : « Vous parliez de migration, ça concerne combien de postes ? »',
  '- Pas de jargon inutile. Pas de question fermée quand une question ouverte',
  '  rapporte plus d’information.',
  '- Varie les amorces : « Et concrètement… », « Justement… », « Qu’est-ce qui… »,',
  '  « Comment… », « Sur quoi… ». N’utilise jamais deux fois la même amorce.',
  '- Ne reformule JAMAIS mot pour mot ce que le client vient de dire.',
  '',
  'Règles générales :',
  '- Réponds toujours en français.',
  "- Aucun préambule, aucune méta-phrase du type « Voici ».",
  "- N'invente jamais un fait, un chiffre, un nom ou une date absent de la transcription.",
  '- Respecte strictement le format demandé.'
].join('\n');

function topicBlock(topic) {
  return [
    'SUJET ET OBJECTIF DE LA RÉUNION — ta référence principale :',
    '"""',
    topic,
    '"""',
    '',
    "Tout ce que tu produis doit servir cet objectif. Une question n'a de valeur que si",
    'elle fait avancer ce sujet. Quand la conversation dérive, ignore la digression et',
    'ramène vers l’objectif.'
  ].join('\n');
}

/* ------------------------------------------------------------------ utils -- */

function clamp(text, max) {
  const t = typeof text === 'string' ? text.trim() : '';
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
    .slice(0, 12);
}

function buildLivePrompt({ transcript, digest, questions, answered }) {
  const parts = [];

  if (digest && digest.trim()) {
    parts.push('Mémoire de la réunion (résumé de ce qui a été dit jusqu’ici) :',
      digest.trim(), '');
  }

  const tr = clamp(transcript, MAX_TRANSCRIPT_LIVE);
  if (tr) {
    parts.push('Fin de la conversation, en direct :', '"""', tr, '"""', '');
  } else {
    parts.push("La réunion n'a pas encore commencé : aucune parole n'a été transcrite.",
      "Propose les questions d'ouverture qui serviront le mieux l'objectif.", '');
  }

  const active = questions;
  if (active.length) {
    parts.push("Questions actuellement affichées :",
      active.map((q) => `${q.id} : ${q.text}`).join('\n'), '');
  } else {
    parts.push("Aucune question n'est affichée pour l'instant.", '');
  }

  const done = cleanList(answered);
  if (done.length) {
    parts.push('Déjà traité — ne repropose pas :', done.map((q) => '- ' + q).join('\n'), '');
  }

  parts.push(
    'Produis :',
    '',
    '1. answered — pour chaque question affichée, si le client y a répondu (même sans',
    '   reprendre les mots, même posée par personne, même abordée spontanément).',
    '   Résume la réponse en UNE phrase factuelle. Une question effleurée sans',
    "   information concrète n'est pas répondue.",
    '',
    '2. obsolete — les questions qui ne servent plus l’objectif.',
    '',
    '3. ask — si le CLIENT vient de poser une question directe, recopie-la en une',
    '   phrase courte. Sinon chaîne vide.',
    '',
    `4. now — LA meilleure relance à dire tout de suite (1 question), avec « why » :`,
    '   8 mots maximum expliquant son intérêt. Exemple de why :',
    '   "Délai évoqué sans date — à verrouiller."',
    '',
    '5. replaceNow — true seulement si cette relance est nettement meilleure que celle',
    '   affichée, ou si celle-ci vient d’être répondue. false sinon : on évite de faire',
    '   clignoter l’écran.',
    '',
    `6. next — ${N_NEXT} relances alternatives ou suivantes (sans why).`,
    '',
    `7. later — ${N_LATER} questions pour amener les sujets de l’objectif pas encore`,
    '   traités (sans why).',
    '',
    'Aucun doublon entre les listes ni avec les questions affichées ou déjà traitées.',
    '',
    'Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, sans bloc de code :',
    '{"answered":[{"id":"","answer":""}],"obsolete":[],"ask":"","replaceNow":false,' +
      '"now":{"question":"","why":""},"next":[{"question":""}],"later":[{"question":""}]}'
  );
  return parts.join('\n');
}

function buildDigestPrompt({ transcript, previous }) {
  const parts = [];
  if (previous && previous.trim()) {
    parts.push('Résumé précédent :', previous.trim(), '');
  }
  parts.push(
    'Suite de la conversation :', '"""', clamp(transcript, MAX_TRANSCRIPT_DIGEST) || '(vide)', '"""', '',
    'Mets à jour le résumé de la réunion en 6 lignes maximum : ce qui a été dit, les',
    'chiffres et dates obtenus, les points encore ouverts. Style télégraphique.',
    "N'invente rien. Réponds par le résumé seul, sans titre ni préambule."
  );
  return parts.join('\n');
}

function buildSummaryPrompt({ transcript, qa, open }) {
  const parts = [
    'Transcription complète (horodatée [mm:ss], locuteurs identifiés Moi / Client) :',
    '"""', clamp(transcript, MAX_TRANSCRIPT_SUMMARY) || '(vide)', '"""', ''
  ];

  const pairs = Array.isArray(qa)
    ? qa.map((x) => (x && typeof x === 'object'
        ? { q: String(x.question || '').trim(), a: String(x.answer || '').trim() } : null))
        .filter((x) => x && x.q).slice(0, MAX_LIST_ITEMS)
    : [];
  if (pairs.length) {
    parts.push('Questions traitées, avec la réponse obtenue :',
      pairs.map((x) => `- ${x.q}\n  → ${x.a || 'non précisé'}`).join('\n'), '');
  }
  const openQ = cleanList(open);
  if (openQ.length) {
    parts.push('Questions encore ouvertes à la fin :', openQ.map((q) => '- ' + q).join('\n'), '');
  }

  parts.push(
    'Rédige le bilan complet en suivant EXACTEMENT la structure ci-dessous, titres inclus,',
    'en majuscules, sans rien ajouter avant ni après.',
    '',
    "N'invente rien. Si une information n'apparaît pas, écris « non précisé ».",
    'Attribue les propos à Moi ou au Client quand c’est utile.',
    '',
    'SUJET DE LA RÉUNION',
    '<rappel du sujet et de l’objectif, en une ou deux phrases>',
    '',
    'OBJECTIF ATTEINT ?',
    "<ce qui a été obtenu, puis ce qui manque. Sois franc : si l'objectif n'est pas",
    ' atteint, dis-le et dis ce qui bloque.>',
    '',
    'RÉSUMÉ',
    "<ce qui s'est dit, dans l'ordre chronologique, en paragraphes courts>",
    '',
    'POINTS CLÉS & INFORMATIONS OBTENUES',
    '- <chiffres, dates, noms, contraintes>',
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
    '- <question restée ouverte, sujet non tranché, risque>',
    '',
    'OÙ ON EN EST',
    "<l'étape actuelle, en une seule phrase>",
    '',
    'PROCHAINE ÉTAPE RECOMMANDÉE',
    '<1 à 3 phrases>'
  );
  return parts.join('\n');
}

/* ------------------------------------------------------------- extraction -- */

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
      if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

function oneQuestion(q) {
  if (typeof q === 'string') {
    const t = q.trim().replace(/^[-–•*]\s*/, '').replace(/^\d+[.)]\s*/, '');
    return t.length > 3 ? { question: t, why: '' } : null;
  }
  if (!q || typeof q !== 'object') return null;
  const question = String(q.question || q.text || '').trim();
  const why = String(q.why || '').trim();
  return question.length > 3 ? { question, why } : null;
}

function listOf(value, max) {
  return (Array.isArray(value) ? value : []).map(oneQuestion).filter(Boolean).slice(0, max);
}

function normalizeLive(parsed, validIds) {
  const empty = { answered: [], obsolete: [], ask: '', replaceNow: false, now: null, next: [], later: [] };
  if (!parsed || typeof parsed !== 'object') return empty;
  const ids = new Set(validIds);

  const answered = (Array.isArray(parsed.answered) ? parsed.answered : [])
    .map((a) => (a && typeof a === 'object'
      ? { id: String(a.id || '').trim(), answer: String(a.answer || '').trim() } : null))
    .filter((a) => a && a.id && a.answer && ids.has(a.id)).slice(0, 12);
  const answeredIds = new Set(answered.map((a) => a.id));

  const obsolete = (Array.isArray(parsed.obsolete) ? parsed.obsolete : [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && ids.has(id) && !answeredIds.has(id)).slice(0, 12);

  const now = oneQuestion(parsed.now);
  return {
    answered,
    obsolete,
    ask: String(parsed.ask || '').trim().slice(0, 200),
    replaceNow: parsed.replaceNow === true,
    now: now,
    next: listOf(parsed.next, N_NEXT),
    later: listOf(parsed.later, N_LATER)
  };
}

/* ------------------------------------------------------------------- http -- */

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function upstreamErrorMessage(status, detail, model) {
  const needsWorkspace = status === 400 && /anthropic-workspace-id/i.test(detail);
  const noCredit = /credit balance is too low/i.test(detail);
  const hint =
    noCredit ? ' — crédit API épuisé : rechargez le compte sur console.anthropic.com → Plans & Billing (compte séparé de l’abonnement Claude)' :
    needsWorkspace ? ' — votre clé n’est rattachée à aucun workspace : créez une clé dans un workspace, ou définissez ANTHROPIC_WORKSPACE_ID' :
    status === 401 ? ' (clé ANTHROPIC_API_KEY invalide ?)' :
    status === 429 ? ' (limite de débit atteinte)' :
    status === 404 ? ` (modèle « ${model} » introuvable ?)` : '';
  return (noCredit || needsWorkspace)
    ? `Erreur API Anthropic ${status}${hint}.`
    : `Erreur API Anthropic ${status}${hint} : ${detail}`;
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

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'Corps de requête JSON invalide.' }); }

  const { mode, topic, transcript, digest, questions, answered, qa, open, previous } = body || {};

  if (!mode || MODES.indexOf(mode) === -1) {
    return json(400, { error: 'Paramètre « mode » invalide : attendu "ping", "live", "digest" ou "summary".' });
  }

  // Préchauffage : on garde la fonction tiède sans dépenser un token.
  if (mode === 'ping') return json(200, { ok: true, at: Date.now() });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(500, {
      error: 'Configuration serveur incomplète : la variable d’environnement ANTHROPIC_API_KEY est absente.'
    });
  }

  const cleanTopic = typeof topic === 'string' ? topic.trim() : '';
  if (cleanTopic.length < MIN_TOPIC_CHARS) {
    return json(400, {
      error: `Sujet de la réunion obligatoire : décris le sujet et l’objectif (${MIN_TOPIC_CHARS} caractères minimum).`
    });
  }

  const isLive = mode === 'live';
  const isDigest = mode === 'digest';
  const activeQuestions = isLive ? cleanQuestions(questions) : [];

  const userPrompt = isLive
    ? buildLivePrompt({ transcript, digest, questions: activeQuestions, answered })
    : isDigest
      ? buildDigestPrompt({ transcript, previous })
      : buildSummaryPrompt({ transcript, qa, open });

  const model = (isLive || isDigest)
    ? (process.env.CLAUDE_MODEL_FAST || DEFAULT_MODEL_FAST)
    : (process.env.CLAUDE_MODEL || DEFAULT_MODEL);
  const maxTokens = isLive ? MAX_TOKENS_LIVE : isDigest ? MAX_TOKENS_DIGEST : MAX_TOKENS_SUMMARY;

  // Prompt caching : le préfixe stable (règles de style + sujet) est marqué.
  // Attention — le minimum cacheable dépend du modèle (4096 tokens sur Haiku 4.5) :
  // sous ce seuil, Anthropic ignore le marqueur sans erreur. On le pose quand même,
  // il s'activera dès que le préfixe sera assez gros.
  const system = [
    { type: 'text', text: STYLE_RULES, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: topicBlock(cleanTopic), cache_control: { type: 'ephemeral' } }
  ];

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
        system,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
  } catch (err) {
    return json(502, {
      error: 'Impossible de joindre l’API Anthropic : ' + (err && err.message ? err.message : 'erreur réseau')
    });
  }

  if (!upstream.ok) {
    const raw = await upstream.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { /* non JSON */ }
    const detail = (data && data.error && data.error.message) || raw.slice(0, 300) || 'aucun détail';
    return json(upstream.status, { error: upstreamErrorMessage(upstream.status, detail, model) });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'));
      };
      let full = '';
      let usage = null;
      try {
        const reader = upstream.body.getReader();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let evt = null;
            try { evt = JSON.parse(payload); } catch { continue; }
            if (evt.type === 'content_block_delta' && evt.delta && typeof evt.delta.text === 'string') {
              full += evt.delta.text;
              send('delta', { t: evt.delta.text });
            } else if (evt.type === 'message_start' && evt.message && evt.message.usage) {
              usage = evt.message.usage;
            } else if (evt.type === 'message_delta' && evt.usage) {
              usage = Object.assign({}, usage, evt.usage);
            } else if (evt.type === 'error' && evt.error) {
              send('error', { error: 'Erreur API Anthropic : ' + (evt.error.message || 'inconnue') });
            }
          }
        }
      } catch (err) {
        send('error', { error: 'Flux interrompu : ' + (err && err.message ? err.message : 'erreur réseau') });
      }

      // Diagnostic du cache : 0 en lecture = le préfixe est sous le minimum du modèle.
      if (usage) {
        send('usage', {
          cache_read: usage.cache_read_input_tokens || 0,
          cache_write: usage.cache_creation_input_tokens || 0,
          input: usage.input_tokens || 0
        });
      }

      if (isLive) send('done', normalizeLive(extractJson(full), activeQuestions.map((q) => q.id)));
      else send('done', { text: full.trim() });

      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
}
