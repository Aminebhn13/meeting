// api/claude.js — Vercel Edge Function, réponses en SSE.
//
// Modes :
//   ping     — préchauffe, n'appelle pas Anthropic.
//   plan     — répartition en minutes ; la somme vaut EXACTEMENT la durée choisie.
//   prepare  — CLAUDE_MODEL (sonnet), en fond : faits, file de questions, résumé roulant.
//   select   — CLAUDE_MODEL_FAST (haiku), à chaque fin de tour client : prochaine intervention.
//   summary  — compte rendu de fin d'appel.
//
// RÈGLE BLOQUANTE : tant que la phase d'introduction n'est pas terminée, aucune
// intervention n'est renvoyée. L'enforcement est fait ici, côté serveur, et ne
// dépend pas de la docilité du modèle.

export const config = { runtime: 'edge' };

import { REFERENTIEL_CONDENSE, EXEMPLES_METHODE, CADRE_JURIDIQUE, REFERENTIEL_VERSION }
  from './prompts/referentiel-condense.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MODEL_FAST = 'claude-haiku-4-5-20251001';

const MODES = ['ping', 'plan', 'prepare', 'select', 'summary'];
const DURATIONS = [20, 30, 45, 60, 90, 120];
const CATEGORIES = ['strategique', 'juridique', 'financier'];
const PHASE_KEYS = ['introduction', 'strategie', 'juridique', 'financier', 'synthese'];

const MAX_CONTEXT_CHARS = 4000;
const MAX_TRANSCRIPT_SELECT = 3000;
const MAX_TRANSCRIPT_PREPARE = 14000;
const MAX_TRANSCRIPT_SUMMARY = 80000;

const MAX_TOKENS = { plan: 1400, prepare: 1600, select: 1300, summary: 4000 };

/* ------------------------------------------------------------- prompts ---- */

function societeBlock(societe, fiche, regles) {
  const c = CADRE_JURIDIQUE[societe === 'ADM' ? 'ADM' : 'PWM'];
  const out = [
    '## SOCIÉTÉ REPRÉSENTÉE SUR CET APPEL',
    c.nom + ' — cadre juridique de départ : ' + c.cadre + '.',
    c.note,
    ''
  ];
  const f = (fiche || '').trim();
  out.push('### Fiche institutionnelle validée');
  out.push(f
    ? f
    : "AUCUNE fiche institutionnelle n'est renseignée. Tu ne peux donc PAS aider l'advisor à " +
      "présenter la société, ni répondre à une question du client sur l'entité. Dans ce cas, " +
      "propose une formulation qui renvoie la précision à une confirmation ultérieure.");
  out.push('');
  const r = (regles || '').trim();
  out.push('### Règles validées (sourcées et datées)');
  out.push(r
    ? r
    : "AUCUNE règle validée n'est renseignée. Toute question portant sur un taux, un délai, des " +
      "frais, un critère ou une condition DOIT recevoir une formulation « à confirmer », sans " +
      'aucun chiffre ni engagement.');
  return out.join('\n');
}

function systemBlocks({ societe, fiche, regles, contexte, scenario, plan }) {
  // Bloc 1 — STABLE entre tous les appels : cible principale du cache.
  const stable = [REFERENTIEL_CONDENSE, '', EXEMPLES_METHODE].join('\n');

  // Bloc 2 — stable pour la durée de l'appel : société, règles, dossier, plan.
  const dossier = [
    societeBlock(societe, fiche, regles),
    '',
    '## SCÉNARIO ENVISAGÉ',
    scenario || 'À confirmer',
    '',
    '## CONTEXTE DU DOSSIER (saisi par l’advisor avant l’appel)',
    (contexte || '').trim().slice(0, MAX_CONTEXT_CHARS) || 'non précisé'
  ];
  if (plan && plan.phases && plan.phases.length) {
    dossier.push('', '## PLAN DE L’APPEL',
      plan.phases.map((p) => `- ${p.label} : ${p.minutes} min — ${p.focus || ''}`.trim()).join('\n'));
  }
  return [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dossier.join('\n'), cache_control: { type: 'ephemeral' } }
  ];
}

function clamp(text, max) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length <= max) return t;
  return '[...début tronqué...]\n' + t.slice(-max);
}

/* --------------------------------------------------------------- plan ----- */

function buildPlanPrompt({ duree, contexte, documents }) {
  return [
    `Durée totale de l'appel : ${duree} minutes.`,
    '',
    documents ? 'Documents déjà disponibles :\n' + clamp(documents, 2000) + '\n' : '',
    'Établis le plan de cet appel en répartissant le temps entre cinq phases :',
    'introduction, strategie, juridique, financier, synthese.',
    '',
    "Adapte la répartition au dossier : si une information est déjà connue, réduis la phase",
    'correspondante ; si un axe est déterminant ou inconnu, allonge-le.',
    '',
    `Prépare aussi une RÉSERVE de sujets d'approfondissement proportionnée à la durée : un appel`,
    `de 20 minutes en demande peu, un appel de 120 minutes en demande beaucoup plus. Vise environ`,
    `une entrée de réserve par tranche de 4 minutes d'entretien.`,
    '',
    'Chaque entrée de réserve : un sujet précis à creuser, sa catégorie',
    '(strategique | juridique | financier) et en une phrase pourquoi il compte pour ce dossier.',
    '',
    'Réponds UNIQUEMENT par un objet JSON valide, sans texte autour :',
    '{"phases":[{"key":"introduction","label":"Introduction","minutes":0,"focus":""}],',
    ' "reserve":[{"sujet":"","categorie":"strategique","pourquoi":""}]}'
  ].filter(Boolean).join('\n');
}

// La somme DOIT valoir exactement la durée : on ne laisse pas l'arithmétique au modèle.
function normalizePlan(parsed, duree) {
  const defaults = { introduction: 0.15, strategie: 0.3, juridique: 0.2, financier: 0.25, synthese: 0.1 };
  const raw = {};
  PHASE_KEYS.forEach((k) => { raw[k] = defaults[k] * duree; });

  const labels = {
    introduction: 'Introduction', strategie: 'Stratégie', juridique: 'Juridique',
    financier: 'Financier', synthese: 'Synthèse et prochaines étapes'
  };
  const focus = {};

  if (parsed && Array.isArray(parsed.phases)) {
    let any = false;
    parsed.phases.forEach((p) => {
      if (!p || typeof p !== 'object') return;
      const k = String(p.key || '').trim().toLowerCase();
      if (PHASE_KEYS.indexOf(k) === -1) return;
      const m = Number(p.minutes);
      if (isFinite(m) && m >= 0) { raw[k] = m; any = true; }
      if (p.focus) focus[k] = String(p.focus).trim().slice(0, 200);
      if (p.label) labels[k] = String(p.label).trim().slice(0, 40);
    });
    if (!any) PHASE_KEYS.forEach((k) => { raw[k] = defaults[k] * duree; });
  }

  // Bornes de bon sens : un modèle qui renvoie « introduction : 99 min » ne doit
  // pas produire un plan inutilisable. Somme des minimums = 50 % de la durée,
  // somme des maximums = 160 % : la cible de 100 % est toujours atteignable.
  const BOUNDS = {
    introduction: [0.05, 0.20], strategie: [0.15, 0.45], juridique: [0.10, 0.35],
    financier: [0.15, 0.40], synthese: [0.05, 0.20]
  };

  // Mettre à l'échelle puis borner repousse la valeur hors borne : on itère en
  // redistribuant l'excédent sur les seules phases qui ne butent pas.
  const vals = {};
  PHASE_KEYS.forEach((k) => { vals[k] = Math.max(0.01, raw[k]); });
  for (let iter = 0; iter < 8; iter++) {
    const tot = PHASE_KEYS.reduce((n, k) => n + vals[k], 0) || 1;
    PHASE_KEYS.forEach((k) => { vals[k] = (vals[k] / tot) * duree; });
    let excess = 0;
    const free = [];
    PHASE_KEYS.forEach((k) => {
      const lo = BOUNDS[k][0] * duree, hi = BOUNDS[k][1] * duree;
      if (vals[k] > hi) { excess += vals[k] - hi; vals[k] = hi; }
      else if (vals[k] < lo) { excess -= lo - vals[k]; vals[k] = lo; }
      else free.push(k);
    });
    if (Math.abs(excess) < 0.001 || !free.length) break;
    const freeTot = free.reduce((n, k) => n + vals[k], 0) || 1;
    free.forEach((k) => { vals[k] += excess * (vals[k] / freeTot); });
  }

  const floored = {};
  let used = 0;
  PHASE_KEYS.forEach((k) => { floored[k] = Math.max(1, Math.floor(vals[k])); used += floored[k]; });

  // Le reste va aux plus fortes parties décimales, en respectant les maximums.
  let remainder = duree - used;
  const byFrac = PHASE_KEYS.slice().sort((a, b) => (vals[b] - Math.floor(vals[b])) - (vals[a] - Math.floor(vals[a])));
  let guard = 0;
  while (remainder > 0 && guard < 1000) {
    let placed = false;
    for (const k of byFrac) {
      if (remainder <= 0) break;
      if (floored[k] < Math.ceil(BOUNDS[k][1] * duree)) { floored[k] += 1; remainder--; placed = true; }
    }
    if (!placed) { floored[byFrac[0]] += 1; remainder--; }
    guard++;
  }
  while (remainder < 0) {
    const big = PHASE_KEYS.slice().sort((a, b) => floored[b] - floored[a]);
    let done = false;
    for (const k of big) { if (floored[k] > 1) { floored[k] -= 1; remainder++; done = true; break; } }
    if (!done) break;
  }

  const phases = PHASE_KEYS.map((k) => ({
    key: k, label: labels[k], minutes: floored[k], focus: focus[k] || ''
  }));

  const reserve = (parsed && Array.isArray(parsed.reserve) ? parsed.reserve : [])
    .map((r) => (r && typeof r === 'object' ? {
      sujet: String(r.sujet || '').trim(),
      categorie: CATEGORIES.indexOf(String(r.categorie || '').toLowerCase()) !== -1
        ? String(r.categorie).toLowerCase() : 'strategique',
      pourquoi: String(r.pourquoi || '').trim()
    } : null))
    .filter((r) => r && r.sujet.length > 3)
    .slice(0, 60);

  return { duree, total: phases.reduce((n, p) => n + p.minutes, 0), phases, reserve };
}

/* -------------------------------------------------------------- select ---- */

function buildSelectPrompt({ transcript, resume, faits, questions, categorie, temps, introState, clientQuestion }) {
  const parts = [];

  parts.push('## ÉTAT DE L’APPEL');
  parts.push(`Phase d'introduction : présentation de l'advisor ${introState && introState.advisorPresented ? 'FAITE' : 'PAS ENCORE FAITE'}, ` +
    `description du client ${introState && introState.clientDescribed ? 'FAITE' : 'PAS ENCORE FAITE'}.`);
  if (temps) {
    parts.push(`Temps écoulé : ${temps.elapsed} min sur ${temps.total} min. Phase du plan : ${temps.phase || 'non précisée'}.`);
  }
  parts.push(`Catégorie active : ${categorie || 'strategique'}.`);
  parts.push('');

  if (resume) { parts.push('## MÉMOIRE DE L’APPEL', resume.trim(), ''); }

  if (Array.isArray(faits) && faits.length) {
    parts.push('## FAITS DÉJÀ RETENUS (ne pas les redemander)',
      faits.slice(-40).map((f) => `- [${f.categorie || '?'}] ${f.valeur} (${f.locuteur || '?'}, ${f.certitude || 'déclaré'})`).join('\n'), '');
  }

  if (Array.isArray(questions) && questions.length) {
    parts.push('## FILE DE QUESTIONS PRÉPARÉES',
      questions.slice(0, 20).map((q) => `${q.id} [${q.statut || 'préparée'}] (${q.categorie || '?'}) ${q.texte}`).join('\n'), '');
  }

  parts.push('## TRANSCRIPTION RÉCENTE', '"""', clamp(transcript, MAX_TRANSCRIPT_SELECT) || '(vide)', '"""', '');

  if (clientQuestion) {
    parts.push('Le client vient de poser cette question : « ' + clientQuestion + ' ». Elle est prioritaire.', '');
  }

  parts.push(
    '## TA TÂCHE',
    '',
    "1. PHASE. L'introduction est terminée seulement quand l'advisor a présenté la société ET",
    "   que le client a décrit son parcours, son activité, son projet et son besoin.",
    '   Tant que ce n\'est pas le cas : phase = "intro".',
    '',
    '2. STATUTS. posedId : la question que l\'advisor a RÉELLEMENT prononcée (formulation',
    '   équivalente dans son tour de parole), sinon null. resolvedIds : questions dont la réponse',
    "   du client est suffisante, MÊME si elles n'ont jamais été posées (réponse spontanée).",
    "   partialIds : réponse amorcée mais insuffisante. Le simple affichage d'une question ne la",
    '   rend JAMAIS posée.',
    '',
    '3. INTERVENTION — c\'est ton livrable principal.',
    '   • Si phase = "intro" : intervention = null, sans exception.',
    '   • Si phase = "questions" : tu DOIS proposer une intervention. « null » est INTERDIT.',
    '     Une phrase à prononcer telle quelle, à la première personne, vouvoiement, 15 mots',
    "     environ, appuyée sur un propos réellement tenu par le client. Remplis l'objectif, la",
    '     citation source avec son horodatage, ce qui est à préciser, et 2 suites possibles.',
    '',
    "4. STALE. Si une correction du client rend l'intervention actuellement affichée inexacte,",
    '   staleCurrent = true.',
    '',
    '5. CONTEXTE CAPTÉ. Uniquement si phase = "intro" : ce que le client dit de lui (parcours,',
    '   activité, projet, besoin, montant, calendrier). Sinon {}.',
    '',
    '6. FAITS. Les informations NOUVELLES et utiles, 5 au maximum. Pour chacune : valeur,',
    '   catégorie, locuteur (advisor|client|incertain), citation fidèle de 20 mots maximum,',
    '   certitude (déclaré|corrigé|incertain). Tout montant, nom ou date reste « à confirmer ».',
    "   Si le client s'est corrigé, retiens la valeur CORRIGÉE avec certitude=\"corrigé\".",
    '   Ne répète jamais un fait déjà retenu.',
    '',
    'Sois bref : une réponse tronquée est inutilisable. L\'intervention passe avant les faits.',
    '',
    'Réponds UNIQUEMENT par un objet JSON valide, sans texte autour. Respecte CET ordre de clés,',
    "l'intervention devant les faits :",
    '{"phase":"intro|questions",',
    ' "intro":{"advisorPresented":false,"clientDescribed":false},',
    ' "posedId":null,"resolvedIds":[],"partialIds":[],"staleCurrent":false,',
    ' "intervention":{"texte":"","type":"question|relance|reformulation|réponse|transition|synthèse",',
    '   "categorie":"strategique","objectif":"","sourceCitation":"","sourceHorodatage":"",',
    '   "aPreciser":"","pieceAttendue":"","suites":[{"si":"","alors":""}]},',
    ' "contexte":{},',
    ' "facts":[{"valeur":"","categorie":"strategique|juridique|financier","locuteur":"client",',
    '           "citation":"","certitude":"déclaré"}]}'
  );
  return parts.join('\n');
}

/* ------------------------------------------------------------- prepare ---- */

function buildPreparePrompt({ transcript, resume, faits, questions, categorie, reserve }) {
  const parts = [];
  if (resume) parts.push('## RÉSUMÉ PRÉCÉDENT', resume.trim(), '');
  if (Array.isArray(faits) && faits.length) {
    parts.push('## FAITS DÉJÀ RETENUS',
      faits.slice(-60).map((f) => `- [${f.categorie || '?'}] ${f.valeur}`).join('\n'), '');
  }
  if (Array.isArray(questions) && questions.length) {
    parts.push('## FILE ACTUELLE',
      questions.slice(0, 25).map((q) => `${q.id} [${q.statut || 'préparée'}] ${q.texte}`).join('\n'), '');
  }
  if (Array.isArray(reserve) && reserve.length) {
    parts.push('## RÉSERVE DE SUJETS (issue du plan)',
      reserve.slice(0, 30).map((r) => `- (${r.categorie}) ${r.sujet}`).join('\n'), '');
  }
  parts.push('## TRANSCRIPTION', '"""', clamp(transcript, MAX_TRANSCRIPT_PREPARE) || '(vide)', '"""', '');
  parts.push(
    `Catégorie active : ${categorie || 'strategique'}.`,
    '',
    'Mets à jour, en arrière-plan :',
    '1. resume — mémoire roulante de l\'appel en 8 lignes maximum, style télégraphique.',
    '2. queue — la file des prochaines questions utiles (8 à 14), chacune avec son objectif, sa',
    '   catégorie, la pièce éventuellement attendue et 2 à 3 branches de suite selon la réponse.',
    '   Retire celles dont la réponse est déjà obtenue. Respecte la priorité : question du client,',
    '   contradictions, informations déterminantes manquantes, puis approfondissements.',
    '3. contradictions — écarts entre deux propos, ou entre un propos et un document, avec la',
    '   formulation factuelle et respectueuse qui permettrait de clarifier.',
    '4. pieces — pièces à demander, avec leur statut.',
    '',
    'Réponds UNIQUEMENT par un objet JSON valide :',
    '{"resume":"","queue":[{"texte":"","categorie":"strategique","objectif":"","pieceAttendue":"",',
    '  "suites":[{"si":"","alors":""}]}],',
    ' "contradictions":[{"constat":"","formulation":""}],',
    ' "pieces":[{"libelle":"","statut":"manquant"}]}'
  );
  return parts.join('\n');
}

/* ------------------------------------------------------------- summary ---- */

function buildSummaryPrompt({ transcript, faits, questions, resume, temps, scenario }) {
  const parts = [
    '## TRANSCRIPTION COMPLÈTE (locuteurs identifiés)',
    '"""', clamp(transcript, MAX_TRANSCRIPT_SUMMARY) || '(vide)', '"""', ''
  ];
  if (resume) parts.push('## MÉMOIRE DE L’APPEL', resume.trim(), '');
  if (Array.isArray(faits) && faits.length) {
    parts.push('## FAITS RETENUS PENDANT L’APPEL',
      faits.map((f) => `- [${f.categorie || '?'}] ${f.valeur} — ${f.locuteur || '?'}, ${f.certitude || 'déclaré'}` +
        (f.citation ? ` — « ${f.citation} »` : '')).join('\n'), '');
  }
  if (Array.isArray(questions) && questions.length) {
    const posees = questions.filter((q) => q.statut === 'posée' || q.statut === 'résolue' || q.statut === 'partielle');
    const ouvertes = questions.filter((q) => q.statut === 'reportée' || q.statut === 'préparée' || q.statut === 'affichée');
    if (posees.length) parts.push('## QUESTIONS RÉELLEMENT POSÉES OU RÉSOLUES',
      posees.map((q) => `- [${q.statut}] ${q.texte}`).join('\n'), '');
    if (ouvertes.length) parts.push('## QUESTIONS PRÉPARÉES MAIS JAMAIS POSÉES (ne PAS les présenter comme un échange réel)',
      ouvertes.map((q) => `- ${q.texte}`).join('\n'), '');
  }
  if (temps) parts.push(`Durée effective : ${temps.elapsed} min sur ${temps.total} min prévues.`, '');
  parts.push(`Scénario envisagé : ${scenario || 'À confirmer'}.`, '');

  parts.push(
    'Rédige le compte rendu de cet appel en suivant EXACTEMENT la structure ci-dessous, titres',
    'inclus, en majuscules, sans rien ajouter avant ni après.',
    '',
    "Règles absolues : n'écris QUE ce qui a été réellement dit. Une question préparée mais jamais",
    "posée n'apparaît PAS comme un échange. Aucun taux, délai, frais ni garantie inventé. Aucune",
    'décision de qualification proposée comme acquise. Si une information manque : « non précisé ».',
    '',
    'COMPTE RENDU',
    "<ce qui s'est dit, chronologiquement, en attribuant advisor / client>",
    '',
    'INFORMATIONS RECUEILLIES — STRATÉGIE',
    '- <information> — source : <advisor|client|document> — certitude : <déclaré|corrigé|incertain>',
    '',
    'INFORMATIONS RECUEILLIES — JURIDIQUE',
    '- <idem>',
    '',
    'INFORMATIONS RECUEILLIES — FINANCIER',
    '- <idem>',
    '',
    'CORRECTIONS SENSIBLES À CONFIRMER',
    '- <montant, nom ou date> — extrait : « <citation> »',
    '',
    'CONTRADICTIONS ET POINTS À CLARIFIER',
    '- <constat factuel, sans jugement sur la sincérité>',
    '',
    'QUESTIONS POSÉES ET RÉPONSES',
    '- <question réellement posée> → <réponse obtenue>',
    '',
    'POINTS OUVERTS ET REPORTÉS',
    '- <point> → <suite à lui donner>',
    '',
    'PIÈCES À DEMANDER',
    '- <pièce> — statut : <reçu|manquant|non applicable (motif)|à clarifier>',
    '',
    'ACTIONS',
    '- <responsable> → <action> → <échéance>',
    '',
    'POSITION DANS LA CHRONOLOGIE',
    '<repère atteint parmi les 16, et prochaine étape proposée>',
    '',
    'ORIENTATION DE SCÉNARIO',
    "<orientation proposée et justifiée, ou « orientation à confirmer » si les critères manquent>",
    '',
    'MENTION',
    'Ce compte rendu ne constitue ni une décision de qualification ni un accord de financement.'
  );
  return parts.join('\n');
}

/* ---------------------------------------------------------- extraction ---- */

// Un flux coupé net (max_tokens atteint) laisse un JSON inachevé. Plutôt que de
// tout perdre, on revient au dernier élément complet et on referme les structures.
function repairJson(s) {
  let inStr = false, esc = false, lastSafe = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '}' || c === ']') lastSafe = i;
  }
  if (lastSafe === -1) return null;
  let head = s.slice(0, lastSafe + 1).replace(/,\s*$/, '');
  const open = [];
  inStr = false; esc = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') open.push('}'); else if (c === '[') open.push(']');
    else if (c === '}' || c === ']') open.pop();
  }
  while (open.length) head += open.pop();
  try { return JSON.parse(head); } catch { return null; }
}

function extractJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  else { const openFence = s.match(/```(?:json)?\s*([\s\S]*)$/i); if (openFence) s = openFence[1].trim(); }
  try { return JSON.parse(s); } catch { /* on continue */ }
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return repairJson(s.slice(start)); } } }
  }
  return repairJson(s.slice(start));   // flux coupé avant la fermeture
}

const str = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max || 500);

function normalizeSelect(parsed, validIds) {
  const empty = {
    phase: 'intro',
    intro: { advisorPresented: false, clientDescribed: false },
    contexte: null, facts: [], posedId: null, resolvedIds: [], partialIds: [],
    staleCurrent: false, intervention: null
  };
  if (!parsed || typeof parsed !== 'object') return empty;

  const intro = parsed.intro && typeof parsed.intro === 'object' ? parsed.intro : {};
  const advisorPresented = intro.advisorPresented === true;
  const clientDescribed = intro.clientDescribed === true;

  // ── RÈGLE BLOQUANTE ────────────────────────────────────────────────────────
  // L'introduction n'est terminée que si les DEUX présentations sont faites.
  // Le modèle ne peut pas contourner cette règle en annonçant « questions ».
  const introDone = advisorPresented && clientDescribed;
  const phase = introDone ? 'questions' : 'intro';

  const ids = new Set(validIds || []);
  const idList = (v) => (Array.isArray(v) ? v : [])
    .map((x) => str(x, 40)).filter((x) => x && ids.has(x)).slice(0, 20);

  const facts = (Array.isArray(parsed.facts) ? parsed.facts : [])
    .map((f) => (f && typeof f === 'object' ? {
      valeur: str(f.valeur, 300),
      categorie: CATEGORIES.indexOf(str(f.categorie, 20).toLowerCase()) !== -1
        ? str(f.categorie, 20).toLowerCase() : 'strategique',
      locuteur: ['advisor', 'client', 'incertain', 'document'].indexOf(str(f.locuteur, 20)) !== -1
        ? str(f.locuteur, 20) : 'incertain',
      citation: str(f.citation, 400),
      certitude: ['déclaré', 'corrigé', 'incertain', 'documenté'].indexOf(str(f.certitude, 20)) !== -1
        ? str(f.certitude, 20) : 'déclaré'
    } : null))
    .filter((f) => f && f.valeur.length > 2).slice(0, 25);

  let contexte = null;
  if (parsed.contexte && typeof parsed.contexte === 'object') {
    contexte = {};
    ['parcours', 'activite', 'projet', 'besoin', 'montant', 'calendrier'].forEach((k) => {
      const v = str(parsed.contexte[k], 400);
      if (v) contexte[k] = v;
    });
    if (!Object.keys(contexte).length) contexte = null;
  }

  let intervention = null;
  const iv = parsed.intervention;
  if (phase === 'questions' && iv && typeof iv === 'object' && str(iv.texte, 600).length > 10) {
    intervention = {
      texte: str(iv.texte, 600),
      type: ['question', 'relance', 'reformulation', 'réponse', 'transition', 'synthèse']
        .indexOf(str(iv.type, 20)) !== -1 ? str(iv.type, 20) : 'question',
      categorie: CATEGORIES.indexOf(str(iv.categorie, 20).toLowerCase()) !== -1
        ? str(iv.categorie, 20).toLowerCase() : 'strategique',
      objectif: str(iv.objectif, 300),
      sourceCitation: str(iv.sourceCitation, 400),
      sourceHorodatage: str(iv.sourceHorodatage, 20),
      aPreciser: str(iv.aPreciser, 300),
      pieceAttendue: str(iv.pieceAttendue, 200),
      suites: (Array.isArray(iv.suites) ? iv.suites : [])
        .map((s) => (s && typeof s === 'object'
          ? { si: str(s.si, 200), alors: str(s.alors, 300) } : null))
        .filter((s) => s && s.si && s.alors).slice(0, 4)
    };
  }

  return {
    phase,
    intro: { advisorPresented, clientDescribed },
    contexte,
    facts,
    posedId: (() => { const v = str(parsed.posedId, 40); return v && ids.has(v) ? v : null; })(),
    resolvedIds: idList(parsed.resolvedIds),
    partialIds: idList(parsed.partialIds),
    staleCurrent: parsed.staleCurrent === true,
    intervention
  };
}

function normalizePrepare(parsed) {
  const empty = { resume: '', queue: [], contradictions: [], pieces: [] };
  if (!parsed || typeof parsed !== 'object') return empty;
  return {
    resume: str(parsed.resume, 2000),
    queue: (Array.isArray(parsed.queue) ? parsed.queue : [])
      .map((q) => (q && typeof q === 'object' ? {
        texte: str(q.texte, 400),
        categorie: CATEGORIES.indexOf(str(q.categorie, 20).toLowerCase()) !== -1
          ? str(q.categorie, 20).toLowerCase() : 'strategique',
        objectif: str(q.objectif, 300),
        pieceAttendue: str(q.pieceAttendue, 200),
        suites: (Array.isArray(q.suites) ? q.suites : [])
          .map((s) => (s && typeof s === 'object' ? { si: str(s.si, 200), alors: str(s.alors, 300) } : null))
          .filter(Boolean).slice(0, 4)
      } : null))
      .filter((q) => q && q.texte.length > 5).slice(0, 16),
    contradictions: (Array.isArray(parsed.contradictions) ? parsed.contradictions : [])
      .map((c) => (c && typeof c === 'object'
        ? { constat: str(c.constat, 400), formulation: str(c.formulation, 500) } : null))
      .filter((c) => c && c.constat).slice(0, 10),
    pieces: (Array.isArray(parsed.pieces) ? parsed.pieces : [])
      .map((p) => (p && typeof p === 'object' ? {
        libelle: str(p.libelle, 200),
        statut: ['reçu', 'manquant', 'non applicable', 'à clarifier'].indexOf(str(p.statut, 30)) !== -1
          ? str(p.statut, 30) : 'manquant'
      } : null))
      .filter((p) => p && p.libelle).slice(0, 20)
  };
}

/* --------------------------------------------------------------- http ----- */

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function upstreamErrorMessage(status, detail, model) {
  const needsWorkspace = status === 400 && /anthropic-workspace-id/i.test(detail);
  const noCredit = /credit balance is too low/i.test(detail);
  const hint =
    noCredit ? ' — crédit API épuisé : rechargez le compte sur console.anthropic.com → Plans & Billing' :
    needsWorkspace ? ' — clé non rattachée à un workspace : définissez ANTHROPIC_WORKSPACE_ID' :
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
      status: 405, headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST' }
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

  const mode = body && body.mode;
  if (!mode || MODES.indexOf(mode) === -1) {
    return json(400, { error: 'Paramètre « mode » invalide : attendu ' + MODES.join(', ') + '.' });
  }
  if (mode === 'ping') return json(200, { ok: true, ref: REFERENTIEL_VERSION, at: Date.now() });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'Configuration serveur incomplète : ANTHROPIC_API_KEY est absente.' });
  }

  const {
    societe, fiche, regles, contexte, scenario, plan, duree,
    transcript, resume, faits, questions, categorie, temps, introState,
    clientQuestion, reserve, documents
  } = body;

  const ctx = typeof contexte === 'string' ? contexte.trim() : '';
  if (ctx.length < 10) {
    return json(400, { error: 'Contexte du dossier obligatoire : décris le client, le projet et l’étape connue (10 caractères minimum).' });
  }
  if (mode === 'plan') {
    const d = Number(duree);
    if (DURATIONS.indexOf(d) === -1) {
      return json(400, { error: 'Durée invalide : attendu ' + DURATIONS.join(', ') + ' minutes.' });
    }
  }

  const validIds = (Array.isArray(questions) ? questions : [])
    .map((q) => (q && q.id ? String(q.id) : '')).filter(Boolean);

  const userPrompt =
    mode === 'plan'    ? buildPlanPrompt({ duree: Number(duree), contexte: ctx, documents }) :
    mode === 'select'  ? buildSelectPrompt({ transcript, resume, faits, questions, categorie, temps, introState, clientQuestion }) :
    mode === 'prepare' ? buildPreparePrompt({ transcript, resume, faits, questions, categorie, reserve }) :
                         buildSummaryPrompt({ transcript, faits, questions, resume, temps, scenario });

  const fast = mode === 'select';
  const model = fast
    ? (process.env.CLAUDE_MODEL_FAST || DEFAULT_MODEL_FAST)
    : (process.env.CLAUDE_MODEL || DEFAULT_MODEL);

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
      method: 'POST', headers,
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS[mode] || 1000,
        stream: true,
        system: systemBlocks({ societe, fiche, regles, contexte: ctx, scenario, plan }),
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
  } catch (err) {
    return json(502, { error: 'Impossible de joindre l’API Anthropic : ' + (err && err.message ? err.message : 'erreur réseau') });
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
      const send = (event, data) =>
        controller.enqueue(encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'));
      let full = '', usage = null;
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

      if (usage) send('usage', {
        cache_read: usage.cache_read_input_tokens || 0,
        cache_write: usage.cache_creation_input_tokens || 0,
        input: usage.input_tokens || 0,
        model
      });

      if (mode === 'plan')         send('done', normalizePlan(extractJson(full), Number(duree)));
      else if (mode === 'select')  send('done', normalizeSelect(extractJson(full), validIds));
      else if (mode === 'prepare') send('done', normalizePrepare(extractJson(full)));
      else                         send('done', { text: full.trim() });

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
