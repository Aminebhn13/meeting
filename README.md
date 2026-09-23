# 🎙️ Meeting Copilot

Copilote de réunion, à ouvrir **sur le téléphone posé à côté du PC** pendant une visioconférence.
Il écoute, propose en continu les questions à poser à ton interlocuteur, et produit le bilan complet
à la fin.

Un écran, trois gestes : **Écouter** → lire les questions → **Terminer la réunion**.

Aucune dépendance, aucun build : un `index.html` statique + une fonction serverless Vercel.

---

## L'écran

Rien à cliquer pendant la réunion.

| | |
|---|---|
| **Sujet de la réunion** | **Obligatoire.** Une zone de 3 lignes en haut : le sujet *et* l'objectif. Le bouton Écouter reste grisé en dessous de 10 caractères. Une fois l'écoute lancée, le sujet se replie en une ligne ; un tap le rouvre, et la modification est prise en compte au cycle suivant. Prérempli avec le dernier sujet utilisé. |
| **Gros bouton rond** | 🎙 Écouter / ⏸ Pause. À côté : point rouge clignotant et chronomètre. |
| **Questions à poser** | Toujours 3 questions, en grosse police, chacune suivie de son **💡 pourquoi** — une phrase qui dit l'intérêt stratégique de la question. Elles se renouvellent seules : dès que l'interlocuteur répond, la question se coche en vert, affiche la réponse 2 secondes, puis s'efface. |
| **✓ Réponses obtenues (n)** | Liste repliable : chaque question traitée, sa réponse et son pourquoi. Fermée par défaut. |
| **Voir la transcription** | Bloc replié par défaut. |
| **Terminer la réunion** | Bouton fixe en bas : arrête l'écoute et affiche le bilan en plein écran. |

Le mot de passe est demandé **une seule fois**, au premier lancement. S'il est refusé (401), il est redemandé.

## Le sujet commande tout

Le sujet n'est pas un simple champ de contexte : il est injecté dans le **prompt système**, en mode
temps réel comme pour le bilan. Chaque question doit servir cet objectif, et le modèle a pour
consigne d'ignorer les digressions sans rapport. Sans sujet d'au moins 10 caractères, le backend
refuse la requête avec un **400**.

## Jamais d'écran vide

Dès que le sujet est saisi (au blur du champ), un premier appel part avec la transcription vide :
3 questions d'ouverture sont prêtes **avant** que quiconque ait parlé. Si le pré-chauffage n'a rien
produit, le clic sur Écouter en déclenche un immédiatement.

## Comment les questions se mettent à jour

À chaque cycle, l'IA reçoit les 3 questions affichées (avec leur id) et la fin de la transcription,
et répond en JSON strict :

```json
{
  "answered": [{ "id": "q3", "answer": "résumé de la réponse en une phrase" }],
  "obsolete": ["q5"],
  "new":      [{ "question": "…", "why": "pourquoi cette question, 15 mots max" }]
}
```

- **answered** — l'interlocuteur a répondu, même sans reprendre les mots de la question, même si
  vous ne l'avez pas posée, même si le sujet est venu spontanément.
- **obsolete** — la question ne sert plus l'objectif.
- **new** — de quoi revenir à 3 questions, sans doublon. Le filtre est tolérant : accents, casse et
  ponctuation ignorés, et une reformulation qui contient une question existante est écartée.

**Streaming.** L'appel à l'API Anthropic est fait en `stream: true` et le flux est relayé au front
en SSE. Le navigateur parse le JSON **au fur et à mesure** : chaque question s'affiche dès que son
objet est refermé, sans attendre la fin de la réponse — environ 1,5 s gagnées par cycle. L'événement
`done` final fait autorité ; les questions déjà affichées sont écartées comme doublons. Si le flux
est illisible, l'affichage reste tel quel, **sans message d'erreur**. Le bilan est streamé de la même
façon, avec un curseur d'écriture.

**Cadence** : une analyse part dès qu'une phrase est transcrite **et** qu'environ 80 nouveaux
caractères sont arrivés, avec au plus **un appel toutes les 12 s**. Jamais deux en parallèle : si du
texte arrive pendant une analyse, la suivante est programmée pour l'instant exact où la fenêtre se
rouvre. Seuls les **4 000 derniers caractères** partent en mode live.

**Deux modèles** : Haiku 4.5 pour le temps réel (`CLAUDE_MODEL_FAST`), Sonnet pour le bilan
(`CLAUDE_MODEL`).

## Le bilan

Dix sections, rien d'inventé, « non précisé » quand l'information manque :

`SUJET DE LA RÉUNION` · **`OBJECTIF ATTEINT ?`** (ce qui a été obtenu, ce qui manque) · `RÉSUMÉ` ·
`POINTS CLÉS & INFORMATIONS OBTENUES` · `DÉCISIONS PRISES` · `ACTIONS À FAIRE` (qui → quoi → échéance) ·
`QUESTIONS & RÉPONSES OBTENUES` · `QUESTIONS RESTÉES SANS RÉPONSE / POINTS OUVERTS` · `OÙ ON EN EST` ·
`PROCHAINE ÉTAPE RECOMMANDÉE`

Puis **📋 Copier**, **⬇ Télécharger .md** (bilan + questions/réponses avec leur pourquoi + questions
ouvertes + transcription complète) et **Nouvelle réunion**.

## Ne rien perdre

Sujet, transcription, questions actives et réponses obtenues sont écrits dans le `localStorage`
pendant l'écoute. Si la page se recharge ou si l'écran se verrouille, l'app propose au lancement
suivant de **reprendre la réunion**. Le Wake Lock garde l'écran allumé, et la reconnaissance vocale
redémarre toute seule quand le navigateur la coupe.

---

## Déploiement

Import du repo sur **[vercel.com/new](https://vercel.com/new)**, puis deux variables
d'environnement, puis un redéploiement. **Marche à suivre détaillée : [DEPLOIEMENT.md](DEPLOIEMENT.md).**

| Variable | Requis | Défaut | Rôle |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | oui | — | Clé API Anthropic. **Jamais exposée au navigateur.** |
| `APP_PASSWORD` | recommandé | — | Si défini, le header `x-app-password` est exigé ; sinon `401`. |
| `CLAUDE_MODEL` | non | `claude-sonnet-5` | Modèle du bilan. |
| `CLAUDE_MODEL_FAST` | non | `claude-haiku-4-5-20251001` | Modèle de l'analyse temps réel. |
| `ANTHROPIC_WORKSPACE_ID` | non | — | Uniquement si la clé n'est rattachée à aucun workspace (Anthropic renvoie alors une erreur 400 le réclamant). |

> Les variables ne s'appliquent qu'après un **redéploiement**.

## API interne

`POST /api/claude` — POST uniquement (`405` sinon). Le **sujet est obligatoire** : sans lui, `400`.
Réponse diffusée en **SSE** (`text/event-stream`) : des événements `delta` puis un `done` final.

```jsonc
// mode "live" — temps réel, modèle rapide
{
  "mode": "live",
  "topic": "…",                               // OBLIGATOIRE, 10 caractères minimum
  "transcript": "…",                          // 4 000 derniers caractères ; vide = questions d'ouverture
  "questions": [{ "id": "q1", "text": "…" }], // les 3 affichées
  "answered": ["…"]                           // textes déjà traités, anti-doublon
}
// done -> { "answered":[{id,answer}], "obsolete":["id"], "new":[{question,why}] }

// mode "summary" — bilan, modèle principal
{
  "mode": "summary",
  "topic": "…",                               // OBLIGATOIRE
  "transcript": "…",                          // 60 000 derniers caractères
  "qa":   [{ "question": "…", "answer": "…", "why": "…" }],
  "open": ["…"]
}
// done -> { "text": "…" }
```

Une erreur survenue **avant** le début du flux est renvoyée en JSON classique avec le bon code HTTP
(`{ "error": "…" }`). Une erreur en cours de flux arrive en événement `error`.
`max_tokens` : **3000** pour `summary`, **700** pour `live`.
Le mode `live` renvoie toujours les trois listes — vides si le modèle n'a pas produit de JSON
exploitable, pour ne jamais perturber l'affichage.

---

## Limites connues

- **Web Speech API** : Chrome (Android, desktop) et Safari (iOS 14.5+). Firefox et les navigateurs
  intégrés aux applications (Instagram, LinkedIn, Gmail) ne la gèrent pas — un message explicite
  s'affiche.
- **Qualité de la transcription** : dépend du micro, du bruit et du volume des haut-parleurs. Les
  orateurs ne sont **pas** distingués ; les prompts en tiennent compte.
- **Coupures** : les navigateurs mobiles arrêtent la reconnaissance régulièrement. L'app redémarre
  automatiquement, mais quelques mots peuvent se perdre à la jonction.
- **Arrière-plan** : écran verrouillé ou app quittée, le navigateur suspend le micro. Garder l'écran
  allumé — le Wake Lock s'en charge quand il est disponible.
- **Horodatage** : relatif au temps d'écoute cumulé, pas à l'heure réelle.
- Chrome envoie l'audio à un service de reconnaissance Google ; Safari à celui d'Apple.

## Confidentialité

- L'audio n'est **jamais** stocké ni transmis par cette application : il est traité par le moteur de
  reconnaissance vocale du navigateur.
- La transcription ne quitte le téléphone que lors d'un appel à `/api/claude` — envoyée à l'API
  Anthropic pour cet appel seulement, jamais persistée côté serveur.
- Sujet, transcription, questions et bilan restent dans le `localStorage` du téléphone, effaçables
  via « Nouvelle réunion ».
- `ANTHROPIC_API_KEY` reste exclusivement côté serveur. Le mot de passe applicatif est un
  garde-barrière contre l'usage de ton quota API, pas un système d'authentification.
- **Préviens tes interlocuteurs** : transcrire une réunion sans le dire est, selon les juridictions
  et les contextes, discutable — voire illégal.

## Licence

Usage personnel.
