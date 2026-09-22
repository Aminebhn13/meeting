# 🎙️ Meeting Copilot

Copilote IA de réunion, pensé pour être ouvert **sur un téléphone posé à côté du PC** pendant une
visioconférence. Le téléphone écoute le son de la réunion, transcrit en direct, suggère des questions
à poser, répond aux questions posées en cours de route, et produit un bilan structuré à la fin.

Aucune dépendance, aucun build : un `index.html` statique + une fonction serverless Vercel.

---

## Fonctionnalités

| | |
|---|---|
| **Transcription en direct** | Web Speech API du navigateur (`fr-FR`, continu, résultats intermédiaires), avec redémarrage automatique quand le navigateur coupe l'écoute — fréquent sur mobile. Chaque segment est horodaté `[mm:ss]`. |
| **Questions suggérées** | Exactement 3 questions précises à poser maintenant, toutes les 30 s / 60 s / 2 min, ou à la demande. Ciblent en priorité les zones floues, les risques, les dépendances, les décisions non tranchées et les délais ou chiffres manquants. Aucun appel n'est émis si la transcription n'a pas avancé. |
| **Demander à l'IA** | Une réponse prête à dire à l'oral (2 à 4 phrases), suivie si nécessaire d'une ligne « À vérifier : ». |
| **Fin + bilan** | Arrête l'écoute et génère : ÉTAPE ACTUELLE / DÉCISIONS / ACTIONS (qui → quoi → échéance) / POINTS OUVERTS & RISQUES / PROCHAINE ÉTAPE RECOMMANDÉE. Rien n'est inventé : « non précisé » quand l'information manque. |
| **Export `.md`** | Bilan et transcription complète, en Markdown. |
| **Contexte** | Domaine/rôle, objet et objectif de la réunion, mot de passe, fréquence des questions — sauvegardés en `localStorage`. |
| **Confort** | Point rouge clignotant, chronomètre, Wake Lock (écran maintenu allumé), messages explicites si le navigateur est incompatible ou si le micro est refusé. La session survit à un rechargement d'onglet. |

---

## Utilisation

1. Ouvrir l'URL de production dans **Chrome (Android)** ou **Safari (iOS)**.
2. L'ajouter à l'écran d'accueil (Partager → « Sur l'écran d'accueil ») pour un lancement plein écran.
3. Ouvrir **Contexte** et renseigner :
   - le domaine / rôle — plus c'est précis, plus les questions sont pertinentes ;
   - l'objet et l'objectif de la réunion ;
   - le mot de passe de l'application (`APP_PASSWORD`) ;
   - la fréquence des questions.
4. Poser le téléphone à côté du PC, **son de la visio sur les haut-parleurs du PC** (pas de casque —
   sinon le micro du téléphone n'entend que vous).
5. Appuyer sur **🎙 Démarrer**, autoriser le micro.
6. En fin de réunion : **■ Fin + bilan**, puis exporter en `.md`.

---

## Déploiement

### Prérequis

```bash
npm i -g vercel      # CLI Vercel
vercel login         # authentification
```

### Mise en production

```bash
git clone https://github.com/Aminebhn13/meeting.git meeting-copilot
cd meeting-copilot
vercel --prod
```

> Guide détaillé, pas à pas, avec vérification et dépannage : **[DEPLOIEMENT.md](DEPLOIEMENT.md)**.

### Variables d'environnement (production)

```bash
vercel env add ANTHROPIC_API_KEY production   # clé API Anthropic — côté serveur uniquement
vercel env add APP_PASSWORD production        # mot de passe d'accès à l'app
vercel env add CLAUDE_MODEL production        # optionnel, défaut : claude-sonnet-5
vercel --prod                                 # redéployer pour appliquer
```

| Variable | Requis | Défaut | Rôle |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | oui | — | Clé API Anthropic. **Jamais exposée au navigateur.** |
| `APP_PASSWORD` | recommandé | — | Si défini, le header `x-app-password` est exigé ; sinon `401`. |
| `CLAUDE_MODEL` | non | `claude-sonnet-5` | Modèle utilisé. |

### Vérification

```bash
# Sans mot de passe -> 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<domaine>/api/claude \
  -H 'content-type: application/json' \
  -d '{"mode":"questions","transcript":"test"}'

# Avec mot de passe -> 200
curl -s -X POST https://<domaine>/api/claude \
  -H 'content-type: application/json' \
  -H 'x-app-password: <APP_PASSWORD>' \
  -d '{"mode":"questions","domain":"Chef de projet ERP","goal":"Cadrage du lot 2",
       "transcript":"[00:05] On vise une livraison au printemps. [00:20] Le budget reste à confirmer."}'
```

---

## API interne

`POST /api/claude` — POST uniquement, `405` sinon.

```jsonc
{
  "mode": "questions" | "answer" | "summary",
  "domain": "…",      // domaine / rôle
  "goal": "…",        // objet et objectif de la réunion
  "transcript": "…",  // transcription horodatée (60 000 derniers caractères conservés)
  "question": "…"     // requis pour mode "answer"
}
```

Réponse : `{ "text": "…" }`, ou `{ "error": "…" }` avec un message explicite.
`max_tokens` : 1500 pour `summary`, 500 sinon.

---

## Limites connues

- **Web Speech API uniquement** : fonctionne sur Chrome (Android, desktop) et Safari (iOS 14.5+).
  Firefox et les navigateurs intégrés aux applications (Instagram, LinkedIn, Gmail…) ne la gèrent pas —
  un message explicite s'affiche alors.
- **Qualité de la transcription** : dépend du micro, du bruit ambiant et du volume des haut-parleurs.
  Les orateurs ne sont **pas** distingués ; les prompts en tiennent compte.
- **Coupures** : les navigateurs mobiles arrêtent la reconnaissance régulièrement. L'app redémarre
  automatiquement, mais quelques mots peuvent se perdre à la jonction.
- **Arrière-plan** : si le téléphone est verrouillé ou l'app quittée, le navigateur suspend le micro.
  Garder l'écran allumé — le Wake Lock s'en charge quand il est disponible.
- **Horodatage** : relatif au temps d'écoute cumulé, pas à l'heure réelle de la réunion.
- Chrome envoie l'audio à un service de reconnaissance Google ; Safari utilise la reconnaissance Apple.

## Confidentialité

- L'audio n'est **jamais** stocké ni transmis par cette application : il est traité par le moteur de
  reconnaissance vocale du navigateur.
- La transcription ne quitte le téléphone que lors d'un appel à `/api/claude` (questions, réponse ou
  bilan) — envoyée à l'API Anthropic pour cet appel seulement, jamais persistée côté serveur.
- Contexte, transcription et bilan sont conservés dans le `localStorage` du téléphone, et effaçables
  via « Réinitialiser la session ».
- `ANTHROPIC_API_KEY` reste exclusivement côté serveur. Le mot de passe applicatif est stocké dans le
  `localStorage` du téléphone pour éviter de le retaper : c'est un garde-barrière contre l'usage de
  votre quota API, pas un système d'authentification.
- **Prévenez vos interlocuteurs** : enregistrer ou transcrire une réunion sans le dire est, selon les
  juridictions et les contextes, discutable — voire illégal.

## Licence

Usage personnel.
