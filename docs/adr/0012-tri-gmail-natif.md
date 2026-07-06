# ADR-0012 — Tri Gmail natif : libellés + archivage (levée contrôlée de la lecture seule)

- **Statut** : Accepté — **à implémenter** (chantier #16)
- **Décideurs** : Marc (réponses explicites du 2026-07-06), Claude
- **Remplace** : la tâche Cowork de tri hebdomadaire de Marc (et son prompt manuel de secours)

## Contexte

Marc triait ses mails avec une tâche Cowork hebdomadaire (libellés de catégorie, archivage,
détection de suspects, liste de PJ à déposer). Il veut la **supprimer** et confier ce rôle à
DriveAI. Une bonne moitié du rôle existe déjà en mieux dans le moteur (PJ classées directement,
actions/RDV → Tasks/Calendar, classement du bac, idempotence par l'Index). Ce qui manque exige
d'**écrire dans Gmail** — jusqu'ici interdit par le garde-fou §3 (« Gmail en lecture seule »).

**Décision constitutionnelle** (procédure « le propriétaire peut relâcher un garde-fou » de
`docs/LESSONS.md`) : Marc, informé du risque (nouveau scope OAuth ⇒ gel des déclencheurs jusqu'à
ré-autorisation ; écritures dans sa boîte), a explicitement choisi « **Oui — libellés + archivage** ».
Le scope passera de `gmail.readonly` à **`gmail.modify`** (lecture/écriture SANS suppression
définitive — la corbeille n'est même pas appelée par le code).

Son Gmail possède déjà toute la taxonomie (16 catégories + ~45 sous-libellés hérités du Cowork :
`Finance/Impôt`, `Emploi/Paie`, `Administration/Amende`… + `À vérifier`, `⚠️ Suspect`, `⏰ À traiter`).

## Décisions

1. **Tri au fil de l'eau** (choix Marc) : intégré au tick (5 min) — chaque fil récent est trié à
   l'arrivée ; le résumé hebdo récapitule. Réutilise le pipeline Phase 3 existant : le mini-check
   passe de 2 à **3 signaux en un appel** (`action`, `important`, `categorie`) — coût marginal.
2. **Libellés** : le plus PRÉCIS parmi les libellés **existants** de Marc (sous-libellés inclus).
   Le moteur ne crée JAMAIS de libellé — il peut en PROPOSER dans le résumé hebdo, Marc crée. Table `expéditeur → libellé` apprise dans
   la Sheet (même mécanique que les corrections few-shot). **Règle de sûreté du prompt Cowork
   conservée : au moindre doute → `À vérifier`, jamais « le plus probable ».**
3. **Archivage prudent** (règles écrites par Marc, confirmées le 2026-07-06) : archiver = retirer
   de la boîte (réversible), uniquement les mails déjà **LUS** après libellé ; les **promos/
   newsletters** archivées même non lues ; **jamais** `À vérifier` ni `⚠️ Suspect` ; **Spam intouché**.
   **Durcissement (audit sécurité)** : la qualification « promo/newsletter » qui autorise l'archivage
   NON LU repose sur des signaux **DÉTERMINISTES** (en-tête `List-Unsubscribe`, catégorie système
   Gmail `CATEGORY_PROMOTIONS`) — le LLM peut RETENIR un archivage, jamais le déclencher seul (sinon
   un phishing rédigé en newsletter serait masqué de la boîte). Les heuristiques phishing s'exécutent
   AVANT toute décision d'archivage (ordre verrouillé par test). La table apprise
   `expéditeur → libellé` est clée sur l'ADRESSE/DOMAINE complet, jamais le nom affiché.
4. **Phishing** : heuristiques déterministes (domaine ≠ nom affiché, urgence, demande
   d'identifiants/paiement, PJ risquées) + jugement LLM → libellé `⚠️ Suspect`, le mail RESTE en
   boîte, listé **en tête** du résumé hebdo. Jamais de clic sur un lien ni d'ouverture de PJ.
5. **`⏰ À traiter`** : posé sur les mails flaggés `important` (chantier #14) — les deux systèmes
   fusionnent (libellé dans Gmail + section « À traiter » du résumé, mêmes mails).
6. **Résumé hebdo enrichi** : ① suspects en tête ; ② **newsletters jamais ouvertes** (candidates au
   désabonnement — liste seule, aucun clic). *Écartés par Marc : documents attendus manquants,
   registre des montants.*
7. **Zone protégée (immigration/fiscal)** *(décision Marc, 2ᵉ salve du 2026-07-06)* : traités
   **comme les autres** — libellés + archivage **seulement s'ils ont été LUS par Marc** — mais
   JAMAIS via le chemin « promo non lue » (un mail protégé n'est jamais archivé non lu). La
   Phase 3 continue de ne JAMAIS en extraire d'action.
8. **Stock initial** *(décision Marc)* : au premier run, le tri s'applique RÉTROACTIVEMENT à toute
   la fenêtre du scan vivant (30 jours) — boîte propre dès le premier jour, borné par run.
9. **`⏰ À traiter` jamais archivé par le moteur** *(décision Marc)* : un mail important, même lu,
   reste en boîte jusqu'à ce que MARC l'archive — sa boîte sert de todo pour ces mails-là.
10. **Pas de libellé « agent-trié »** : l'état « déjà trié » vit dans l'Index (clé par fil/message),
   comme tout le reste — le libellé d'état du prompt Cowork est un artefact de connecteur, inutile ici.

## Séquençage du déploiement (leçon « scope OAuth = gel »)

Le merge qui étend `oauthScopes` **arrête NET tous les déclencheurs** jusqu'à ré-autorisation
manuelle — et sur ce dépôt **CI verte = merge automatique**. Mécanisme OBLIGATOIRE (audit sécurité) :
(a) toute PR touchant `appsscript.json` porte le label **`do-not-merge`** (l'override de l'auto-merge)
dès sa création ; (b) le label n'est levé qu'après accord TEMPS RÉEL de Marc (« je suis dispo, on y
va ») ; (c) UN seul merge pour le scope ; (d) après ré-autorisation, vérifier le run de déploiement
réel PUIS la reprise par signaux Drive indépendants (heartbeat, libellés qui apparaissent).

## Garde-fous (inchangés ou renforcés)

- **Aucune suppression, jamais — verrou TESTABLE et REQUIS** : `gmail.modify` PERMET la corbeille
  (`messages.trash`, purge définitive à 30 j) et la destruction de libellés — le test de surface
  source est donc LE verrou. Motifs interdits dans `src/` (audit sécurité) : `ToTrash`, `ToSpam`,
  `deleteLabel`, `batchDelete`, chemins REST `/trash`|`/spam`|`/delete`, et `TRASH`/`SPAM` dans tout
  `addLabelIds`. Ce test devient un **check CI REQUIS qui gate `main`** (pas un test facultatif).
- Archivage réversible par construction (retrait du libellé `INBOX` uniquement).
- Budget : +1 signal au mini-check existant + liste des libellés en entrée ≈ **+0,5-1 $/mois**
  (cible < 10 $/mois intacte). Écritures Gmail bornées par run (quotas Apps Script).
- Idempotence par l'Index (un fil re-scanné n'est pas re-libellé/re-archivé).

## Conséquences

- `appsscript.json` : `gmail.readonly` → `gmail.modify` (SEUL changement de scope, groupé).
- `Prefiltre.gs` : mini-check à 3 signaux ; `Intentions.gs`/nouveau `TriGmail.gs` : pose des
  libellés, archivage, heuristiques phishing ; `Resume.gs` : sections suspects + newsletters.
- `CLAUDE.md` §2-3 : constitution mise à jour à la livraison (décision déjà actée ici) ; la leçon
  §7 « Gmail lecture seule = pas de label » est annotée (prémisse levée par ce chantier — la partie
  durable, l'idempotence par l'Index jamais par libellé, reste vraie et s'applique AUSSI au tri).
- `docs/ARCHITECTURE.md` § scopes : corrigée (elle affirmait à tort que `gmail.labels` suffirait à
  poser un libellé — ce scope ne gère que les DÉFINITIONS de libellés, pas la pose sur les fils ;
  `gmail.modify` est le minimum vérifié pour libellés-sur-fils + archivage).
- Marc supprime sa tâche Cowork une fois le chantier vérifié en réel.
