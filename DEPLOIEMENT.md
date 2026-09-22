# Déploiement — sans terminal

Le code est sur `main` dans `Aminebhn13/meeting`. Tout se fait depuis le navigateur,
en ~5 minutes. Aucune commande à taper.

---

## 1. Importer le repo dans Vercel

1. Va sur **[vercel.com/new](https://vercel.com/new)** (connecte-toi avec GitHub).
2. Dans la liste, trouve **`meeting`** → clique **Import**.
   *Le repo n'apparaît pas ?* → **Adjust GitHub App Permissions** → autorise `Aminebhn13/meeting`.
3. Laisse **tous les réglages par défaut** :

   | Champ | Valeur |
   |---|---|
   | Framework Preset | **Other** (détecté tout seul) |
   | Root Directory | `./` |
   | Build Command | *(vide)* |
   | Output Directory | *(vide)* |

4. Clique **Deploy**, attends ~30 s.

Tu obtiens une URL du type `https://meeting-xxxx.vercel.app`.
**L'app s'ouvre déjà** — mais l'IA ne répondra pas encore : il manque les variables.

## 2. Ajouter les deux variables

Dans le projet : **Settings** → **Environment Variables**.

Ajoute-les une par une, en cochant bien **Production** :

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | ta clé `sk-ant-…` → [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `APP_PASSWORD` | un mot de passe que tu choisis — c'est celui que tu taperas dans l'app |

> Optionnel : `CLAUDE_MODEL` pour changer de modèle. Sans elle, c'est `claude-sonnet-5`.

## 3. Redéployer — **obligatoire**

Les variables ne s'appliquent **pas** au déploiement déjà en ligne.

**Deployments** → sur la ligne du haut, menu **⋯** → **Redeploy** → confirme.

## 4. Vérifier depuis le téléphone

1. Ouvre l'URL dans **Chrome (Android)** ou **Safari (iOS)**.
2. L'app demande le mot de passe de l'étape 2 — saisis-le, il sera mémorisé.
3. Appuie sur **🎙 Écouter**, autorise le micro, et parle quelques phrases.
   Les questions apparaissent au bout de ~45 secondes, ou immédiatement via le bouton **↻**.

| Symptôme | Cause |
|---|---|
| Le mot de passe est redemandé en boucle | Il ne correspond pas à `APP_PASSWORD`. Ou tu as oublié le **redéploiement** de l'étape 3. |
| « Configuration serveur incomplète » | `ANTHROPIC_API_KEY` manquante en Production → refais les étapes 2 et 3. |
| « Erreur API Anthropic 401 » | La clé est invalide ou révoquée. |
| « modèle introuvable » | `CLAUDE_MODEL` pointe vers un modèle inexistant — supprime la variable, redéploie. |
| « Serveur injoignable » | Pas de réseau, ou tu n'es pas sur l'URL Vercel. |

## 5. Utiliser en réunion

1. **Ajoute la page à l'écran d'accueil** : Partager → « Sur l'écran d'accueil ».
2. Renseigne le **sujet de la réunion** (optionnel, mais ça améliore nettement les questions).
3. Pose le téléphone à côté du PC. **Son de la visio sur les haut-parleurs du PC, pas dans un
   casque** — sinon le micro n'entend que toi.
4. **🎙 Écouter**. Lis les questions proposées, **tape dessus** quand tu les as posées.
5. À la fin : **■ Terminer la réunion** → bilan, puis **⬇ Télécharger .md**.

---

## Chaque mise à jour du code

Vercel est branché sur GitHub : **tout push sur `main` redéploie automatiquement**.

---

## Dépannage

| Symptôme | Cause / solution |
|---|---|
| « Transcription indisponible sur ce navigateur » | Firefox, ou navigateur intégré à une app (Instagram, LinkedIn, Gmail). Ouvre dans Chrome ou Safari. |
| « Accès au micro refusé » | iOS : Réglages → Safari → Microphone. Android : ⓘ dans la barre d'adresse → Autorisations. |
| L'écoute s'arrête toute seule | Normal sur mobile : l'app relance automatiquement. Garde l'écran allumé. |
| Rien n'est transcrit | Le son est dans un casque, ou le volume des haut-parleurs est trop bas. |
| Le bilan dit « non précisé » partout | L'info n'était pas dans la transcription. C'est volontaire : l'IA n'invente rien. |
| Tout est perdu après un changement d'app | La réunion est sauvegardée : rouvre la page, elle propose de la reprendre (moins de 12 h). |

---

## Annexe — vérification en ligne de commande

Le test de l'étape 4 suffit. Si tu préfères curl, remplace `<domaine>` et `<APP_PASSWORD>` :

```bash
# Sans mot de passe -> doit renvoyer 401
curl -s -o /dev/null -w 'sans mot de passe : %{http_code}\n' \
  -X POST https://<domaine>/api/claude \
  -H 'content-type: application/json' \
  -d '{"mode":"questions","transcript":"[00:05] test"}'

# Avec mot de passe -> doit renvoyer 200 et trois questions
curl -s -w '\nstatut : %{http_code}\n' \
  -X POST https://<domaine>/api/claude \
  -H 'content-type: application/json' \
  -H 'x-app-password: <APP_PASSWORD>' \
  -d '{"mode":"questions",
       "topic":"Cadrage du lot 2 — obtenir une date de livraison ferme",
       "transcript":"[00:05] On vise plutôt une livraison au printemps. [00:22] Le budget du lot 2 reste à confirmer. [00:41] Il y a une dépendance sur la facturation."}'

# Mode bilan -> doit renvoyer 200 et les sept sections
curl -s -w '\nstatut : %{http_code}\n' \
  -X POST https://<domaine>/api/claude \
  -H 'content-type: application/json' \
  -H 'x-app-password: <APP_PASSWORD>' \
  -d '{"mode":"summary",
       "topic":"Cadrage du lot 2",
       "asked":["Qui valide côté finance ?"],
       "transcript":"[00:05] On vise plutôt une livraison au printemps. [00:22] Le budget du lot 2 reste à confirmer. [00:41] Paul doit chiffrer avant vendredi."}'
```

## Annexe — déploiement en ligne de commande

```bash
npm i -g vercel && vercel login
git clone https://github.com/Aminebhn13/meeting.git && cd meeting
vercel --prod
vercel env add ANTHROPIC_API_KEY production
vercel env add APP_PASSWORD production
vercel --prod
```
