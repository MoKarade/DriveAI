# ADR-0027 — Limite cognitive des sous-dossiers (~7, loi de Miller)

- **Statut** : accepté (plan architecte NotebookLM, chantier C28-31, 2026-07-28)
- **Décideur** : Marc (demande 2026-07-28 : « je veux un maximum de genre 7 dossiers par dossiers »)
- **Complète** (ne révise pas) : ADR-0023 (taxonomie à PLAT — « 1 entité validée = 1 dossier à la
  racine du domaine ») et ADR-0002 (taxonomie/entités).

## Problème

La taxonomie à plat d'ADR-0023 crée **un dossier par entité validée** directement sous son domaine.
Au fil du temps, ça sature : 12 anciens employeurs ⇒ 12 dossiers dans `05 · Carrière`. La structure
reste *correcte* mais devient **illisible** — on ne retrouve plus rien d'un coup d'œil.

Tension architecturale frontale : la règle « max ~7 » s'oppose mécaniquement au « 1 entité = 1
dossier » d'ADR-0023. Il faut imposer la limite **sans** briser la taxonomie ni le routage.

## Décisions

1. **Règle des 7 ± 2.** Un dossier ne devrait pas contenir plus de ~7 sous-dossiers directs pour
   rester lisible (`REORG_MAX_SOUS_DOSSIERS_IDEAL: 7`). L'alerte ne se déclenche qu'à la
   **tolérance** (`REORG_MAX_SOUS_DOSSIERS_TOLERANCE: 9`) — on n'embête pas Marc pour un 8ᵉ dossier.

2. **Application ASYNCHRONE (Réorg + Chat), jamais dans le flux vivant.** Le routage nominal
   (`Router.gs`) et la consolidation (`Consolidation.gs`) **ne sont pas touchés** : ils continuent de
   créer les dossiers d'entités validées normalement. L'enforcement est délégué à la **Réorg IA** et
   à l'**Assistant Chat**, qui *proposent* des regroupements thématiques (ex. « Anciens employeurs »)
   dès qu'un dossier atteint la tolérance. **Marc valide, le moteur déplace.**

   *Pourquoi ce choix* — deux raisons non négociables :
   - **Divergence des formules** (leçon §7) : faire refuser au flux vivant la création d'un 8ᵉ
     dossier, en inventant un sous-dossier thématique à la volée, créerait **deux logiques de
     classement concurrentes** (flux vivant vs campagne de consolidation) → les fichiers se
     re-déplaceraient en boucle. La Règle Unique (`sousCheminDomaine_`) reste seule maîtresse.
   - **« Granularité = enrichissement, jamais frein »** (§7) : bloquer une création parce que le
     dossier est plein enverrait des documents en revue ou au mauvais endroit. La contrainte est
     **cognitive/visuelle**, elle ne doit JAMAIS gater un classement.

3. **Exemptions.** Sont exclus du décompte et de la règle :
   - les **dossiers d'année** (`/^\d{4}$/`, ex. `02 · Finances/2026`) — le temps est linéaire et ne
     se regroupe pas thématiquement ; ils dépasseraient 7 par construction ;
   - la **zone protégée `04 · Immigration`** — déjà exclue de l'inventaire de la Réorg par
     ascendance (`aParentEtrangerProtege_`, échec fermé).

4. **Élégance : aucun code de routage à changer.** Si la Réorg déplace le dossier de l'entité
   `Robovic` sous un nouveau parent `05 · Carrière/Anciens employeurs`, le flux vivant continue d'y
   ranger les fiches de paie **sans aucune modification** : le référentiel `Entités` pointe vers le
   **`Dossier ID` Drive**, pas vers un chemin. Où que le dossier soit déplacé, le flux le retrouve.

## Mise en œuvre

- **Config.gs** : `REORG_MAX_SOUS_DOSSIERS_IDEAL` (7), `REORG_MAX_SOUS_DOSSIERS_TOLERANCE` (9).
- **Reorg.gs** : `inventaireDossiers_` compte les sous-dossiers directs (**hors années**) →
  `nbSousDossiers` ; `resumeArborescence_` (PURE) ajoute un flag textuel explicite au-delà de la
  tolérance : `#1 | 05 · Carrière (12 fichiers, 10 sous-dossiers ⚠️ TROP DE DOSSIERS, À REGROUPER)` ;
  `promptReorg_` ordonne le regroupement (créer un parent thématique + y déplacer).
- **WebApp.gs** : `promptChatAssistant_` porte la même règle de lisibilité (proposition proactive via
  l'outil `proposer_reorg`).
- **Router.gs / Consolidation.gs : INTOUCHÉS** (vérifié en revue).

## Garde-fous (§2)

- **Aucune suppression** : un regroupement = `creer` (le parent thématique) puis `deplacer` — jamais
  de corbeille, jamais de fusion destructrice.
- **Zone protégée** : `04 · Immigration` hors inventaire (échec fermé, inchangé).
- **Convergence** : le regroupement passe par le chemin GARDÉ existant (proposition → validation de
  Marc → `appliquerUneAction_`), pas par une campagne automatique — donc pas de boucle possible.
- **Budget LLM** : **aucun appel supplémentaire**. On enrichit les prompts existants (Réorg + Chat) ;
  le flag n'est émis que pour les dossiers réellement saturés (coût en tokens quasi nul).
- **Idempotence** : le pipeline principal reste vierge de cette contrainte purement cognitive.

## Conséquences

- Marc garde des dossiers lisibles sans que le classement automatique ne soit jamais ralenti.
- La règle est *incitative* (le LLM propose), pas *coercitive* : rien ne bouge sans validation.
- Un dossier peut légitimement dépasser 7 en attendant que Marc valide un regroupement — c'est voulu.
