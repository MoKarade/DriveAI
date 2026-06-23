# Plan projet — DriveAI

> Plan de référence. Adapté du brief de démarrage (ex-« DriveFlow »). Tout est verrouillé
> sauf la section « Points ouverts ». Le découpage opérationnel est dans `BACKLOG.md`.

---

## 0. Objectif & critère de réussite

**But.** Un Google Drive qui se range tout seul. Les pièces jointes utiles des mails et les
fichiers déposés à la main sont analysés, renommés selon une convention stricte, et classés
dans une arborescence granulaire — sans intervention, sauf une file de revue rapide pour les
cas incertains.

**Réussite (vision finale, atteinte en 4 phases).**
- Plus de ménage manuel dans Drive.
- Les PJ des mails atterrissent au bon endroit, bien nommées.
- Les fichiers déposés dans `00 · À trier` sont replacés automatiquement.
- La structure est granulaire (un dossier par logement, par véhicule, par diplôme…) et se maintient seule.
- Les tâches/dates qui ressortent des mails partent dans Google Tasks ou Calendar.
- On retrouve n'importe quel doc vite (moteur de recherche + Claude + Gemini in Drive).

**Méthode : par phases livrables.** Chaque phase est utilisable seule. On ne construit pas
tout d'un bloc. Cf. §5.

---

## 1. Décisions verrouillées (cahier des charges)

| # | Décision | Valeur |
|---|----------|--------|
| Compte | Google AI Plus | Ask Gemini in Drive dispo |
| Sources | Mails Gmail (PJ) + dépôt manuel | dossier `00 · À trier` |
| Types de fichiers | **Tous** (PDF, images, docx, xlsx…) | |
| Filtrage PJ | **Le LLM juge** chaque PJ (pas de liste blanche) | pré-filtre déterministe en réserve si coût trop élevé |
| Classement | **Auto si confiance haute**, sinon file de revue | seuil de départ 0.80 |
| Granularité | **1 dossier par entité** + sous-dossiers fixes | |
| Nouvelle entité | **Passe par la file de revue** avant création | anti-prolifération de doublons |
| Multi-entités | **Raccourci Drive** dans chaque dossier (pas de copie) | |
| Doc transverse | **Dossier générique du domaine** | `entite = null` |
| Doublon | **Signalé** dans la revue (jamais effacé auto) | |
| Tri tâche/événement | **Le LLM décide au cas par cas** | heure précise → Calendar, action → Tasks |
| Fréquence | **Scan toutes les 15 min** (trigger temporel) | |
| Incidents | **Notification mail immédiate** à chaque échec | grouper si ça spamme = réserve |
| Nommage fichier | `AAAA-MM-JJ_Type_Émetteur.ext` | l'entité est dans le chemin |
| Date si absente | **Date de réception du mail** | |
| Recherche | **Moteur maison** (tags + contenu) **+ Claude** | dashboard de revue (Phase 4) |
| Legacy | **Figé en archive** à côté, on repart neuf | pas de reclassement auto de l'ancien |
| OAuth | **Moindre privilège** — Gmail **lecture seule** | Drive RW, Tasks/Calendar écriture |
| Docs sensibles | **Zone protégée** — immigration/CSQ & fiscal **jamais rangés auto** | garde-fou non négociable |
| Budget LLM | **< 10 $/mois** | |
| Interface | **Bilingue FR/EN** | |

---

## 2. Architecture technique

Choix tranché (solo, zéro budget infra, maîtrise déjà Apps Script + React/Vercel).

**Backend / moteur (Phases 1–3) : Google Apps Script.**
- Triggers temporels natifs, accès Gmail/Drive/Tasks/Calendar **en tant que Marc** (pas
  d'OAuth à gérer soi-même), gratuit.
- Scopes restreints explicitement dans `appsscript.json` (`oauthScopes`) — moindre privilège.
- LLM via `UrlFetchApp` → **API Anthropic, Claude Haiku** (le moins cher). Sonnet en fallback
  si un cas est trop ambigu.
- Clé API dans les **Script Properties** (`PropertiesService`), jamais en dur.

**État (référentiel + index + journal) : une Google Sheet.**
- « Base de données » légère, lisible/éditable à la main, accessible par Apps Script ET l'app web.
- Onglets : `Entités` (référentiel), `Index` (catalogue des docs classés + tags),
  `Journal` (log + erreurs), `Revue` (file d'attente avec suggestions).

**Interface (Phase 4) : app web React/Vite/TS sur Vercel.**
- **Dashboard de revue** (valider/corriger les suggestions) + **moteur de recherche** (tags + contenu).
- Lit/écrit l'état via l'API Google Sheets ou un endpoint Apps Script (`doGet`/`doPost`).
- **Phases 1–3 n'ont PAS besoin de l'app web** : la file de revue = le dossier Drive natif
  `00 · À vérifier`, suggestion encodée dans le nom du fichier.

**Recherche — note.** Le moteur « contenu » duplique Ask Gemini in Drive (déjà payé via AI
Plus). C'est le composant le plus lourd, gardé par choix explicite (UX unifiée). Candidat n°1
à couper si le budget/temps dérape : garder « tags » (léger), déléguer « contenu » à Gemini.

Détails dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 3. Taxonomie cible

Voir [`docs/TAXONOMY.md`](docs/TAXONOMY.md) pour les IDs de dossiers et les schémas complets
de sous-dossiers. Résumé :

- Racine **« Nouvelle structure 2026 »**, 7 domaines `NN · Nom` conservés.
- `00 · À trier` = file d'entrée (dépôt manuel). `00 · À vérifier` = file de revue.
- L'intérieur actuel est plat ; le système le rend **granulaire** : un dossier par entité,
  avec un jeu de sous-dossiers fixes selon le type d'entité.
- Domaines à fort volume (Factures, Relevés, Impôts) : **sous-dossier par année** auto.
- **Zone protégée** : `04 · Immigration` + tout doc `sensible=true` → jamais rangés auto.

---

## 4. Le flux de traitement (pipeline)

```
Trigger 15 min
  → mails Gmail [has:attachment -label:DriveAI/traité newer_than:30d]
  → dossier 00·À trier (fichiers déposés à la main)
        │
        ▼  pour chaque fichier
  ┌─────────────────────────────┐
  │ 1. Extraction               │  PJ Gmail → blob ; ou fichier de 00·À trier
  │ 2. OCR si image/PDF scanné  │  via conversion Drive → Google Doc → texte
  │ 3. Analyse LLM (Haiku)      │  → JSON {domaine, categorie, entite, type_doc,
  │                             │          date_doc, emetteur, sensible, confiance}
  │ 4. Routage                  │
  └─────────────────────────────┘
        │
        ├─ sensible == true ........................→ 00·À vérifier (zone protégée)
        ├─ confiance < 0.80 ........................→ 00·À vérifier
        ├─ entité inconnue (absente du référentiel) →  00·À vérifier (création via revue)
        └─ sinon → ranger dans Domaine/Catégorie/Entité/Sous-dossier
                   + renommer AAAA-MM-JJ_Type_Émetteur.ext
        │
        ▼
  Mail → label DriveAI/traité   |   échec → notif mail immédiate + Journal
```

**Sortie LLM (schéma JSON strict) :**
```json
{
  "domaine": "03 · Logement & véhicule",
  "categorie": "Logement",
  "entite": "Appartement Rue X (Montréal)",
  "type_doc": "Facture",
  "date_doc": "2026-03-15",
  "emetteur": "Hydro-Quebec",
  "sensible": false,
  "confiance": 0.92
}
```
`date_doc = null` → fallback date de réception du mail. `entite = null` → doc transverse →
dossier générique du domaine.

---

## 5. Plan par phases

Le découpage en tâches avec IDs est dans [`BACKLOG.md`](BACKLOG.md).

### Phase 0 — Scaffolding & automatisation *(en cours, livré ici)*
Infra de dev : CI + auto-merge, `CLAUDE.md` auto-évolutif, flotte d'agents, slash-commands,
boucle de leçons, docs de référence. **Pas de code moteur.**

### Phase 1 — Le cœur *(à construire en premier)*
**Objectif.** Un mail avec PJ → dans les 15 min, la PJ est OCRisée si besoin, analysée, puis
soit rangée dans le bon **domaine** avec un nom normalisé, soit déposée dans `00 · À vérifier`
avec la suggestion encodée dans le nom.

**Périmètre.** Routage au niveau **domaine + catégorie + type_doc**. Pas encore la granularité
par entité ni le référentiel (→ Phase 2). Pas d'app web (→ Phase 4). Source = Gmail uniquement.

**À construire** (modules Apps Script) : `appsscript.json` (scopes minimaux), `Config.gs`,
`Gmail.gs`, `Ocr.gs`, `Llm.gs`, `Router.gs`, `Journal.gs`, `Main.gs` (orchestration + trigger
15 min). Détail dans `BACKLOG.md`.

**Definition of Done — Phase 1 :**
- [ ] Un mail test avec PJ PDF est rangé dans le bon domaine, renommé au format, en < 15 min.
- [ ] Une PJ ambiguë part dans `00 · À vérifier` avec la suggestion lisible dans le nom.
- [ ] Un doc « sensible » (ex. courrier IRCC) va **toujours** en revue, jamais rangé auto.
- [ ] Pas de retraitement : idempotence via l'`Index` (clé `messageId|i|nom|taille`). *(Gmail
      reste en lecture seule → pas de label de traitement ; cf. `docs/ARCHITECTURE.md`.)*
- [ ] Un échec provoque une notif mail + une ligne dans `Journal`.
- [ ] La clé API n'est nulle part en dur.
- [ ] Coût LLM mesuré sur un échantillon réel et extrapolé (cible < 10 $/mois).

**Hors scope Phase 1 :** granularité par entité, référentiel, dépôt manuel, tâches/calendar,
app web, recherche. Discipline de scope stricte.

### Phase 2 — Dépôt manuel + référentiel d'entités
- Scan du dossier `00 · À trier` (mêmes étapes que Gmail).
- Onglet `Entités` comme référentiel : le routage vise l'**entité** ; entité inconnue → revue
  → validation → ajout au référentiel.
- Création auto des dossiers d'entité + sous-dossiers fixes une fois l'entité validée.
- Multi-entités (raccourci Drive) et doublons (signalement).
- **DoD :** un fichier glissé dans `00 · À trier` finit au bon endroit ; une entité nouvelle ne
  crée un dossier qu'après validation.

### Phase 3 — Tâches & agenda
- Détection d'actions/dates dans les mails (LLM).
- Le LLM décide : date+heure précise → événement Calendar ; action sans heure → tâche Tasks.
- **DoD :** « RDV le 3 juillet 14 h » crée l'événement ; « renvoyer le formulaire avant
  vendredi » crée la tâche.

### Phase 4 — Recherche + dashboard (app web Vercel)
- App React/Vite/TS : dashboard de revue (valider/corriger en un clic) + moteur de recherche
  (tags via `Index`, contenu via texte OCR indexé). Bilingue FR/EN.
- **DoD :** valider la file de revue depuis l'app ; retrouver un doc par tags et par contenu.

---

## 6. Contraintes & garde-fous

- **Moindre privilège** : Gmail en lecture seule, scopes déclarés dans le manifest. Pas
  d'envoi de mail au-delà des notifications système (`MailApp` sur ton propre compte).
- **Zone protégée** : immigration + fiscal jamais rangés auto. Si le LLM hésite sur la
  sensibilité, `sensible=true` par défaut (faux positif = revue, sans gravité ; faux négatif
  = risque sur le dossier CSQ).
- **Aucune suppression automatique.** Doublons signalés, jamais effacés.
- **Idempotence** : un fichier déjà traité ne l'est pas deux fois (label Gmail + vérif `Index`).
- **Quotas Apps Script** : limiter le scan à `newer_than:30d`, traiter par lots, prévoir les
  coupures de quota.
- **Budget LLM** : Haiku par défaut ; pré-filtre déterministe (expéditeur/type) en réserve.

---

## 7. Points ouverts (à décider au build, pas bloquants)

- Modèle LLM exact + chaîne de version à confirmer (Haiku courant).
- Coût réel LLM par document → à mesurer en Phase 1 sur un échantillon.
- Seuil de confiance (départ 0.80) à calibrer après observation.
- ~~Le vieux Drive « figé en archive »~~ → **tranché : Option A.** L'ancien part dans un dossier
  `_Archive 2025` à part, à côté de la nouvelle racine. DriveAI n'y touche jamais (déplacement
  manuel par Marc, hors pipeline).
- Mécanisme de revue en Phases 1–3 : suggestion encodée dans le nom (simple) vs onglet `Revue`
  de la Sheet (plus riche). Démarrer simple.

---

## 8. Pour démarrer la Phase 1

**Prérequis côté Marc avant de lancer :**
1. Créer un projet Apps Script (script.google.com) — ou scaffolder via `clasp`.
2. Mettre la clé API Anthropic dans les Script Properties (`DriveAI_ANTHROPIC_KEY`).
3. Créer la Google Sheet d'état (ou laisser Phase 1 la créer) et noter son ID.
4. Confirmer le sort du legacy (§7).

**Première tâche à lancer (quand prêt) :**

> Construis la **Phase 1** de DriveAI telle que spécifiée en §5, en Google Apps Script.
> Commence par `appsscript.json` (scopes minimaux), `Config.gs` (IDs de `docs/TAXONOMY.md`, clé
> via Script Properties) et `Main.gs` (orchestration + trigger 15 min). Respecte la zone
> protégée (§6) et le schéma JSON (§4). Travaille fichier par fichier. Ne touche à rien hors du
> périmètre Phase 1.
