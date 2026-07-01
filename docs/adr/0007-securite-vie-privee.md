# ADR-0007 — Sécurité & vie privée

- **Statut** : Accepté — **majoritairement déjà en place** (posture confirmée sur le code) · un invariant à **tester** (rattaché à la fondation, roadmap #1)
- **Décideurs** : Marc, Claude · **Source** : brainstorm 2026-07-01, axe « Sécurité & vie privée »

## Contexte — le vrai modèle de menace

DriveAI tourne **entièrement dans le compte Google de Marc** (Apps Script + Drive + Sheet d'état).
Pas de serveur tiers, pas de multi-utilisateur, un seul propriétaire. Google héberge déjà tout : ce
n'est pas la surface à défendre. Les points réellement exposés sont ciblés et peu nombreux :

1. **Le texte des documents transite vers l'API Anthropic** pour être classé — y compris le contenu de
   documents sensibles (passeport, immigration, avis d'imposition). *(À noter : l'API Anthropic
   n'entraîne pas de modèle sur les données API et propose une rétention zéro — mais le contenu
   **transite** le temps de l'appel.)*
2. **La clé API** — déjà en Script Properties (`DriveAI_ANTHROPIC_KEY`), jamais en dur (CLAUDE.md §4).
3. **Les scopes OAuth** — déjà au moindre privilège : Gmail **lecture seule**, Drive RW, Tasks/Calendar
   écriture (CLAUDE.md §2/§3, `appsscript.json`).
4. **Ce que l'état persiste** — l'Index et le Journal pourraient, par négligence, accumuler du contenu
   de documents.

## Décision

### 1. Contenu envoyé au LLM : **tout envoyer tel quel** (y compris les sensibles)
La **précision** est la priorité n°1 (ADR-0001). Le texte complet donne le meilleur classement (domaine +
sous-dossier + entité + nommage par type). Compte tenu de la posture Anthropic (pas d'entraînement sur les
données API, rétention zéro possible) et du cadre **perso mono-utilisateur**, on **assume le transit**. On
ne masque pas, on ne dégrade pas le classement des sensibles vers un mode « sans LLM ». *(Réévaluable si le
cadre change — cf. Alternatives.)*

### 2. État : **métadonnées seulement — jamais le corps d'un document** *(déjà conforme, à figer par un test)*
La Sheet d'état ne stocke **que des métadonnées** :
- **Index** (`Journal.gs`) : `Clé · Traité le · Fichier · Domaine · Chemin · Statut · Empreinte`.
  L'**empreinte** est un **hash MD5** (non réversible), pas le contenu.
- **Journal** : horodatage, source, message = statuts, noms de fichiers, codes HTTP, compteurs.

**Vérifié sur le code (2026-07-01)** : aucun texte de document n'est écrit dans l'état. Seule exception —
`Llm.gs` logue, sur **JSON malformé**, un extrait de **300 car. de la réponse du modèle** (champs de
classification proposés, *pas* le corps du document) ; borné, et rotationné par le **Journal borné**
(ADR-0006). → **Règle durable** : ne jamais persister le corps d'un document dans l'état ni les logs
(métadonnées + hash uniquement). On la **verrouille par un test** dans la fondation (roadmap #1).

### 3. Audit des sensibles : **non — le Journal (borné) suffit**
Usage perso mono-utilisateur : pas d'onglet d'audit dédié. Le Journal borné (ADR-0006) trace déjà les
classements ; c'est proportionné au contexte.

## Conséquences
- **Aucun changement de comportement** côté envoi LLM (déjà le cas) ni côté stockage (déjà métadonnées).
- **Fondation (roadmap #1)** : ajouter un **test d'invariant** « aucun corps de document dans l'état/les
  logs » (ex. les écritures Index ne contiennent que des champs métadonnées ; l'extrait d'erreur LLM
  reste borné). Réduire au besoin l'extrait de `Llm.gs` si un doute subsiste.
- **Fichiers partagés (ADR-0005)** : rappel de vie privée — une **copie** d'un fichier partagé persiste
  chez Marc même si l'original est révoqué. C'est voulu (idempotence + classement), mais à garder en tête.
- Rien à changer sur les **scopes** ni la **clé API** (déjà conformes) : cet ADR l'acte explicitement.

## Alternatives écartées
- **Masquer les identifiants avant envoi** (regex n° passeport / NAS / IBAN) — écarté : Marc privilégie la
  précision et assume le transit ; à réévaluer si le cadre devient moins privé (partage, multi-utilisateur).
- **Classer les sensibles sans LLM** (mots-clés locaux) — écarté : classement trop grossier (perd le
  sous-dossier fin), contraire à la priorité précision.
- **Onglet d'audit dédié** — écarté : surdimensionné pour un usage perso ; le Journal borné suffit.
- **Sortir le traitement des sensibles hors du cloud** — hors sujet (ADR-0001 : rester sur Apps Script).
