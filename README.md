# 🎙️ Meeting Copilot

Copilote de réunion, à ouvrir **sur le téléphone posé à côté du PC** pendant une visioconférence.
Il écoute, propose en continu les questions à poser à ton interlocuteur, et produit le bilan complet
à la fin.

Un écran, trois gestes : **Écouter** → lire les questions → **Terminer la réunion**.

Aucune dépendance, aucun build : un `index.html` statique + une fonction serverless Vercel.

---

## L'écran

Rien à cliquer pendant la réunion. **Mode discret** : noir profond, blanc cassé, aucune couleur
vive, aucune animation voyante, aucun son. L'écran éclaire le moins possible votre visage.

| | |
|---|---|
| **Sujet de la réunion** | **Obligatoire.** Zone de 3 lignes : le sujet *et* l'objectif. Le bouton Écouter reste grisé sous 10 caractères. Pendant l'écoute il se replie en une ligne ; un tap le rouvre, la modification vaut dès le cycle suivant. |
| **▶ MAINTENANT** | **1 question, en 26 px**, collée en haut de l'écran, avec son 💡 pourquoi (8 mots max). C'est la seule chose à lire en parlant. |
| **ENSUITE** | 4 relances alternatives, taille moyenne. |
| **À ABORDER** | 3 questions pour amener les sujets de l'objectif pas encore traités, plus petites. |
| **Il vous demande : …** | Bandeau en haut dès que le client pose une question directe. |
| **✓ Réponses obtenues (n)** | Repliable : chaque question traitée, sa réponse, son pourquoi. |
| **Transcription** | Repliable, avec **Moi :** / **Client :**. |
| **⚡ 0,9 s** | Latence moyenne des 5 derniers appels, en haut à droite. |

Soit **7 à 8 questions en permanence**. Elles disparaissent seules quand le client répond,
sont remplacées quand elles deviennent hors sujet, jamais en double.

**Options** (⚙) : afficher le pourquoi, question collée en haut, vibration (**désactivée par
défaut**), inverser Moi / Client.

> **Posez le téléphone juste sous la webcam.** La question MAINTENANT est collée en haut de
> l'écran : votre regard reste à quelques centimètres de la caméra, et vous continuez à
> regarder votre interlocuteur.

## Transcription — Deepgram en streaming

WebSocket vers **Deepgram nova-3** (`language=fr`, `interim_results`, `smart_format`,
`diarize`, `endpointing=300`, `utterance_end_ms=1000`). L'audio part par tranches de 250 ms.

La capture micro désactive volontairement `echoCancellation` et `noiseSuppression` : on capte
les **haut-parleurs du PC**, et ces filtres effaceraient la voix du client. `autoGainControl`
reste actif.

**Diarisation** : Deepgram sépare les locuteurs ; le premier entendu est étiqueté « Moi »,
l'autre « Client ». Si la réunion commence autrement, l'option **Inverser Moi / Client**
corrige **toute** la transcription, y compris les passages déjà écrits.

La clé Deepgram ne quitte jamais le serveur : `api/deepgram-token.js` délivre un **JWT de
5 minutes** (l'API renvoie 30 s par défaut, trop court pour ouvrir le micro puis le socket),
protégé par `APP_PASSWORD`. Le WebSocket se reconnecte tout seul avec un jeton frais.

**Repli automatique** : si le jeton ou le WebSocket échoue, l'app bascule sur la Web Speech API
du navigateur sans interrompre la réunion (sans séparation des locuteurs).

## Questions au tac au tac

Une analyse part :

- sur **texte intermédiaire**, ~1,2 s après du nouveau contenu — l'IA travaille **pendant que
  le client parle encore** ; le passage en cours lui est envoyé marqué `[EN COURS]` ;
- **immédiatement** à chaque fin d'énoncé (`UtteranceEnd` de Deepgram) ;
- **immédiatement** quand le client pose une question.

**Le plus récent gagne** : chaque nouvel appel annule le précédent (`AbortController`). Pas de
file d'attente, pas de réponse périmée qui s'affiche. Plafond de sécurité : 1 appel / 2 s.

**Stabilité** : la question MAINTENANT tient **au moins 4 s** — sauf si elle vient d'être
répondue, ou si l'IA renvoie `replaceNow: true` parce que la nouvelle est nettement meilleure.
Sinon la relance proposée bascule en « Ensuite ». Le rendu se fait **par diff sur des ids
stables** : seules les cartes qui changent s'animent (150–200 ms), les autres ne bougent pas.

## Latence minimale

- **Vercel Edge Runtime** : pas de cold start.
- **Haiku 4.5** pour le live, **2 500 derniers caractères** seulement, `max_tokens` 350.
- **Résumé roulant** régénéré toutes les 2 min par un appel de fond : la mémoire longue de la
  réunion sans alourdir chaque appel.
- **Préchauffage** : ping de l'endpoint au chargement puis toutes les 4 min.
- **Prompt caching** (`cache_control: ephemeral`) sur le préfixe stable — règles de style et
  sujet. ⚠️ Le minimum cacheable de **Haiku 4.5 est de 4096 tokens** : sous ce seuil Anthropic
  ignore le marqueur sans erreur. Le préfixe actuel (~600 tokens) est en dessous, donc le cache
  **ne s'active pas encore** ; il s'activera dès que le contexte grossira. L'événement SSE
  `usage` renvoie `cache_read` / `cache_write` pour le vérifier plutôt que le supposer.

## Le bilan

Dix sections, rien d'inventé, propos attribués Moi / Client :

`SUJET DE LA RÉUNION` · **`OBJECTIF ATTEINT ?`** (ce qui a été obtenu, ce qui manque) · `RÉSUMÉ` ·
`POINTS CLÉS & INFORMATIONS OBTENUES` · `DÉCISIONS PRISES` · `ACTIONS À FAIRE` ·
`QUESTIONS & RÉPONSES OBTENUES` · `QUESTIONS RESTÉES SANS RÉPONSE / POINTS OUVERTS` ·
`OÙ ON EN EST` · `PROCHAINE ÉTAPE RECOMMANDÉE`

Streamé au fur et à mesure. Puis **Copier**, **⬇ .md** (bilan + Q/R + mémoire + transcription
diarisée) et **Nouvelle réunion**.

## Ne rien perdre

Sujet, transcription, les 3 niveaux, réponses obtenues et résumé roulant sont écrits dans le
`localStorage`. Si la page se recharge, l'app propose de **reprendre la réunion**. Wake Lock pour
garder l'écran allumé.

---

## Déploiement

Import du repo sur **[vercel.com/new](https://vercel.com/new)**, puis deux variables
d'environnement, puis un redéploiement. **Marche à suivre détaillée : [DEPLOIEMENT.md](DEPLOIEMENT.md).**

| Variable | Requis | Défaut | Rôle |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | oui | — | Clé API Anthropic. **Jamais exposée au navigateur.** |
| `APP_PASSWORD` | recommandé | — | Si défini, le header `x-app-password` est exigé ; sinon `401`. |
| `CLAUDE_MODEL` | non | `claude-sonnet-5` | Modèle du bilan. |
| `CLAUDE_MODEL_FAST` | non | `claude-haiku-4-5-20251001` | Modèle du temps réel et du résumé roulant. |
| `DEEPGRAM_API_KEY` | recommandé | — | Transcription Deepgram nova-3. Sans elle, l'app bascule sur le moteur du navigateur. |
| `ANTHROPIC_WORKSPACE_ID` | non | — | Uniquement si la clé n'est rattachée à aucun workspace (Anthropic renvoie alors une erreur 400 le réclamant). |

> Les variables ne s'appliquent qu'après un **redéploiement**.

## API interne

Deux endpoints, tous deux en **Edge Runtime**, tous deux protégés par `APP_PASSWORD`.

### `POST /api/deepgram-token`
`-> 200 { access_token, expires_in }` · `401` sans mot de passe · `500` si `DEEPGRAM_API_KEY`
est absente. Le jeton vaut 5 minutes.

### `POST /api/claude`
Réponse en **SSE** : `delta` (texte au fil de l'eau), `usage` (diagnostic du cache), `done`.

```jsonc
{ "mode": "ping" }                      // préchauffe, n'appelle pas Anthropic -> { ok: true }

{ "mode": "live",                        // temps réel, Haiku, max_tokens 350
  "topic": "…",                          // OBLIGATOIRE, 10 caractères minimum
  "transcript": "…",                     // 2 500 derniers caractères, « Moi : » / « Client [EN COURS] : »
  "digest": "…",                         // résumé roulant
  "questions": [{ "id": "q1", "text": "…" }],
  "answered": ["…"] }
// done -> { answered:[{id,answer}], obsolete:["id"], ask:"", replaceNow:bool,
//           now:{question,why}, next:[{question}], later:[{question}] }

{ "mode": "digest", "topic": "…", "transcript": "…", "previous": "…" }   // -> { text }
{ "mode": "summary", "topic": "…", "transcript": "…", "qa": [...], "open": [...] } // -> { text }
```

Une erreur survenue **avant** le flux revient en JSON classique avec le bon code HTTP.
Le mode `live` renvoie toujours la structure complète — vide si le modèle n'a pas produit de
JSON exploitable, pour ne jamais perturber l'affichage.

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
