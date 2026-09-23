# Référentiel métier — Copilote d'appel Advisor

> Ce document prime sur toute autre spécification du dépôt.
> Il décrit la mission, les acteurs, les scénarios, la chronologie et le
> comportement attendu de l'assistant IA intégré.

## 1. Mission et contexte de l'activité

Accompagner un porteur de projet depuis le premier contact jusqu'à la constitution d'un dossier
suffisamment compris, documenté, analysé et validé pour être présenté à une contrepartie de
financement.

La web app doit permettre de comprendre le projet, son intérêt économique, son porteur, son besoin
réel, ses contraintes et la crédibilité de son prévisionnel. Elle doit aider à déterminer quelle
orientation mérite d'être étudiée, quelles informations manquent et quelles réserves doivent être
présentées à l'investisseur.

Le résultat recherché est un dossier exploitable pour une décision humaine : les chiffres sont
expliqués, les hypothèses sont visibles, les risques sont identifiés et les documents sont
cohérents entre eux. **Une qualification autorise une présentation ; elle ne constitue jamais un
accord de financement.**

## 2. Acteurs et responsabilités

- **Le client** est le porteur de projet, le sponsor ou l'entreprise recherchant un financement.
  Identifier séparément le contact, les dirigeants, les actionnaires, les bénéficiaires effectifs
  et l'entité qui recevrait les fonds.
- **L'advisor** démarche les prospects, conduit les échanges, développe la relation client,
  recueille les pièces, examine les réponses, challenge les hypothèses et prépare la
  recommandation. Il est responsable du suivi de la qualification.
- **PWE** désigne l'organisation chargée de la qualification dans la chronologie de référence. Son
  articulation juridique et opérationnelle avec PWM reste à préciser ; **les deux noms ne doivent
  pas être fusionnés automatiquement**.
- **Le responsable habilité ou le comité compétent** valide la qualification selon les délégations
  internes. La recommandation de l'advisor et la décision de validation sont enregistrées
  séparément.
- **Swiss PWM AG** (PWM) et **Admiralty Capital Limited** interviennent selon l'un des trois
  scénarios de la section 3.
- **L'investisseur ou le prêteur** conserve sa propre décision sur l'engagement des fonds et les
  conditions de financement.

L'assistant IA prépare, analyse, suggère, vérifie les incohérences et organise le suivi. **Chaque
validation métier est attribuée à son responsable humain.**

## 3. Trois scénarios d'organisation

| Scénario | Fonctionnement à représenter |
| --- | --- |
| PWM seule | PWM traite l'ensemble du parcours et peut intervenir comme prêteur en son nom selon le montage documenté. |
| Admiralty seule | Admiralty traite l'ensemble du parcours et intervient comme prêteur unique. |
| PWM + Admiralty | PWM intervient d'abord, puis Admiralty prend en charge la phase de financement. |

Conserver des structurations financières séparées. **N'ajouter aucun scénario de coprêt.** Le
scénario « PWM + Admiralty » est une succession d'interventions ; il ne permet pas de déduire un
prêt conjoint.

Les sources de financement envisagées pour PWM peuvent être ses ressources propres, des fonds
empruntés ou des capitaux d'investisseurs sous mandat. Pour chaque dossier, documenter la source
réellement envisagée, le mandat, l'entité contractante et le rôle de chacun. **L'origine des fonds
ne suffit pas à identifier juridiquement le prêteur.**

L'orientation dépend de l'éligibilité, du secteur, de la capacité disponible, des quotas, du
calendrier et de la structure envisagée. Appliquer uniquement les règles effectivement renseignées
et validées. Toute orientation proposée doit être expliquée ; si les critères manquent, indiquer
**« orientation à confirmer »**.

## 4. Le travail de l'advisor

L'advisor transforme les échanges commerciaux en informations utilisables. La web app doit l'aider à :

- Identifier le bon interlocuteur, son rôle et son pouvoir de décision.
- Comprendre le projet, le montant recherché, l'utilisation des fonds et le calendrier.
- Identifier les attentes et contraintes du client : contrôle, trésorerie, actifs, garanties,
  souplesse contractuelle.
- Recueillir les pièces pertinentes et vérifier si elles sont exploitables.
- Examiner la cohérence entre le discours, les documents et le prévisionnel.
- Poser les questions qui peuvent modifier l'analyse ou l'orientation.
- Préparer les analyses, la recommandation, la revue interne et le dossier de transmission.
- Expliquer au client l'avancement réel, les compléments attendus et la prochaine étape.

L'application doit être utilisable **pendant un appel** : informations lisibles, questions courtes,
vocabulaire clair, peu de saisie manuelle.

## 5. Trois axes d'analyse

Ordre par défaut : **stratégie, juridique, financier**. L'advisor peut choisir directement une
catégorie à tout moment (section 8.13).

**Stratégie.** Activité, marché, modèle économique, proposition de valeur, expérience du
management, maturité, actifs, contrats, objectifs, dépendances. Identifier le besoin concret et les
conséquences d'un financement absent, insuffisant ou tardif.

**Juridiction et organisation juridique.** Pays concernés, sociétés, chaîne de détention,
bénéficiaires effectifs, emprunteur envisagé, droits sur les actifs, autorisations, engagements
existants, sûretés disponibles. Attribuer les conclusions spécialisées aux personnes habilitées.

**Financier.** Coût total, financement demandé, devise, ressources disponibles, apports, dettes,
trésorerie, emplois des fonds, capacité prévisionnelle. Le montant et l'urgence peuvent être
identifiés dès le premier contact.

## 6. Qualification du dossier prévisionnel

Le prévisionnel est un ensemble d'hypothèses à expliquer et à rapprocher des pièces. Distinguer
données historiques, réalisé récent, engagements signés et projections.

Examiner : revenus (volumes, prix, clientèle, contrats, pipeline, montée en charge) ; coûts (fixes,
variables, masse salariale, investissements, entretien, trésorerie) ; calendrier (acquisition,
autorisations, travaux, commercialisation, exploitation, encaissements) ; financement (apports
disponibles, dettes, décaissements, intérêts, amortissement, réserves) ; cohérence entre compte de
résultat, bilan, trésorerie et tableau des sources et emplois ; capacité de remboursement ou
logique de retour sur investissement.

Pour chaque indicateur, conserver la formule, les données, la période, la devise et les hypothèses.
**Ne pas assimiler chiffre d'affaires, résultat ou EBITDA à la trésorerie disponible.**

Tester les sensibilités pertinentes. Présenter les hypothèses de stress **comme des hypothèses**.
Aucun ratio, seuil ou rendement extrait d'un modèle ne devient automatiquement une règle du fonds.

## 7. Chronologie métier de référence (16 repères)

1. Premier contact et ouverture du dossier.
2. Premier appel de qualification avec l'advisor.
3. NDA et ouverture de la phase confidentielle.
4. Demande et suivi des documents.
5. Première préanalyse.
6. Rapport préliminaire destiné au client.
7. Deuxième échange ou demande de clarifications.
8. Analyse approfondie et hypothèses de financement.
9. Investment Memo interne.
10. Détermination du parcours de validation et préparation du comité si requis.
11. Échange avec le comité puis délibération interne, si ce parcours s'applique.
12. Traitement des points issus du comité ou de la revue interne.
13. Final Assessment et décision de qualification.
14. Mise en forme de la recommandation.
15. Confirmation de la qualification et information du client.
16. Transmission du dossier validé.

Cette référence décrit le parcours **PWE vers Admiralty**. Les parcours « PWM seule » et
« Admiralty seule » ne doivent pas imposer un transfert entre ces deux entités.

L'entrée dans le parcours reste souple. Une NDA déjà signée et couvrant le dossier est réutilisée.
Une préanalyse peut commencer lorsque les informations sont suffisamment exploitables, avec les
lacunes identifiées.

## 8. Copilote d'appel en direct

### 8.1 Mission pendant la conversation
Copilote métier de l'advisor. Écouter en continu, comprendre le projet au fil des réponses,
préparer immédiatement l'intervention la plus utile. **Le texte principal est destiné à être
prononcé par l'advisor** : première personne, français très professionnel, clair, naturel,
directement utilisable à l'oral. L'advisor garde la parole et la conduite de l'échange.

### 8.2 Déroulement habituel de l'appel
Avant l'appel, rassembler le contexte disponible. **L'advisor commence généralement par introduire
la société représentée et présenter la démarche** — toute aide s'appuie sur une fiche
institutionnelle validée. **Le client décrit ensuite brièvement son parcours, son activité, son
projet et son besoin.** Dès cette description, préparer les questions **en arrière-plan**.
L'affichage d'une suggestion ne constitue pas une invitation à interrompre le client.

Canaux : WhatsApp, Microsoft Teams, Zoom, Google Meet. Durées : 20 min, 30 min, 45 min, 1 h,
1 h 30, 2 h.

**Configuration matérielle** : l'appel se passe sur un **téléphone séparé** (Android ou iPhone),
**en haut-parleur**. La web app et le prompteur tournent sur **l'ordinateur**, qui capte le son par
son micro (intégré ou externe). Aucun accès au flux audio interne des applis d'appel.

**Test de captation au démarrage** : vérifier que les deux interlocuteurs sont intelligibles — mots,
noms, chiffres, niveau de chaque voix, bruit, écho. Une entrée micro active ne suffit pas à
confirmer que le client est correctement entendu. En cas d'incertitude sur l'attribution d'un
segment, **conserver `locuteur: incertain`** plutôt que d'attribuer au mauvais interlocuteur.

### 8.3 Compréhension continue et mémoire
Pour chaque information : qui parle, ce qui a été dit, quand, à quel projet, et si l'information
reste incertaine. Conserver le passage source ou son horodatage.

Tenir compte des phrases inachevées, négations et autocorrections. « Trois millions… enfin, deux
millions et demi » → conserver la correction. Un fragment mal entendu ne doit produire ni citation
affirmative ni donnée financière validée. Une déclaration ancienne reste identifiée comme ancienne.

### 8.4 Style des interventions
Phrases brèves, une intention et une question à la fois. Vouvoiement. Ton respectueux.
Le texte principal doit être **directement prononçable**. Les indications internes (« vérifier la
cohérence du calendrier ») appartiennent aux explications et **ne se mélangent jamais** au texte à dire.

### 8.5 Rebondir sur les propos du client
Détail entendu → lien pertinent avec le projet → question d'approfondissement. Citation fidèle.
Varier les formulations. **Ne pas déduire une compétence professionnelle du seul fait d'avoir vécu
dans une ville.**

| Propos du client | Intervention proposée |
| --- | --- |
| « J'ai vécu trois ans à Lisbonne. » | « Vous me disiez avoir vécu trois ans à Lisbonne. J'aimerais comprendre dans quelle mesure cette expérience a contribué au choix de la localisation du projet. » |
| « J'ai travaillé trois ans dans l'immobilier à Lisbonne. » | « Vous évoquiez votre expérience de l'immobilier à Lisbonne. Pour apprécier les prix retenus dans votre prévisionnel, j'aimerais savoir sur quelles observations concrètes vous vous êtes appuyé. » |
| « Notre précédent chantier avait pris six mois de retard. » | « Vous mentionniez les six mois de retard du précédent chantier. J'aimerais comprendre ce qui avait causé ce décalage. » |
| « Nous devons acheter sous 45 jours. » | « Vous évoquez une échéance de 45 jours. Pour bien apprécier cette contrainte, pouvez-vous me préciser ce qui fixe cette date ? » |
| « Plusieurs clients sont intéressés. » | « Vous évoquiez l'intérêt de plusieurs clients. Pour bien distinguer les perspectives des engagements déjà obtenus, pouvez-vous me préciser où en sont ces échanges ? » |

Ces exemples illustrent **une méthode**, ils ne sont pas à réciter.

### 8.6 Choisir la prochaine question
Priorité : question directe du client ou malentendu → contradictions et ambiguïtés importantes →
informations déterminantes manquantes → approfondissements de la phase en cours.

Ordre par défaut stratégie → juridique → financier, mais un élément financier donné spontanément
est **enregistré immédiatement**. Ne jamais redemander une info déjà claire. Si le client change de
sujet, conserver le point interrompu et aider à reprendre le fil.

### 8.7 Anticiper les réponses
Préparer plusieurs suites possibles sans les présenter comme des faits. Les branches non utilisées
**ne remplissent aucun champ** du dossier.

### 8.8 Suivi des questions
Distinguer : préparée, affichée, posée, partiellement résolue, résolue, reportée.
**Une question affichée n'est pas une question posée.** Une intervention préparée mais ignorée ne
doit pas apparaître dans le compte rendu comme un échange réel. Une réponse spontanée peut résoudre
un point sans que la question ait été posée.

### 8.9 Informations à préparer — comportement validé
Pour chaque proposition, séparément : le texte à dire ; l'objectif métier ; le propos ou document
source ; l'information à préciser ; la pièce attendue ; les suites possibles.

- **Prompteur stable.** Une intervention affichée n'est jamais réécrite silencieusement. Dès que
  l'advisor commence à la prononcer, aucune nouvelle génération ne la remplace. Le remplacement
  intervient entre deux interventions ou sur action explicite.
- **Passage automatique.** Détecter que la question a réellement été posée et que la réponse permet
  de choisir la suite. Un silence, le temps écoulé ou le simple affichage **ne suffisent pas**.
- **Réponses partielles.** Relance ciblée. Réponse spontanée à une question future → actualiser
  sans faire répéter.
- **Contrôle manuel prioritaire.** Suspendre/reprendre, revenir en arrière, choisir la suite.
  **Le bot ne réactive jamais seul le passage automatique.**
- **Approfondir.** Question plus précise sur le sujet en cours. Ne transforme pas le ton en confrontation.
- **Avancer.** Transition vers le prochain sujet. Ne valide pas les réponses, ne clôt pas un point bloquant.

Si une correction rend l'intervention inexacte : signaler qu'elle doit être actualisée et préparer
une formulation corrigée **distincte**. En cas d'incertitude sur la fin de la réponse, laisser le
contrôle à l'advisor.

### 8.10 Interrogations, objections, incohérences
Répondre à partir des **éléments institutionnels et métier validés**. Si la réponse dépend d'un
paramètre absent, proposer une formulation qui identifie ce qui doit être confirmé.
**N'inventer ni délai de financement, ni taux, ni frais, ni garantie d'acceptation.**

Une contradiction est d'abord un point à clarifier : « Vous indiquiez tout à l'heure un besoin de
deux millions, puis vous venez d'évoquer deux millions et demi. Pour que je retienne le bon
périmètre, pouvez-vous me préciser ce qui explique cet écart ? »
**Ne pas transformer un écart en jugement sur la sincérité du client.**

### 8.11 Réactivité attendue
Assistance quasi instantanée, sans attente perceptible. La disponibilité rapide ne suffit pas : la
suggestion doit être pertinente, lisible et fondée sur les propos réellement compris. En cas
d'incertitude ou de perte de contexte, **rendre cette limite visible**. La latence réelle doit être
mesurée par canal, de la réception d'un élément exploitable à l'affichage d'une phrase utilisable.

### 8.12 Fin d'appel et continuité
Adapter la conduite à la durée sélectionnée. Le temps disponible aide à prioriser ; il ne doit ni
couper le client, ni imposer les seize étapes en un appel, ni provoquer une décision prématurée.
Préparer une synthèse des éléments réellement recueillis, des points ouverts et des prochaines
actions. **Les engagements annoncés au client doivent correspondre aux décisions réellement
disponibles.** Soumettre les corrections sensibles (montants, noms, dates) à confirmation.

### 8.13 Configuration par société, durée et catégorie

| Commande | Choix | Effet |
| --- | --- | --- |
| Société représentée | Swiss PWM AG ; Admiralty Capital Limited | Charge la fiche institutionnelle, le cadre juridique de départ, les règles et modèles. |
| Durée prévue | 20 min ; 30 min ; 45 min ; 1 h ; 1 h 30 ; 2 h | Prépare une chronologie et une réserve de questions adaptées. |
| Catégorie | Stratégique ; Juridique ; Financier | Passage direct, quel que soit l'ordre initial. |
| Catégorie suivante | Strat. → Jur. → Fin. | Transition naturelle ; après Financier, propose la synthèse sans la déclencher. |
| Modifier la durée | Les mêmes six durées | Recalcule les phases à partir du temps écoulé, sans redémarrer. |

**Planifier pour toute la durée choisie.** Répartition en minutes entre introduction, stratégie,
juridique, financier, synthèse. **La somme doit correspondre exactement à la durée sélectionnée.**
Un appel de 2 h prévoit nettement plus d'approfondissements qu'un appel de 20 min.

Un changement de durée conserve le temps écoulé et recalcule le restant. Si la durée est dépassée,
le signaler et proposer de prolonger ou conclure ; **ne pas remettre le chronomètre à zéro ni
arrêter l'enregistrement**.

**Changer de catégorie sans perdre le dossier.** Le clic manuel prime. Conserver les réponses
obtenues, les points ouverts, les questions reportées et le temps consommé. Changer de catégorie
**ne valide pas** la précédente.

**Adapter à la société.** Swiss PWM AG → contexte suisse. Admiralty Capital Limited → contexte
Hong Kong. Utiliser des règles sourcées, datées et validées. Une règle manquante reste **à
vérifier**. Le choix de la société initialise le cadre, sans rendre une seule législation
applicable à toute l'opération.

## 9. Mémoire du dossier et documents *(hors périmètre de l'itération en cours)*

Chaque information conserve source, date, version et état : déclaration du client, élément
documenté, hypothèse, calcul, élément validé. **Un document reçu n'est pas automatiquement exact,
exploitable ou validé.** Pièces : « reçu », « manquant », « non applicable » (motivé), « à clarifier ».

Livrables progressifs : compte rendu, liste de pièces, Executive Summary, rapport préliminaire,
analyse financière, sources et emplois, matrice des risques, scénarios, Investment Memo, Committee
Pack, Handover Pack. Distinguer documents internes et versions client.

## 10. Qualification, orientation et transmission

Quatre décisions métier : **Qualified** ; **Qualified Subject to Conditions** ; **Further
Information Required** ; **Not Qualified**.

Pour chaque décision : auteur habilité, date, justification, conditions. Distinguer les conditions
bloquantes des réserves autorisées à accompagner le dossier.

« PWE QUALIFIED » est atteint lorsque la décision autorise la soumission et que les conditions
bloquantes sont levées. **Ne signifie pas que le financement est accepté.**

Séparer « prêt à transmettre » et « effectivement transmis ». Séparer l'étape courante, la situation
de suivi, la complétude documentaire et la décision métier. Un dossier en attente du client n'est
pas automatiquement non qualifié. **Un score interne ne constitue pas une probabilité d'obtention.**

## 11. Automatisation *(hors périmètre de l'itération en cours)*

n8n pour les workflows d'emails, relances, suivi des pièces. Obsidian pour la mémoire structurée.
Les connexions doivent être explicitement configurées et vérifiables. La qualification, les
engagements et la transmission restent associés à leurs validations humaines.

## 12. Paramètres à compléter

Règles configurables : thèse d'investissement, secteurs, pays, instruments, tickets, devises,
durées, apports, garanties, critères financiers, capacité, quotas, frais, délégations, scoring,
conditions de passage entre scénarios.

**Ne pas présenter ces paramètres comme connus tant qu'ils ne sont pas fournis et validés.** Les
modèles, exemples chiffrés et champs entre crochets sont des supports de travail : ils ne prouvent
ni politique d'investissement, ni capacité juridique, ni autorisation réglementaire, ni engagement.

Restent explicitement **à préciser** : l'articulation PWE/PWM, les modalités contractuelles des
trois scénarios, les règles exactes d'orientation.

Raisonnement attendu : besoin du client → contrainte → conséquence → question utile → élément de
preuve → analyse → scénario envisageable → validation → prochaine action.

## 13. Décisions utilisateur validées

| Élément | Décision |
| --- | --- |
| Texte principal | Prompteur stable pendant la lecture. |
| Progression | Passage automatique avec contrôle manuel prioritaire. |
| Relances | « Approfondir » ou « Avancer ». |
| Rythme | Chronologie et profondeur adaptées à la durée choisie et au temps restant. |
| Canaux | WhatsApp, Microsoft Teams, Zoom, Google Meet. |
| Appareils | Appel sur téléphone séparé de l'ordinateur. |
| Mode d'écoute | Téléphone en haut-parleur. |
| Téléphones | Android et iPhone. |
| Durée | 20 min, 30 min, 45 min, 1 h, 1 h 30, 2 h ; modifiable pendant l'appel. |
| Société | Boutons Swiss PWM AG et Admiralty Capital Limited. |
| Cadre juridique | Suisse pour PWM ; Hong Kong pour Admiralty ; autres juridictions prises en compte. |
| Catégories | Boutons Stratégique, Juridique, Financier, Catégorie suivante ; aller-retour sans perte. |

**Option non retenue à ce stade** : affichage de repères d'analyse discrets. L'analyse des
incohérences reste active en interne et alimente les propositions.
