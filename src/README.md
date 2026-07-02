# `src/` — moteur Apps Script

> Poussé tel quel dans le projet Apps Script (via `clasp push`, déploiement auto sur merge).
> Tout document est **classé** (plus de file de revue depuis le 2026-07-01) ; l'idempotence
> vit dans l'**Index** de la Sheet d'état (jamais un label Gmail — scope `gmail.readonly`).

| Module | Rôle |
|--------|------|
| `Config.gs` | Configuration centrale (aucun secret — la clé API vit en Script Properties) |
| `Main.gs` | Orchestration du tick + déclencheurs + chien de garde + rejeu de version |
| `Pipeline.gs` | Traitement unifié d'un document (doublon → technique → média → OCR → LLM → routage) |
| `Gmail.gs` | Source 1 : PJ des mails récents (lecture seule) |
| `Intake.gs` | Source 2 : dépôt manuel `00 · À trier` (déplacement) |
| `Partages.gs` | Source 3 : fichiers partagés récents (copie, ADR-0005) |
| `Migration.gs` | Campagne de re-classement de l'existant (#8, gatée par tag) |
| `Ocr.gs` | Extraction de texte (conversion Drive + OCR, REST) |
| `Llm.gs` | Classification (Haiku, escalade Sonnet bornée) + parsing strict |
| `Router.gs` | Décision de routage/nommage + dossiers spéciaux (`_Doublons`, `_Technique`, `_Médias`) |
| `Entites.gs` | Référentiel d'entités (proposition filtrée, consolidation, validation, curation) |
| `Corrections.gs` | Apprentissage few-shot depuis l'onglet `Corrections` (ADR-0003) |
| `Formulaire.gs` | Formulaire Google de correction (find-or-create + lecture des réponses) |
| `Journal.gs` | État Sheet : Index (idempotence), Journal borné, Santé, quarantaine |
| `Resume.gs` | Résumé hebdomadaire par mail |
| `Cout.gs` | Mesure du coût LLM réel (cible < 10 $/mois) |
| `Prefiltre.gs` | Pré-filtres déterministes Phase 3 (mots-clés, zone protégée) |
| `Intentions.gs` | Phase 3 : actions/RDV détectés dans les mails → Tasks/Calendar |
| `Tasks.gs` / `Calendar.gs` / `GoogleApi.gs` | Clients REST Google (création seule) |
| `DriveRest.gs` | Opérations Drive REST (déplacement/renommage/raccourci — jamais de suppression) |
| `Maintenance.gs` | Outils manuels (`dequarantaine`, `rangerToutLeDrive`) + mécanique du grand rangement |

Détails d'architecture : `docs/ARCHITECTURE.md` · garde-fous : `CLAUDE.md` §2.
