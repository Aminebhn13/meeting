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
| **Sujet de la réunion** | Un champ, optionnel, en haut. Sert de contexte à l'IA. Mémorisé. |
| **Gros bouton rond** | 🎙 Écouter / ⏸ Pause. À côté : point rouge clignotant et chronomètre. |
| **Questions à poser** | Toujours 3 questions, en grosse police. Elles se renouvellent **toutes seules** : dès que l'interlocuteur répond à l'une d'elles, elle se coche en vert, affiche la réponse obtenue 2 secondes, puis s'efface et une nouvelle prend sa place. |
| **✓ Réponses obtenues (n)** | Liste repliable sous les questions : chaque question traitée avec la réponse captée. Fermée par défaut. |
| **Voir la transcription** | Bloc replié par défaut. |
| **Terminer la réunion** | Bouton fixe en bas : arrête l'écoute et affiche le bilan en plein écran. |

Le mot de passe est demandé **une seule fois**, au premier lancement. S'il est refusé (401), il est redemandé.

Un petit **↻** permet de forcer une analyse immédiate — jamais nécessaire, mais utile si le réseau a sauté.

## Comment les questions se mettent à jour

À chaque cycle, l'IA reçoit les 3 questions affichées (avec leur id) et la fin de la transcription,
et répond en JSON strict :

```json
{
  "answered": [{ "id": "q3", "answer": "résumé de la réponse en une phrase" }],
  "obsolete": ["q5"],
  "new":      ["nouvelle question", "…"]
}
```

- **answered** — l'interlocuteur a répondu, même sans reprendre les mots de la question, même si
  vous ne l'avez pas posée, même si le sujet est venu spontanément.
- **obsolete** — la conversation est passée à autre chose.
- **new** — de quoi revenir à 3 questions à l'écran, sans doublon avec ce qui a déjà été proposé ou traité.

Le parsing est tolérant (bloc de code, texte autour, accolades dans les chaînes). **En cas d'échec,
l'affichage reste tel quel, sans message d'erreur** — jamais de perturbation en pleine réunion.

**Cadence** : une analyse part dès qu'une phrase est transcrite **et** qu'environ 80 nouveaux
caractères sont arrivés, avec au plus **un appel toutes les 12 s**. Jamais deux appels en parallèle :
si du texte arrive pendant une analyse, la suivante est relancée dès la fin. Seuls les
**4 000 derniers caractères** partent pour ce mode — rapide et peu coûteux. La transcription
complète est réservée au bilan.

**Deux modèles** : Haiku 4.5 pour le temps réel (`CLAUDE_MODEL_FAST`), Sonnet pour le bilan
(`CLAUDE_MODEL`).

## Le bilan

Au clic sur **Terminer la réunion** — huit sections, rien d'inventé, « non précisé » quand
l'information manque :

`RÉSUMÉ` · `POINTS CLÉS & INFORMATIONS OBTENUES` · `DÉCISIONS PRISES` ·
`ACTIONS À FAIRE` (qui → quoi → échéance) · `QUESTIONS & RÉPONSES OBTENUES` ·
`QUESTIONS RESTÉES SANS RÉPONSE / POINTS OUVERTS` · `OÙ ON EN EST` ·
`PROCHAINE ÉTAPE RECOMMANDÉE`

Les questions traitées pendant la réunion et celles encore ouvertes sont transmises au modèle,
qui les reprend dans ces deux sections.

Puis **📋 Copier**, **⬇ Télécharger .md** (bilan + questions/réponses + questions ouvertes +
transcription complète) et **Nouvelle réunion**.

## Ne rien perdre

Transcription, questions actives et réponses obtenues sont écrites dans le `localStorage` pendant
l'écoute. Si la page se recharge ou si l'écran se verrouille, l'app propose au lancement suivant de
**reprendre la réunion**. Le Wake Lock garde l'écran allumé, et la reconnaissance vocale redémarre
toute seule quand le navigateur la coupe — ce qui arrive souvent sur mobile.

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

`POST /api/claude` — POST uniquement, `405` sinon.

```jsonc
// mode "live" — analyse temps réel, modèle rapide
{
  "mode": "live",
  "topic": "…",                              // optionnel
  "transcript": "…",                         // 4 000 derniers caractères
  "questions": [{ "id": "q1", "text": "…" }], // les 3 affichées
  "answered": ["…"]                          // textes déjà traités, anti-doublon
}
// -> { "answered": [{ "id", "answer" }], "obsolete": ["id"], "new": ["…"] }

// mode "summary" — bilan, modèle principal
{
  "mode": "summary",
  "topic": "…",
  "transcript": "…",                         // 60 000 derniers caractères
  "qa":   [{ "question": "…", "answer": "…" }],
  "open": ["…"]                              // questions encore actives
}
// -> { "text": "…" }
```

En cas d'erreur : `{ "error": "…" }`.
`max_tokens` : **3000** pour `summary`, **400** pour `live`.
Le mode `live` renvoie toujours les trois listes — vides si le modèle n'a pas produit de JSON
exploitable, pour ne jamais perturber l'affichage.

Le prompt système précise que la transcription vient d'une reconnaissance vocale imparfaite, sans
distinction des orateurs, et impose des réponses en français, concises, sans préambule.

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
