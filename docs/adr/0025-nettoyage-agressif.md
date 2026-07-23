# ADR-0025 — Nettoyage agressif & corbeillage en lot (batch)

- **Statut** : accepté (décision Marc 2026-07-23, « c'est toujours un bordel » ; 3 axes cochés :
  vider l'ancien à fond, fichiers mal classés, encore trop de dossiers — le tout SANS nouvelle
  validation manuelle item-par-item). Plan validé par l'architecte (NotebookLM) puis exécuté par
  Claude Code (protocole §4).
- **Révise ADR-0014 (corbeille des dossiers vides)** : autorise l'exécution **en lot (batch)** au
  clic de Marc dans l'app — la vérification live par dossier (vacuité STRICTE, hors zone 04, type)
  reste intacte AVANT chaque mutation. Le moteur ne supprime toujours **rien** (§2).
- **Complète ADR-0023/0024** (taxonomie à plat + consolidation) : ré-emploie la RÈGLE UNIQUE
  `sousCheminDomaine_` (aucune nouvelle formule de routage).

## Contexte

Le recensement du 2026-07-16 (`docs/diagnostics/2026-07-16-recensement-drive.md`) : `_Technique`
sur-capture des exports HTML de MAILS (`Message_Inconnu.html`, `Correspondance_Inconnu.html` —
169 « Inconnu »/255) ; `05 · Carrière` porte des dizaines de dossiers fantômes d'entreprises de
CANDIDATURE ; la consolidation `conso-2` draine les fichiers mais laisse des **coquilles vides**
derrière elle. Le moteur de CRÉATION est déjà verrouillé (seed + entités validées, ADR-0024) ;
restent le PASSIF et la CORRECTNESS.

## Décision

1. **Corbeillage en lot (app, axe 1 — PR3)** : bouton « Tout corbeiller » dans `Reorg.tsx`. Le clic
   itère sur les candidats `vide-candidat` et applique `corbeillerDossierVide` (vérification pure
   LIVE : vacuité stricte corbeillés inclus + hors zone 04 + type dossier) AVANT chaque appel Drive,
   s'arrêtant proprement à la première erreur ou au premier dossier re-rempli. L'effort de Marc tombe
   à ~1 clic pour N dossiers. Le moteur ne corbeille jamais (seul `app/src/corbeille.ts` porte
   `trashed`, verrou de surface `app/test/aucune-suppression.test.ts` inchangé).
2. **Détection auto des coquilles vides (moteur, axe 1 — PR2)** : lors de l'exécution de la
   consolidation (`ConsolidationExec.gs`), après un `moveTo` réussi, si l'ANCIEN parent est devenu
   STRICTEMENT vide (aucun fichier, aucun sous-dossier) ET non protégé (hors 04, remontée d'ancêtres),
   le moteur inscrit une ligne `vide-candidat` dans l'onglet `Réorg` (constat seul, jamais de
   suppression). Idempotent (clé par `fileId` de dossier).
3. **Aplatissement des candidatures (prompt v2, axe 2 — PR1)** : `PROMPT_PASSE2` (Llm.gs) — une
   entreprise VISÉE en candidature (05) où Marc n'a jamais travaillé n'est JAMAIS une entité de
   classement → `sousDossier` = null (à plat). Renfort : le verrou RÉFÉRENTIEL (ADR-0024) route déjà
   à plat toute entité non validée ; l'audit §8 le PROUVE (le dossier fantôme ne peut plus naître).
4. **Exports de mails re-classés (router, axe 2 — PR1)** : `estExportDonnees_` (Router.gs) exclut les
   noms de correspondance (`Message_`, `Correspondance_`, `Courriel_`, `Courrier_`, `Conversation_`)
   du dépôt automatique en `_Technique` → ils repartent au pipeline pour un classement au domaine.
   Placé APRÈS le filtre social (un vrai export Messenger « messages » pluriel reste `_Technique`).
   PÉRIMÈTRE : n'inclut PAS `Relevé_` (ambigu financier ↔ export) — laissé au LLM. N'affecte que le
   flux VIVANT (les 169 fichiers déjà dans `_Technique` relèvent d'une ré-analyse ultérieure).

## Garde-fous & risques

- **§2 (aucune suppression moteur)** : PR2 n'inscrit qu'un constat `vide-candidat` ; PR3 corbeille via
  l'app seule, au clic, avec re-vérification live. Verrous de surface inchangés.
- **Zone 04** : jamais marquée vide-candidat ni corbeillée (garde d'ascendance, échec fermé).
- **Protocole §8 (routage)** : axes 2 touchent Llm.gs/Router.gs → ADR (ce doc) + audit `~20 docs
  réels` (`test/audit-logique.test.js`) AVANT mutation + non-régression (les faux positifs
  historiques restent classés, jamais en revue).
- **Convergence (axe 3)** : la cible reste `sousCheminDomaine_` (règle unique, tripwire existant
  `consolidation.test.js`) — aucune divergence flux↔campagne introduite.

## Méthode de test

Fonctions PURES (`estExportDonnees_`, `decisionNonDocument_`, `planRoutageV2_`) + audit §8 sur
échantillon réel (candidature → plat ; export mail → classé ; contre-épreuve export social → resté
`_Technique`) + détection vide mockée (déplacement du dernier fichier → `vide-candidat`) + surface
anti-suppression (moteur `moveTo` seul ; app `corbeille.ts` seul porteur de `trashed`).
