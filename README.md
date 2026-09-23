# Copilote d'appel — Advisor

Web app métier pour les advisors en **financement de projets** : elle écoute l'appel de
qualification, prépare l'intervention à prononcer, tient la mémoire du dossier et produit le
compte rendu.

> **Le référentiel métier fait foi** : [`docs/referentiel-metier.md`](docs/referentiel-metier.md).
> Il prime sur ce README et sur toute autre spécification du dépôt.
> Une qualification autorise une présentation ; **elle ne constitue jamais un accord de financement**.

---

## Configuration matérielle

| | |
|---|---|
| **Appel** | Sur un **téléphone séparé** (Android ou iPhone), **en haut-parleur**, via WhatsApp, Teams, Zoom ou Google Meet. |
| **Web app et prompteur** | Sur **l'ordinateur**, qui capte le son avec son micro (intégré ou externe). |
| **Aucune intégration** | Pas d'accès au flux audio interne des applications d'appel. La captation est **acoustique**. |
| **Réglages micro** | `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: true` — on capte un haut-parleur, ces filtres effaceraient la voix du client. Sélecteur de micro disponible. |

Le prompteur est dimensionné pour être lu à **60–80 cm**.

## Parcours

### 1. Configuration
Société représentée (**Swiss PWM AG** → cadre suisse, **Admiralty Capital Limited** → cadre
Hong Kong), scénario (*PWM seule*, *Admiralty seule*, *PWM + Admiralty*, *À confirmer* — **aucun
coprêt**), durée (20 / 30 / 45 min, 1 h, 1 h 30, 2 h), canal, contexte du dossier (obligatoire),
advisor, documents.

**Case obligatoire** : « Le client a été informé de l'enregistrement et de la transcription ».
Le bouton Démarrer reste désactivé tant qu'elle n'est pas cochée.

### 2. Test de captation (~20 s)
Niveau capté, transcription obtenue, et **attribution des voix** : l'advisor confirme quel
locuteur Deepgram il est. Verdict ✅ / ⚠️ / ❌. Le test peut être passé, l'avertissement reste.
En cas de doute, un segment est marqué **Incertain** plutôt qu'attribué au mauvais interlocuteur.

### 3. Introduction — **aucune question affichée**
L'introduction se déroule en deux temps :
1. **L'advisor présente la société.** L'écran affiche uniquement la fiche institutionnelle validée,
   en petit. Sans fiche renseignée : « Présentation en cours… ».
2. **Le client se présente.** L'app remplit en direct la fiche **Contexte capté** et prépare les
   questions **en arrière-plan, sans les afficher**.

Le passage aux questions exige **les deux présentations faites** *puis* une **pause naturelle**
après un tour de parole du client. Bouton **« Commencer les questions → »** toujours disponible.
**Aucune bascule au chronomètre** : si l'introduction dure, l'app attend.

> La règle est appliquée **côté serveur** : tant que `phase` vaut `intro`, l'API supprime
> l'intervention avant de répondre. Un modèle qui désobéirait ne peut pas faire fuiter une question.

### 4. Pendant l'appel
**Barre de commandes** : société active et cadre juridique, durée / écoulé / restant, phase du
plan, catégories `Stratégique | Juridique | Financier | Catégorie suivante →`, **Modifier la durée**,
latence moyenne, Terminer l'appel.

**Plan** : répartition en minutes introduction / stratégie / juridique / financier / synthèse,
dont la somme vaut **exactement** la durée choisie, affichée en frise. La réserve de sujets est
proportionnelle à la durée. Un changement de durée **conserve le temps écoulé** et recalcule le plan.

**Prompteur** — une seule intervention, en 31 px, à la première personne, vouvoiement :
- **Stable** : dès que l'advisor commence à parler, l'intervention est **verrouillée** et n'est
  jamais réécrite. Le remplacement intervient à la **pause naturelle suivante** ou sur action explicite.
- **Passage automatique** : une question passe à « posée » seulement si l'advisor a réellement
  prononcé une formulation équivalente. Un silence, le temps écoulé ou le simple affichage ne
  suffisent jamais.
- **Pause auto** : l'écoute et la **préparation continuent**, seul l'affichage se fige. Le bot ne
  réactive jamais l'auto de lui-même.
- Badges **⚠ à actualiser** (correction du client) et **⚠ suggestion possiblement dépassée**.
- Boutons : `Approfondir`, `Avancer`, `Variantes`, `◀ Précédente`, `⏸ Pause auto`.
- Panneau **Détails** replié : objectif métier, propos source cité et horodaté, information à
  préciser, pièce attendue, suites possibles selon la réponse.

**Panneau latéral** : contexte capté, file des questions avec leur statut, transcription
**Advisor / Client / Incertain**.

### 5. Fin d'appel
Compte rendu streamé : compte rendu factuel, informations par axe avec source et certitude,
**corrections sensibles à confirmer** (validées une par une avant l'export), contradictions,
questions réellement posées, points ouverts, pièces, actions, position dans la chronologie des
16 repères, orientation de scénario ou « orientation à confirmer ».

Une question **affichée mais jamais posée** n'apparaît **jamais** comme un échange réel.
L'export `.md` sert de base à l'appel suivant via l'import.

## Architecture IA

| Niveau | Modèle | Rôle |
|---|---|---|
| **Sélecteur** | `CLAUDE_MODEL_FAST` (Haiku) | À chaque fin de tour : phase, faits, statuts des questions, prochaine intervention. Streamé. |
| **Préparateur** | `CLAUDE_MODEL` (Sonnet) | Toutes les ~20 s en fond : résumé roulant, file de questions avec branches, contradictions, pièces. Ne bloque jamais l'appel. |
| **Plan / Compte rendu** | `CLAUDE_MODEL` | Répartition du temps, puis compte rendu final. |

**Prompt caching** : le prompt système est en deux blocs marqués `cache_control: ephemeral` — le
référentiel condensé versionné (`api/prompts/referentiel-condense.js`, ~1800 tokens) et le bloc
société / règles / dossier / plan. Le bloc stable dépasse le minimum de Sonnet (1024 tokens).
⚠️ Le minimum de **Haiku 4.5 est de 4096 tokens** : pour le sélecteur, le cache ne s'active que si
le contexte dépasse ce seuil. L'événement SSE `usage` renvoie `cache_read` / `cache_write` pour le
**mesurer** plutôt que le supposer.

## Variables d'environnement

| Variable | Requis | Défaut | Rôle |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | oui | — | Clé API Anthropic. Jamais exposée au navigateur. |
| `APP_PASSWORD` | **fortement recommandé** | — | Sans elle, les deux endpoints sont ouverts. |
| `DEEPGRAM_API_KEY` | recommandé | — | Transcription nova-3 avec diarisation. Sans elle, repli navigateur **sans séparation des locuteurs**. |
| `CLAUDE_MODEL` | non | `claude-sonnet-5` | Préparateur, plan, compte rendu. |
| `CLAUDE_MODEL_FAST` | non | `claude-haiku-4-5-20251001` | Sélecteur. |
| `ANTHROPIC_WORKSPACE_ID` | non | — | Si la clé n'est rattachée à aucun workspace. |

## Paramètres (page dédiée, `localStorage`, export/import JSON)

Par société : **fiche institutionnelle validée** et **règles validées** (avec date et source).

> C'est la **seule base autorisée** pour aider l'advisor à présenter la société et répondre aux
> questions du client. **Si les règles sont vides, toute question de taux, frais, délai ou critère
> renvoie « à confirmer »** — aucun chiffre n'est inventé.

## API interne

`POST /api/claude` (Edge, SSE) — modes `ping`, `plan`, `prepare`, `select`, `summary`.
Le **contexte du dossier est obligatoire** (10 caractères minimum), sinon `400`.
`POST /api/deepgram-token` (Edge) — JWT de 5 minutes, `401` sans mot de passe.

## Hors périmètre de cette itération

Sections 9, 11 et 12 du référentiel : gestion complète des dossiers, n8n, Obsidian, Investment
Memo, Committee Pack. Les structures de données (`facts[]`, `questions[]`, pièces, contradictions)
sont en place pour les accueillir.

## Limites connues

- La captation acoustique dépend du micro, du volume du haut-parleur et du bruit ambiant. **Le test
  de démarrage ne remplace pas une validation en conditions réelles.**
- Sans Deepgram, le repli navigateur ne sépare pas les locuteurs : les segments sont marqués
  *Incertain*, et le passage automatique du prompteur en est dégradé.
- Les seuils de latence et les réglages micro restent à valider lors du cadrage technique.
- L'articulation **PWE / PWM**, les modalités contractuelles des trois scénarios et les règles
  exactes d'orientation restent **à préciser** : l'app ne les déduit jamais.
