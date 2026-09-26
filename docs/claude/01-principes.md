<!-- Extrait de l'ancien CLAUDE.md (§ 1. Principes non négociables), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Principes non négociables

## 1. Principes non négociables

Ces règles priment sur toute optimisation. Toute PR qui les viole doit échouer la revue.

1. **Documents sensibles — classés, jamais supprimés ni détachés. Revue ULTRA-STRICTE seulement.**
   *(Décisions Marc 2026-07-01 : révise « sensible → toujours en revue » puis supprime la revue ;
   2026-07-07, ADR-0016 : ré-introduit un filet de revue ÉTROIT.)* Un **seul dossier d'arrivée**
   (`00 · À trier`). **TOUT** document est **auto-classé** dans son domaine avec son **nom final propre**
   (`AAAA-MM-JJ_Type_Émetteur.ext`), jamais un nom encodé `[REVUE] …`. **Fail-safe hybride (ADR-0016)** :
   un document ne va dans `00 · À vérifier` que si l'analyse ne porte **AUCUN fait exploitable** —
   `domaine` inconnu **ET** `emetteur` **ET** `type_doc` **ET** `entite` **ET** `descripteur` tous
   absents (`estClassificationVide_`, PURE ; les sentinelles LLM « Inconnu »/« N/A »/« - » comptent
   comme absentes). Un **seul** fait présent ⇒ classé au mieux (domaine introuvable mais un autre fait
   présent → `CONFIG.DOMAINE_DEFAUT`).
   La conjonction **ET** est l'anti-saturation NON négociable (sinon la revue neutralise l'auto-rangement
   — leçon vécue) : la revue est l'exception rare, jamais la posture. Le flag `sensible` du LLM reste
   produit mais ne route plus rien. Ce qui reste **NON négociable** : (a) **aucune suppression** (§2) ;
   (b) **`04 · Immigration` : réorganisation INTERNE permise, sortie JAMAIS automatique** *(révision
   ADR-0030 §4, ordre explicite de Marc 2026-07-29 — livrée ATOMIQUEMENT avec `src/Reset.gs`
   `reorganiserInterne04_`/`dossierInterne04Reset_` et son tripwire de surface en C28-33 PR2)*. Un fichier déjà
   rangé sous 04 peut être **déplacé D'UN sous-dossier de 04 VERS UN AUTRE sous-dossier de 04** (fusion
   de graphies, nouvelle structure ≤ 7) — jamais hors de 04. Garde multi-parents `aParentProtege_`
   (remonte toute la chaîne d'ancêtres, appliquée à la collecte ET avant chaque mutation) + tout
   résolveur de cible pour 04 **construit STRUCTURELLEMENT depuis la racine 04** (jamais un chemin
   arbitraire) : impossible par construction de cibler hors 04. Un candidat à la SORTIE de 04 (ex. un
   doc « CIC » qui est peut-être la banque, pas l'immigration) est **PROPOSÉ** à Marc, **jamais déplacé
   d'office**. Multi-parents à l'intérieur de 04 : jamais déplacé (prudence, comme la consolidation).
   (c) un doublon, **même sensible**, va dans `_Doublons` (déplacement seul), jamais effacé.
   *(Élargir la revue = assouplir `estClassificationVide_` ⇒ ré-audit anti-saturation obligatoire. Élargir
   la sortie de 04 = nouvelle révision atomique, jamais un assouplissement silencieux.)*
2. **Aucune suppression automatique.** Les doublons sont *écartés dans `_Doublons` (déplacement seul)*,
   jamais effacés. **Unique exception, ÉTROITE (ADR-0014, décision Marc 2026-07-06)** : un **DOSSIER
   devenu VIDE** après une réorg validée (#21) peut être mis à la **corbeille Drive** (récupérable 30 j)
   — uniquement par l'**APP** (`app/src/corbeille.ts`, seul fichier autorisé à porter `trashed: true`,
   verrouillé par tripwire CI), uniquement au **clic de validation de Marc**, avec re-vérification au
   clic de la vacuité STRICTE (corbeillés inclus), du type et de l'ascendance (échec fermé). **Jamais un
   fichier, jamais un dossier non vide, jamais la zone protégée, jamais une racine système, jamais le
   moteur** (surface `.gs` sans suppression, inchangée et testée). `files.delete` reste interdit partout.
3. **Moindre privilège.** Scopes déclarés explicitement dans `appsscript.json`. Gmail en
   **`gmail.modify`** *(décision Marc 2026-07-06, ADR-0012, chantier #16 — révise l'ancienne règle
   « lecture seule »)* : les SEULES écritures permises sont poser un libellé **existant** sur un fil
   et archiver (retrait de la boîte, réversible). Restent interdits **à jamais** (verrou CI
   `surface-gmail-ecriture`, check requis) : toute suppression/corbeille Gmail, toucher au Spam,
   créer/détruire/**retirer** un libellé, service avancé et REST Gmail. Drive RW, Tasks/Calendar
   écriture uniquement (Phase 3). Tout merge qui étend un scope se séquence AVEC Marc (gel des
   déclencheurs jusqu'à ré-autorisation).
4. **Aucun secret en dur.** La clé API vit dans les Script Properties
   (`DriveAI_ANTHROPIC_KEY`), jamais dans le code, jamais dans un commit.
5. **Idempotence.** Un fichier déjà traité ne l'est pas deux fois (label Gmail +
   vérification dans l'`Index`).
6. **Budget LLM : < 10 $/mois en régime de croisière.** Depuis le 2026-07-09 (ADR-0018, feu vert
   Marc après la preuve C26-07), le flux vivant tourne en **Sonnet 2 passes** (`ANALYSE_V2`). Les
   campagnes de RATTRAPAGE (grand rangement, historique Gmail, migration, re-analyse C26-08) sont un
   coût one-shot plafonné par le frein `CONFIG.LLM_BUDGET_CAMPAGNES`. Le plafond a suivi les
   campagnes : 10 → 30 (07/07) → 65 (09/07) → 110 (10/07, ADR-0018 révisée), redescendu à
   **10 le 2026-08-01**, puis remonté à **40 le 2026-08-20** pour finir C26-08 — 40 et non 30,
   parce que 885 documents restants × 0,0261 $ (coût mesuré) + 10,70 $ déjà dépensés = 33,80 $,
   et qu'un plafond à 30 aurait remis la campagne en pause à ~146 documents du but.
   À redescendre à 10 une fois C26-08 terminée, en LISANT son compteur (cf. ci-dessous).
   ⚠️ La note du 01/08 affirmait que « m1 et C26-08 sont finies ». **C'était faux pour C26-08** :
   elle était à 322 documents sur 1207 le 13/08, mise en pause par le frein — constaté par le MCP
   le 20/08, deux semaines plus tard. Une campagne déclarée terminée qui ne l'est pas ne se
   signale pas : elle cesse d'avancer, et le tableau affiche « en pause » comme un état normal.
   Ne pas déclarer une campagne finie sans lire son compteur.
   **La valeur qui fait foi est `Config.gs`, pas cette ligne** :
   Marc relève ponctuellement le plafond en éditant le fichier, et le résumé publié au hub lit
   `CONFIG.LLM_BUDGET_CAMPAGNES` plutôt que de recopier un chiffre.
   Le frein ne se désactive JAMAIS (filet anti-emballement) et ne gate JAMAIS le flux vivant.

7. **Le coût publié au hub est le CUMUL, pas le mois.** `majResumeHub_` publie
   `llmCostTotalUsd` (somme de toutes les Properties `DriveAI_COUT_*`, cf. `syntheseCoutTotal_`)
   et le broker le sert en `usage.cost.period = "total"`. Le mois courant devient un **quota**
   avec le seuil du frein pour plafond. Raison : le hub somme les coûts PAR période et refuse de
   fusionner « cumulé » et « ce mois-ci » — tant que DriveAI ne publiait que son mois, il était
   seul dans sa colonne et empêchait tout total unique. Si le cumul manque (web app en retard
   d'un déploiement), le broker retombe sur `period = "mois"` : le mois sous son vrai nom, jamais
   étiqueté « cumulé ».
   Où vont les autres chiffres : la VENTILATION par usage (C28-58) et le récapitulatif de tout
   ce qui coûte quelque chose vivent dans [`docs/COUTS.md`](./docs/COUTS.md). Ce point-ci ne
   traite que d'UNE question — sous quelle période le montant part au hub.
