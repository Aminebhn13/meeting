# 🎙️ Meeting Copilot

Copilote de réunion, à ouvrir **sur le téléphone posé à côté du PC** pendant une visioconférence.
Il écoute, propose en continu les questions à poser à ton interlocuteur, et produit le bilan complet
à la fin.

Un écran, trois gestes : **Écouter** → lire les questions → **Terminer la réunion**.

Aucune dépendance, aucun build : un `index.html` statique + une fonction serverless Vercel.

---

## L'écran

| | |
|---|---|
| **Sujet de la réunion** | Un champ, optionnel, en haut. Sert de contexte à l'IA. Mémorisé. |
| **Gros bouton rond** | 🎙 Écouter / ⏸ Pause. À côté : point rouge clignotant et chronomètre. |
| **Questions à poser** | Les 3 plus récentes en grosse police, lisibles d'un coup d'œil. Les précédentes descendent en gris dans un historique repliable. **Un tap barre une question** une fois posée. Le bouton ↻ force de nouvelles questions. |
| **Voir la transcription** | Bloc replié par défaut. |
| **Terminer la réunion** | Bouton fixe en bas : arrête l'écoute et affiche le bilan en plein écran. |

Le mot de passe est demandé **une seule fois**, au premier lancement, dans une petite fenêtre.
Il n'apparaît jamais sur l'écran principal. S'il est refusé (401), il est redemandé.

## Les questions

Générées **automatiquement toutes les ~45 secondes**, et seulement si **au moins ~150 nouveaux
caractères** ont été transcrits depuis la dernière fois — pas de conversation, pas d'appel.

L'IA propose 3 questions courtes et naturelles, à poser maintenant, en rebondissant sur ce qui vient
d'être dit. Dans l'ordre de priorité : clarifier les zones floues, obtenir des chiffres, délais,
budget et responsables, faire émerger les risques et les dépendances, faire avancer vers une décision.

Les questions déjà proposées et celles déjà posées sont renvoyées au backend à chaque appel, pour
éviter les doublons.

## Le bilan

Au clic sur **Terminer la réunion** — sept sections, rien d'inventé, « non précisé » quand
l'information manque :

`RÉSUMÉ` · `POINTS CLÉS & INFORMATIONS OBTENUES` · `DÉCISIONS PRISES` ·
`ACTIONS À FAIRE` (qui → quoi → échéance) · `QUESTIONS RESTÉES SANS RÉPONSE / POINTS OUVERTS` ·
`OÙ ON EN EST` · `PROCHAINE ÉTAPE RECOMMANDÉE`

Puis **📋 Copier**, **⬇ Télécharger .md** (bilan + questions posées + transcription complète)
et **Nouvelle réunion**.

## Ne rien perdre

Transcription et questions sont écrites dans le `localStorage` pendant l'écoute. Si la page se
recharge ou si l'écran se verrouille, l'app propose au lancement suivant de **reprendre la réunion**.
Le Wake Lock garde l'écran allumé, et la reconnaissance vocale redémarre toute seule quand le
navigateur la coupe — ce qui arrive souvent sur mobile.

---

## Déploiement

Import du repo sur **[vercel.com/new](https://vercel.com/new)**, puis deux variables
d'environnement, puis un redéploiement. **Marche à suivre détaillée : [DEPLOIEMENT.md](DEPLOIEMENT.md).**

| Variable | Requis | Défaut | Rôle |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | oui | — | Clé API Anthropic. **Jamais exposée au navigateur.** |
| `APP_PASSWORD` | recommandé | — | Si défini, le header `x-app-password` est exigé ; sinon `401`. |
| `CLAUDE_MODEL` | non | `claude-sonnet-5` | Modèle utilisé. |

> Les variables ne s'appliquent qu'après un **redéploiement**.

## API interne

`POST /api/claude` — POST uniquement, `405` sinon.

```jsonc
{
  "mode": "questions" | "summary",
  "topic": "…",        // sujet de la réunion, optionnel
  "transcript": "…",   // horodatée ; 60 000 derniers caractères conservés
  "proposed": ["…"],   // questions déjà proposées (mode questions)
  "asked": ["…"]       // questions déjà posées à voix haute
}
```

Réponse : `{ "text": "…" }` ou `{ "error": "…" }`.
`max_tokens` : **3000** pour `summary`, **500** pour `questions`.

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
