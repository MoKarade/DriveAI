# ADR-0033 — Unification du rangement : le flux vivant adopte la structure Reset validée

- **Date** : 2026-08-01
- **Statut** : accepté (décisions Marc, audit §8 du 2026-08-01 :
  1. **Cible** = « Oui, structure Reset profonde » — le flux vivant range chaque nouveau document
     dans l'arbre thématique validé du Reset (ADR-0030), plus à plat ;
  2. **Approche** = « Flux délègue à la règle Reset » — une seule règle partagée, verrouillée par
     tripwire, comme la consolidation l'a fait).
- **Chantier** : #44 — Vague 3b

## 1. Problème — deux mondes de rangement qui divergent sur ~100 % des documents

L'audit §8 (`test/audit-logique.test.js` + probe sur les 20 docs RÉELS de la preuve #26) a montré
que le **flux vivant** et le **grand rangement (Reset)** rangent le même document à des endroits
**différents pour ~tous les documents** :

| Document réel | Flux vivant (avant) | Structure Reset (validée, ADR-0030) |
|---|---|---|
| Attestation CNAM | `01 · Administratif` (à plat) | `01/Attestations & certificats` |
| Attestation « Lyonnaise de Banque (CIC) » | `02 · Finances/2026` | `02/Banques/CIC` |
| Relevé | `02 · Finances/2026` | `02/Relevés/2026` |
| Reçu TPE (2016) | `02 · Finances/2016` | `02/Reçus & factures/Archives` |
| Réclamation Desjardins Assurances | `03 · Logement` (à plat) | `03/Véhicules/Assurance auto` |
| CV Marc Richard | `05 · Carrière` (à plat) | `05/CV & lettres` |
| Certification IMERIR | `06 · Études` (à plat) | `06/IMERIR` |
| **Relevé Desjardins** (entité validée) | `02 · Finances/Desjardins` | `02/Relevés/2026` |
| **Paie Robovic** (entité validée) | `05 · Carrière/Robovic` | `05/Employeurs/Robovic` |

Ce n'est pas un cas de bord : c'est **structurel et quasi total**. La cartographie (agent Explore)
confirme que le flux vivant, la **consolidation** et les **reliquats LLM** partagent DÉJÀ une seule
règle plate (`sousCheminDomaine_`, Router.gs, verrouillée par le tripwire
`test/consolidation.test.js`) ; la vraie divergence est le **Reset** (`cheminCibleReset_` +
`STRUCTURE_CIBLE_RESET`, Reset.gs) — un arbre thématique profond, routé par le NOM. Conséquence
directe : le flux « défait » ce que le Reset a rangé, et réciproquement — le risque documenté de
**« déplacer en boucle »**, sur tous les documents.

## 2. Décision

Le flux vivant **délègue le calcul de son sous-chemin à la même fonction pure que le Reset**,
`cheminCibleReset_(domaine, nomFinal)`, sur le **nom final** qu'il vient de produire
(`AAAA-MM-JJ_Type_Émetteur.ext`). Concrètement, dans `planRoutageV2_` (Router.gs), APRÈS les gardes
inchangées (non-document, fail-safe ADR-0016, domaine par défaut) :

1. calculer `nom = nommerDocument_(...)` ;
2. `rel = cheminCibleReset_(domaine, nom)` ;
3. si `rel` **non-null** → cible = ce chemin thématique multi-niveaux (résolu segment par segment
   avec **exactement** `sousDossier_`, comme `resoudreCibleReset_`) — **convergence flux↔reset par
   construction** ;
4. si `rel` **null** → **REPLI** sur le routage historique (identité par type, entité validée,
   année, à plat) — le Reset lui-même laisse ces documents à sa passe LLM du reliquat ; le flux, qui
   ne peut pas s'offrir une 2ᵉ passe LLM par document, retombe sur son classement actuel (jamais de
   limbo).

Une seule règle, deux consommateurs, **verrouillée par un tripwire** : pour tout document que le
Reset sait router, `planRoutageV2_(...).sousDossier === cheminCibleReset_(domaine, nom)`.

## 3. Ce qui NE change PAS (garde-fous §2 préservés)

- **Zone `04 · Immigration`** *(corrigé après revue code-reviewer — la description initiale « null →
  inchangé » était FAUSSE)* : `cheminCibleReset_('04 · Immigration', …)` **route en INTERNE** les
  documents reconnus (`IRCC (fédéral)`, `MIFI (Québec)`, `Permis de travail & EIMT`, `Résidence
  permanente`, `Formulaires & correspondance`) et ne rend null que pour un doc 04 sans motif (→ repli,
  à plat DANS 04). **Conséquence RÉELLE, à ratifier par Marc** : l'intake neuf de 04 est désormais
  placé dans ces sous-dossiers thématiques (structure validée ADR-0030), plus à plat / `04/AAAA`.
  Le garde-fou DUR §2.1b **tient** : le sous-chemin est TOUJOURS relatif au domaine (résolu sous
  `idDomaine_(04)` par `sousDossier_`, aucune remontée), donc **aucune sortie automatique de 04** —
  et §2.1b autorise explicitement la **réorganisation INTERNE** de 04. Le flux ne calcule jamais un
  chemin hors du domaine arrêté par le LLM/l'identité.
- **Fail-safe ADR-0016** (tout-NULL → `00 · À vérifier`) et **non-document** : gardes en TÊTE de
  `planRoutageV2_`, AVANT la délégation. La délégation ne s'applique qu'aux documents `classé`.
- **Granularité = enrichissement, jamais frein** : `rel` null ne met JAMAIS en revue — il retombe
  sur le classement historique. Un doc va toujours quelque part.
- **Aucune suppression, aucun nouveau scope, aucun secret.** Changement de calcul de CHEMIN
  uniquement.

## 4. Impact quotas & coût

- **Quota Google / runtime** : nul en régime — `cheminCibleReset_` est PURE (zéro I/O). La création
  des dossiers thématiques multi-niveaux (`sousDossier_` par segment) coûte quelques appels Drive
  la PREMIÈRE fois qu'un chemin naît, puis rien (find-or-create idempotent). Comparable au Reset.
- **Coût LLM** : **nul** — aucune passe LLM ajoutée ; on ne fait que router autrement une sortie
  déjà produite. (La délégation ne déclenche PAS la passe reliquat : le flux retombe à plat sur
  null, il ne relance pas de LLM.)

## 5. Risques & méthode de test

- **Risque : re-classement de l'existant.** Le flux ne DÉPLACE pas le déjà-rangé ; il change
  seulement l'emplacement des **nouveaux** documents. Les docs déjà classés à plat convergeront
  quand le Reset (ou la consolidation) les repassera — c'est précisément ce que l'unification rend
  cohérent (plus de va-et-vient).
- **Risque : divergence des deux formules.** Éliminé par construction (même fonction) + **tripwire**
  `test/routage-unifie.test.js` : pour un échantillon de docs, `flux.sousDossier === reset`.
- **Non-régression** : les ≥ 3 faux positifs historiques (CV sans émetteur, note perso, export) NE
  doivent PAS partir en revue (audit-logique reste vert) ; le fail-safe ne se déclenche toujours que
  sur du tout-NULL.
- **Audit avant/après VISIBLE** (protocole §8.2) : le probe sur les 20 docs réels re-tourné APRÈS
  montre la **convergence** (flux == reset sur les cas routables), rendu à Marc.
- **Revue flotte adversariale AVANT merge** : `structure-keeper` (cohérence taxonomie/arbre) +
  `code-reviewer`.

## 6. Suites (notées, dont deux relevées par la revue flotte)

- **Forward des années (revue structure-keeper — CORRIGÉ dans cette PR)** : les buckets d'année de
  `STRUCTURE_CIBLE_RESET` étaient un instantané historique figé (2021-2026 + Archives). Comme le flux
  vivant délègue désormais ici et AVANCE dans le temps, tout doc 2027+ serait tombé dans `Archives`.
  `resetBucketAnnee_` rend maintenant son propre segment pour une année POSTÉRIEURE au dernier bucket
  (`Relevés/2027`), Archives seulement pour le passé hors fenêtre (léger dépassement ≤ 7 au fil des
  ans, ASSUMÉ vs un mauvais rangement). **Évolution possible** : fenêtre glissante avec purge du plus
  ancien vers Archives (mutation) — à trancher avec Marc si le dépassement ≤ 7 devient gênant.
- **Référentiel d'entités ↔ table Reset (revue structure-keeper — HORS PÉRIMÈTRE, suite Vague 3c)** :
  le chemin délégué du flux pose `dossierIdCible: ''` et route les ~20 entités codées EN DUR dans la
  table (EDF, CIC, Desjardins, Robovic…) **par NOM**, en ignorant le `Dossier ID` du référentiel
  `Entités` (ADR-0028). `repointerEntites_` n'est appelé QUE côté reset/reorg, jamais dans
  `deciderRoutageV2_`. Risque : dossier d'entité-table relocalisé (seed à plat, regroupement ADR-0027)
  → doublon/orphelin + `Dossier ID` périmé. À réunifier (le chemin délégué consulte `dossierEntiteParId_`
  pour le dernier segment quand c'est une entité validée, + re-pointe) OU à verrouiller par un test que
  le flux ne recrée jamais un dossier concurrent d'un `Dossier ID` valide. Le repli, lui, respecte déjà
  le référentiel (bypass circonscrit aux entités DE LA TABLE).
- **2ᵉ passe conditionnelle** (coût) et **few-shot injecté en v2** : changements de CLASSEMENT
  (§8) traités séparément, chacun avec son audit sur réel.
- **Frein budget encadré au 1er août** (§2.6 / ADR-0018) : décision de plafond, séparée.
