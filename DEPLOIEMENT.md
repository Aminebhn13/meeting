# Déploiement — pas à pas

Environ 5 minutes, depuis ton PC. Tes secrets ne transitent par aucun chat :
`vercel env add` les demande en local et les envoie directement à Vercel.

---

## 1. Récupérer le code

```bash
git clone https://github.com/Aminebhn13/meeting.git meeting-copilot
cd meeting-copilot
```

Le code est sur `main` : rien d'autre à faire, tu es déjà sur la bonne branche.

## 2. Installer et connecter la CLI Vercel

```bash
npm i -g vercel
vercel login          # ouvre le navigateur, choisis « Continue with GitHub »
```

## 3. Premier déploiement

```bash
vercel --prod
```

Réponds aux questions :

| Question | Réponse |
|---|---|
| Set up and deploy? | `y` |
| Which scope? | ton compte perso |
| Link to existing project? | `n` |
| Project name? | `meeting-copilot` |
| In which directory is your code located? | `./` |
| Want to modify these settings? | `n` |

Vercel affiche une URL du type `https://meeting-copilot-xxxx.vercel.app`.
**À ce stade l'app se charge mais l'IA renvoie une erreur** : il manque les variables.

## 4. Ajouter les variables d'environnement

```bash
vercel env add ANTHROPIC_API_KEY production
# colle ta clé sk-ant-... (invisible à la saisie), puis Entrée

vercel env add APP_PASSWORD production
# choisis un mot de passe, celui que tu taperas dans l'app
```

Optionnel, pour changer de modèle :

```bash
vercel env add CLAUDE_MODEL production      # ex. claude-sonnet-5 (défaut)
```

> Ta clé Anthropic : https://console.anthropic.com/settings/keys

## 5. Redéployer pour appliquer les variables

```bash
vercel --prod
```

Note l'URL finale affichée.

## 6. Vérifier avec curl

Remplace `<domaine>` et `<APP_PASSWORD>`.

```bash
# (a) Sans mot de passe -> doit renvoyer 401
curl -s -o /dev/null -w 'sans mot de passe : %{http_code}\n' \
  -X POST https://<domaine>/api/claude \
  -H 'content-type: application/json' \
  -d '{"mode":"questions","transcript":"[00:05] test"}'

# (b) Avec mot de passe -> doit renvoyer 200 et 3 questions
curl -s -w '\nstatut : %{http_code}\n' \
  -X POST https://<domaine>/api/claude \
  -H 'content-type: application/json' \
  -H 'x-app-password: <APP_PASSWORD>' \
  -d '{"mode":"questions",
       "domain":"Chef de projet ERP dans l'"'"'industrie pharmaceutique",
       "goal":"Cadrage du lot 2 — obtenir une date de livraison ferme",
       "transcript":"[00:05] On vise plutôt une livraison au printemps. [00:22] Le budget du lot 2 reste à confirmer côté finance. [00:41] Il y a une dépendance sur l'"'"'API de facturation, l'"'"'équipe n'"'"'a pas encore répondu."}'
```

Attendu : `(a)` → `401`, `(b)` → `200` avec trois questions numérotées portant sur
le budget non confirmé, la dépendance API et la date de livraison.

---

## 7. Sur le téléphone

1. Ouvre l'URL dans **Chrome (Android)** ou **Safari (iOS)** — pas dans un navigateur
   intégré à une app (Instagram, LinkedIn, Gmail) : la reconnaissance vocale n'y marche pas.
2. **Ajoute à l'écran d'accueil** : Partager → « Sur l'écran d'accueil ».
3. Ouvre **Contexte**, remplis domaine/rôle, objet et objectif, et le mot de passe
   (`APP_PASSWORD`), puis **Enregistrer**.
4. Pose le téléphone à côté du PC, **son de la visio sur les haut-parleurs du PC**
   (pas de casque — sinon le micro n'entend que toi).
5. **🎙 Démarrer**, autorise le micro. En fin de réunion : **■ Fin + bilan**.

---

## Dépannage

| Symptôme | Cause / solution |
|---|---|
| « Mot de passe incorrect ou manquant » | `APP_PASSWORD` sur Vercel ≠ celui saisi dans Contexte. Après un `vercel env add`, il faut **redéployer**. |
| « Configuration serveur incomplète » | `ANTHROPIC_API_KEY` absente de l'environnement *production*. |
| « Erreur API Anthropic 401 » | Clé invalide ou révoquée. |
| « Erreur API Anthropic 404 (modèle introuvable) » | `CLAUDE_MODEL` pointe vers un modèle inexistant — supprime la variable pour revenir au défaut. |
| « Transcription indisponible sur ce navigateur » | Firefox ou navigateur in-app. Utilise Chrome/Safari. |
| « Accès au micro refusé » | iOS : Réglages → Safari → Microphone. Android : ⓘ dans la barre d'adresse → Autorisations. |
| L'écoute s'arrête toute seule | Normal sur mobile, l'app relance automatiquement. Garde l'écran allumé et l'app au premier plan. |
| Rien n'est transcrit | Le son de la visio est dans un casque, ou le volume des haut-parleurs est trop bas. |
