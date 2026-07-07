# ADR-0015 — Analyse documentaire v2 (Sonnet 2 passes) : durcissement + PRÉ-REQUIS d'activation

- **Statut** : Accepté (chantier #26, C26-05→C26-08). Code livré **derrière le flag éteint** ;
  l'ALLUMAGE reste conditionné aux pré-requis ci-dessous + feu vert coût de Marc.
- **Décideurs** : Marc (« fiabilité maximale, Sonnet 2 passes, quitte à coûter plus cher »,
  2026-07-07), Claude.
- **Complète** : ADR-0002 (taxonomie/entités/nommage), ADR-0004 (fiabilité), le chantier #26
  (C26-05 pipeline 2 passes, C26-06 câblage routage v2, déjà mergés PR #104).
- **Contexte immédiat** : revue flotte des 3 spécialistes sur le code #26 mergé —
  sécurité 🟢, code « rien de bloquant + 1 correctif important », quotas « OFF neutre + pré-requis
  avant allumage ». Cette ADR cadre le **durcissement** issu de ces retours et fixe les
  **conditions d'activation** du flag.

## Problème & Objectif

Le pipeline v2 (`classifierDeuxPasses_` + `deciderRoutageV2_`, `CONFIG.ANALYSE_V2`) est prêt mais
**dormant**. Trois écarts à combler avant qu'il soit sûr de l'allumer :

1. **Correctness (important)** : le prompt v2 dit « un non-document ne porte jamais de domaine » →
   le modèle peut renvoyer `domaine: null`. Or `parserClassification_` **exige** un `domaine` string
   → un export/dump légitime serait **rejeté → quarantaine**, exactement le cas que la refonte
   visait à écarter proprement vers `_Technique`/`_Médias`.
2. **Garde-temps (important)** : `BUDGET_MS` (270 s) est calibré pour Haiku 1 passe. Sonnet ×2
   (12000 car. d'entrée, retries possibles) peut faire finir un document démarré près du budget
   au **ras du mur dur des 6 min**, gaspillant 2 appels Sonnet et élargissant la fenêtre
   `placer→Index` (risque de 2ᵉ copie au rejeu).
3. **Hygiène (mineur)** : le nom de sous-dossier v2 (`sousDossierPourNom_`) est créé sans passer
   par `champ_` → un `sousDossier` contenant `/ : *` créerait un dossier au nom littéral bizarre.

**Objectif** : rendre l'allumage du flag **sûr** (aucune quarantaine à tort, garde-temps adapté,
taxonomie propre) et **explicitement conditionné** (campagnes closes, surveillance coût).

## Impact quotas Google / coûts LLM (estimation)

- **Coût LLM par document, ON** : 2 appels Sonnet (entrée ~ jusqu'à 12000 car. ≈ 3–4 k tokens ;
  sortie ≤ 1000 tokens). À 3 $/MTok in + 15 $/MTok out : passe 1 ≈ (4000×3 + 400×15)/1e6 ≈ 0,018 $ ;
  passe 2 (ré-injecte la proposition, ~ +0,5 k tokens) ≈ 0,02 $. **≈ 0,03–0,04 $/doc**, soit
  **~×10–20** vs Haiku 1 passe (~0,002 $). Le coût est **compté Sonnet** (`enregistrerUsage_`,
  `indexOf('sonnet')`) → le frein §2.6 le voit.
- **Campagne de re-analyse (~2400 docs)** : ~**70–100 $** one-shot (borne haute si peu de docs
  déjà au format skip). **Plafonné par `LLM_BUDGET_CAMPAGNES` (30 $)** → la campagne s'arrête et
  reprend le mois suivant ; à REVOIR avec Marc (relever le plafond le temps du rattrapage, comme
  le 10→30 du 07-07, puis redescendre).
- **Runtime triggers (~90 min/j, quota DUR)** : Sonnet ×2 = ~20–60 s/doc vs ~2–5 s Haiku. Le flux
  vivant n'a PAS de budget journalier (seul le garde-temps par run le borne) → risque de ticks
  quasi-pleins enchaînés qui **gèlent tout le moteur** (leçon durable vécue). **Mitigation** :
  n'allumer qu'avec **campagnes closes** (moins de docs/jour = le flux vivant seul tient largement
  dans 90 min/j) + `BUDGET_MS` abaissé sous v2 (reprise propre au tick suivant).
- **UrlFetch / Drive** : +1 appel LLM/doc et +1 listage de dossier borné (`nomsDansDossier_` ≤ 500,
  lecture seule). Le quota UrlFetch (~20 000/j) n'est PAS le facteur limitant (le runtime mord avant).
- **Vie privée (ADR-0007)** : l'extrait (12000 car.) ne transite que vers l'API Anthropic, n'est
  jamais persisté ; la passe 2 ré-injecte des **métadonnées** (JSON de la passe 1), pas un dump.

## Décision

### Durcissement (code, toujours derrière le flag ÉTEINT)

1. **Parser tolérant aux non-documents** : `parserClassification_` accepte un `domaine` absent/null
   **quand la réponse est un non-document v2** (`estNonDocument === true` OU `routageHorsDomaine` ∈
   {`_Technique`,`_Médias`}). Le domaine est de toute façon ignoré pour un non-doc (routé hors
   domaines). **Le chemin Haiku (aucun champ v2) garde l'exigence stricte** — comportement OFF
   inchangé.
2. **Prompt v2 clarifié** : la consigne « un non-document n'est jamais rangé dans un domaine » dit
   désormais explicitement « mets `estNonDocument=true` + `routageHorsDomaine`, `domaine` peut
   rester null » — supprime la tension qui poussait au `domaine: null` non géré (ceinture + bretelles
   avec le point 1).
3. **Garde-temps adapté sous v2** : `budgetMsRun_()` renvoie `ANALYSE_V2_BUDGET_MS` (180 s) quand le
   flag est ON, sinon `BUDGET_MS` (270 s). ≥ 180 s de marge avant le mur dur → un document 2-passes
   pire-cas démarré juste sous le budget finit loin des 6 min, fenêtre `placer→Index` éloignée du mur.
4. **Nom de sous-dossier assaini** : `deciderRoutageV2_` passe `plan.sousDossier` par `champ_` avant
   le find-or-create (homogène avec le nommage des fichiers).

### Pré-requis d'ACTIVATION (avant de mettre `ANALYSE_V2: true`)

- [ ] **Campagnes closes** : rangement `r3` terminé (2796/2796), migration `m1` finie,
      historique Gmail terminé, `RANGEMENT_RACINES_SUP: []`. (État actuel : ✅.)
- [ ] **Plafond budget** revu avec Marc pour la campagne C26-08 (dry-run d'abord).
- [ ] **Surveillance runtime + coût** les premiers jours (heartbeat Sheet, `Cout.gs`).
- [ ] **Feu vert coût explicite de Marc** (Sonnet sur le flux vivant + campagne ~70–100 $).

### Campagne C26-08 = opération de MASSE ⇒ `dryRun_` obligatoire (protocole §2)

La re-analyse de l'existant ne s'exécute qu'après un **dry-run** qui écrit dans la Sheet le
avant/après (fichier, ancien→nouveau domaine/sous-dossier/nom) **sans rien déplacer**, pour
validation humaine. Déplacement seul, borné/jour, reprenable. Jamais de suppression (§2).

## Méthode de test (prouver sans casser l'existant)

- **Chemin OFF intact** : les tests existants + `test/llm-v2.test.js` (« réponse Haiku laissée
  INTACTE ») + surface-moteur. Un cas parser : `domaine` null SANS champ v2 → toujours rejeté.
- **Fix 1** : `parserClassification_('{"estNonDocument":true,"routageHorsDomaine":"_Technique","confiance":0.9}')`
  → objet non-null (pas de quarantaine) ; et sans champ v2 → null (strictness Haiku).
- **Fix 3** : `budgetMsRun_()` = `ANALYSE_V2_BUDGET_MS` quand `CONFIG.ANALYSE_V2=true`, `BUDGET_MS`
  sinon (test en basculant le flag dans le contexte vm).
- Fonctions pures isolées des appels Google (harness vm), `node --test`.

## Conséquences

- Allumer le flag devient une action **cadrée** (checklist + dry-run + feu vert coût), pas un
  interrupteur silencieux.
- Le pire cas d'un allumage reste **réversible** (repasser le flag à false = retour Haiku immédiat)
  et **borné** (garde-temps + frein budget campagnes).
- Le correctness fix supprime le seul risque de régression fonctionnelle identifié par la revue
  (quarantaine à tort des non-documents).

## Réversibilité

`ANALYSE_V2: false` restaure intégralement le comportement Haiku 1 passe (chemin OFF prouvé
identique). Les fonctions v2 restent définies mais inertes. Aucun scope OAuth ajouté.
