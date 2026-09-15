# ADR-0059 — Annexe B : qui accède à Gmail et à Drive, et à quel prix

> Produite le 2026-09-15 (DriveAI `d5fef1c`). C'est la pièce qui établit le **mur Gmail** (scopes restreints, CASA, expiration 7 j), ce que le moteur lit et persiste aujourd'hui, et le **chiffrage** d'une lecture LLM de tout l'Index et de tous les mails.

# Rapport — Qui accède à Gmail et à Drive dans la pile de Marc (état au 2026-09-15, DriveAI `d5fef1c`)

## 1. Scopes déclarés par le moteur Apps Script, et projet GCP

**[Certain]** `src/appsscript.json` (l. 9-17) déclare exactement 7 scopes :

```
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/script.external_request
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/script.send_mail
https://www.googleapis.com/auth/script.scriptapp
https://www.googleapis.com/auth/forms
```

Plus `"webapp": {"executeAs":"USER_DEPLOYING","access":"ANYONE_ANONYMOUS"}` (l. 5-8) : la web app `/exec` est publique, gardée par secrets (`WEBAPP_SECRET`, `SYNC_SECRET`, `MCP_SECRET`).

**[Certain]** Projet GCP : le projet **par défaut, CACHÉ** d'Apps Script, n° `289462394116` — ADR-0041 l. 11-12 : « l'API Tasks n'est pas activée dans le projet GCP PAR DÉFAUT d'Apps Script (289462394116). Ce projet est CACHÉ : aucune console n'y donne accès, à personne. » Gmail/Drive/Sheets y restent (ADR-0041 §4 l. 80 : « le projet caché ne porte plus que Gmail/Drive/Sheets »). `tasks` et `calendar.events` ont été **retirés** du manifeste le 19/08 (ADR-0041 §5, l. 107-126) et passent par un jeton du projet hubperso.

**[Certain]** Verrou : `test/scopes.test.js` — chaque scope déclaré doit avoir un consommateur réel (`GmailApp\.` pour `gmail.modify`, `DriveApp\.|ScriptApp\.getOAuthToken\(\)` pour `drive`…), et inversement ; prouvé par mutation.

**[Certain]** Contrainte constitutionnelle sur `gmail.modify` — `CLAUDE.md` §1.3 (l. 64-71) : « les SEULES écritures permises sont poser un libellé **existant** sur un fil et archiver (retrait de la boîte, réversible). Restent interdits **à jamais** (verrou CI `surface-gmail-ecriture`, check requis) : toute suppression/corbeille Gmail, toucher au Spam, créer/détruire/**retirer** un libellé, service avancé et REST Gmail. » Origine : ADR-0012 (levée contrôlée de `gmail.readonly` → `gmail.modify`, décision Marc 2026-07-06).

**[Certain]** Un second jeton existe côté moteur : `src/JetonHubperso.gs` (ADR-0041 §2 l. 32-48) — client OAuth Web dans le projet **hubperso**, refresh token en Script Properties, scopes `tasks` + `calendar.events` (« SENSIBLES, pas restreints », l. 47-48). **Aucun accès Gmail/Drive par ce jeton.**

## 2. Scopes des apps web (DriveAI sur Vercel, hubperso)

**[Certain]** DriveAI app web — `api/_lib.ts` l. 32-38 :

```ts
export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');
export const SCOPES_IDENTITE = 'openid email';   // l. 43
```

En-tête du même fichier (l. 15-17) : « le périmètre OAuth reste STRICTEMENT celui de l'app (Sheets + Drive + Tasks + Calendar, **JAMAIS Gmail** — §2.3 moindre privilège) ». Le refresh token vit dans un cookie `HttpOnly` chiffré AES-256-GCM (l. 10-12), durée 1 an (`UN_AN_S`, l. 47).

**[À vérifier — incohérence documentaire]** Projet GCP de ce client : `docs/DEPLOIEMENT.md` l. 262 dit « Dans le **même projet Google Cloud** que le script Apps Script », or ADR-0041 établit que ce projet est caché et inadministrable. Le client OAuth de l'app vit donc forcément dans un projet **standard** (lequel n'est pas nommé dans le dépôt). Le même doc (l. 268-269) dit « l'app peut rester en mode “test” — usage perso », alors que `drive` est un scope restreint et que le mode Test fait expirer les jetons à 7 j (cf. §3) — pourtant l'app fonctionne « sans jamais se reconnecter ». Soit l'écran de consentement est en fait « En production » non vérifié, soit le doc est périmé : à lire dans la console GCP, pas dans le dépôt.

**[Certain]** hubperso — `auth.ts` l. 25-35 : provider Google avec `authorization: { params: PARAMS_AUTORISATION }` ; `lib/jetonsGoogle.ts` l. 33-49 :

```ts
export const PORTEE_TASKS = "https://www.googleapis.com/auth/tasks";
export const PORTEES_GOOGLE = `openid email profile ${PORTEE_TASKS}`;
export const PARAMS_AUTORISATION = { scope: PORTEES_GOOGLE, access_type: "offline", prompt: "consent" };
```

Commentaire l. 35-38 : « Volontairement limitées à l'identité plus Tasks : **ni Drive, ni Agenda, ni Gmail**. DriveAI et FinanceAI n'utilisent pas ce cookie ». `auth.ts` l. 29 : « Le hub n'appelle AUCUNE API Google. » Seul appel réseau Google dans hubperso : `oauth2.googleapis.com/token` (refresh, `jetonsGoogle.ts` l. 66). Ces portées sont identiques dans les 4 apps Auth.js (Hubperso, JobAI, CarAI, BatchChef) qui partagent un cookie de session (`docs/CONNEXION-UNIQUE.md` l. 215-219, tableau : FinanceAI = `drive.appdata` ; DriveAI = `drive`, `spreadsheets`, `tasks`, `calendar.events`, `calendar.readonly`).

**Synthèse « qui touche quoi »** [Certain] :

| Composant | Gmail | Drive | Projet GCP |
|---|---|---|---|
| Moteur Apps Script | `gmail.modify` (lecture + libellé existant + archivage) | `drive` complet (RW, jamais `files.delete`) | caché `289462394116` |
| App web DriveAI (Vercel, navigateur de Marc) | aucun | `drive` complet + `spreadsheets` | standard (non nommé) |
| Jeton hubperso du moteur | aucun | aucun | hubperso (`tasks`, `calendar.events`) |
| Hubperso / JobAI / CarAI / BatchChef | aucun | aucun | hubperso (`tasks` + identité) |
| FinanceAI | aucun | `drive.appdata` seulement | (hors périmètre) |

## 3. La règle sur les scopes RESTREINTS, et ce qu'une nouvelle app Next.js peut faire

**[Certain]** `CLAUDE.md` §9, l. 838-842 : « La CATÉGORIE des scopes borne la voie (b) : un scope RESTREINT (`gmail.modify`) sur un projet standard exige une vérification Google (CASA) ou expire tous les 7 jours en mode Test — Gmail/Drive restent donc à JAMAIS sur le projet caché ; vérifier la catégorie d'un scope AVANT de proposer un changement de projet. »

**[Certain]** ADR-0041 §1, l. 25-28 : « **Gmail et Drive restent sur le projet par défaut** — NON NÉGOCIABLE techniquement : `gmail.modify` est un scope RESTREINT ; sur un projet standard il exige une vérification d'éditeur Google (CASA) ou le mode Test dont les autorisations expirent tous les 7 jours (moteur mort chaque semaine). L'exemption des scripts sur leur projet par défaut est ce qui permet à DriveAI d'exister. »

**[Certain]** `docs/HUBPERSO.md` l. 21-25 (le même mur, vu du côté Tasks) : « En mode “Test”, Google coupe l'autorisation **tous les 7 jours** — le moteur mourrait chaque semaine. “En production” non vérifié suffit : les scopes demandés (`tasks`, `calendar.events`) sont *sensibles*, pas *restreints*. »

**Conséquence pratique pour une nouvelle app Next.js sur Vercel (projet GCP standard) :**

- **[Probable]** Non, pas « en continu sans vérification » au sens strict. Tous les scopes Gmail de lecture (`gmail.readonly`, `gmail.modify`, `gmail.metadata`…) sont classés **restreints** par Google. Deux issues seulement, et le dépôt les nomme toutes deux : (a) écran de consentement en mode **Test** ⇒ refresh token invalidé au bout de **7 jours** ⇒ re-consentement hebdomadaire manuel (lecture « continue » impossible, c'est exactement le « moteur mort chaque semaine » de l'ADR) ; (b) écran « En production » ⇒ **vérification Google** obligatoire pour les scopes restreints, avec évaluation de sécurité tierce **CASA** (payante, annuelle).
- **[À vérifier]** Nuance à confirmer contre la doc Google du jour : une app « En production » **non vérifiée** demandant des scopes restreints peut, pendant un temps, continuer de fonctionner pour son propriétaire avec l'écran « application non validée » et un plafond de 100 utilisateurs — et le dépôt en porte un indice empirique : l'app web DriveAI demande `drive` (restreint) depuis un projet standard et « ne se reconnecte jamais » (§2). Mais rien dans le dépôt ne prouve que Gmail est traité pareil, et la règle écrite du projet dit l'inverse. Ne pas bâtir dessus sans test réel de 8 jours.
- **[Certain]** La seule voie sans vérification ni expiration pour lire Gmail est celle qu'utilise déjà DriveAI : **un script Apps Script sur son projet par défaut**, exécuté par le compte de Marc. Donc une nouvelle app qui veut le contenu des mails passe par le **moteur existant comme relais** (patron ADR-0042 : `/exec` gardé par secret, le moteur lit, le serverless ne détient aucun scope Gmail) — jamais par un scope Gmail propre.

## 4. Comment DriveAI lit les mails aujourd'hui

Trois scans, tous sur `GmailApp` (jamais REST Gmail — interdit par `surface-gmail-ecriture`), tous suspendus ensemble sur quota épuisé (`Gmail.gs` l. 9-50, Property `DriveAI_GMAIL_QUOTA`, re-sonde `GMAIL_QUOTA_RESONDE_MS` = 2 h).

**a) Intake des pièces jointes** (`Gmail.gs`, `Intake.gs`, `Pipeline.gs`) [Certain]
- Requête `GMAIL_REQUETE: 'has:attachment newer_than:30d'` (`Config.gs` l. 219), page `PAGE_FILS: 20`.
- Champs lus par message : expéditeur, sujet, date, pièces jointes (`getAttachments`, `Gmail.gs` l. 87). La PJ est copiée dans Drive, OCR via l'API Drive REST (`Ocr.gs`), texte tronqué à `ANALYSE_V2_OCR_MAX_CARS: 12000` (l. 41).
- **Envoyé au LLM** (`Llm.gs` l. 173-178) : `Nom du fichier`, `Expéditeur`, `Sujet`, `Extrait du contenu` (12 000 car.) + exemples few-shot des corrections de Marc ; modèle `claude-sonnet-4-6`, **2 passes** (l. 118-130). **Le corps du mail n'est pas envoyé** dans ce flux.
- Idempotence : clé `messageId|i|nom|taille` dans l'Index.

**b) Intentions** (`Intentions.gs` l. 357-430, `Prefiltre.gs` l. 76-90, `Llm.gs` l. 880-898) [Certain]
- Requête `GMAIL_REQUETE_ACTIONS: 'newer_than:30d'` (TOUS les mails), page 20.
- Étages gratuits d'abord : mots-clés (`PREFILTRE_MOTIFS_REJET`), zone protégée (`MOTS_CLES_PROTEGES_INTENTIONS` : ircc, csq, visa, passeport, arc, cra…), heuristique phishing, promo non lue.
- Puis **mini-check Haiku** sur `expéditeur + sujet` seuls (`LLM_MAX_TOKENS_MINICHECK: 24`). Le corps n'est lu (`getPlainBody`, tronqué `LLM_CORPS_MAX_CARS: 3000`) **que si** le mini-check a vu une action ou un mail important ; il est alors envoyé à `appelIntentions_` (Haiku, `Expéditeur / Sujet / Corps (extrait)`, 500 tokens max, fallback Sonnet).
- Clés Index : `analyse|<messageId>`, `intention|<messageId>`, `important|…`, statuts `intention-ecartee` / `intention-zone-protegee`.

**c) Tri de la boîte** (`TriGmail.gs` l. 836-935, `miniCategorie_` l. 165-212) [Certain]
- Requête `TRI_REQUETE: 'newer_than:30d in:inbox'` ; scans cyclique (`TRI_CYCLIQUE_MAX_FILS_JOUR: 150`) et nettoyage profond (`TRI_BOITE_MAX_FILS_JOUR: 150`) ; écritures bornées `TRI_MAX_FILS_PAR_RUN: 30`.
- Champs lus : expéditeur, sujet, noms des PJ, en-tête `List-Unsubscribe`, catégorie Promotions, lu/non-lu. `getPlainBody` est lu **uniquement** pour la garde zone protégée (l. 935), **pas envoyé au LLM**.
- **Envoyé au LLM** (l. 198) : `'Expéditeur : … \nSujet : …'` + liste des libellés existants ; Haiku, 1 appel par fil.
- Clé `tri|fil|ts|lu|r2` (`TRI_REGLES_VERSION`).

**Ce qui est PERSISTÉ** [Certain] — métadonnées seulement :
- ADR-0007 §2 (l. 31-41) : « La Sheet d'état ne stocke **que des métadonnées** : Index : `Clé · Traité le · Fichier · Domaine · Chemin · Statut · Empreinte` [MD5]. Journal : horodatage, source, message = statuts, noms de fichiers, codes HTTP, compteurs. → **Règle durable** : ne jamais persister le corps d'un document dans l'état ni les logs. »
- `CLAUDE.md` §9 « Vie privée » : « Ne JAMAIS persister le corps d'un document (texte OCR, contenu) dans l'Index ni le Journal — uniquement des métadonnées (nom, date, chemin, statut, empreinte = hash). Le texte des documents ne sort que vers l'API Anthropic pour le classement (transit assumé, ADR-0007) ; il ne se stocke nulle part. »
- Verrou : `test/privacy.test.js` (`indexAjouter_` n'écrit que 8 colonnes, même si on lui glisse `texteOCR`/`contenu`/`corps`). `Journal.gs` l. 1010-1017 confirme.
- **Nuance** [Certain] : pour un mail, la colonne « Fichier » de l'Index reçoit le **sujet** (`nom: sujet`, `Intentions.gs` l. 376, 381…). C'est une métadonnée au sens ADR-0007, mais un sujet de mail est déjà du contenu léger — à garder en tête pour toute base de connaissances.

**Volumes et quotas** :
- [Certain] Runtime déclencheurs ~90 min/j (compte gratuit), enveloppe interne des campagnes de fond 63/65 min/j (HANDOVER l. 960) ; budget par tick 3 min sous V2 (`ANALYSE_V2_BUDGET_MS`), tick toutes les 5 min.
- [Certain] Quota d'appels Gmail journalier partagé, non chiffré dans le code (comment `Config.gs` l. 259-260 : « ~150 fils ≈ 2 % du quota ») ; [Probable] Google documente 20 000 lectures/écritures Gmail par jour pour un compte grand public. Chaque campagne de fond est bornée à 150 fils/j ; historique Gmail terminée (12 min/j réallouables, 8 prêtées).
- [Certain, relevé live `etat_moteur` 15/09 08:59] tri cyclique 17/150 fils aujourd'hui, quota Gmail « actif », 0 erreur. Ordre de grandeur du flux : ~90 fils triés/j (HANDOVER l. 2173) ; septembre à mi-mois : 124 appels tri, 113 appels intentions, 14 appels intake-gmail (= 7 PJ en 2 passes).

## 5. Chiffrage d'une lecture LLM de TOUT l'Index et de tous les mails

**Bases mesurées** [Certain] :
- Index : **19 422 documents** (`etat_moteur`, 15/09 08:59 ; la question dit 19 420).
- Coût par document, Sonnet 2 passes : **0,0261 $** (ADR-0018 l. 22, dry-run 100 docs) ; **0,0361 $** re-mesuré le 21/08 (HANDOVER l. 965-971, +38 %, 3 routes concordantes) ; septembre live : re-analyse 0,656 $ / 26 docs = **0,0252 $**, intake-gmail 0,170 $ / 7 docs = 0,0242 $.
- Débit runtime mesuré : campagne c28-92 à 8 min/j ⇒ 440 docs restants « ~25 j » (`etat_moteur`), soit **~17-18 docs/j ≈ 27 s de runtime par document**.
- Frein : `CONFIG.LLM_BUDGET_CAMPAGNES: 40` (l. 107), régime de croisière < 10 $/mois (§1.6) ; mois courant 1,20 $.

**Tous les documents de l'Index (19 420)** :

| Poste | Bas (0,0261 $) | Haut (0,0361 $) |
|---|---|---|
| Coût LLM total | **~507 $** | **~701 $** |
| Mois sous frein 40 $/mois | ~13 mois | ~18 mois |
| Mois sous frein 10 $/mois (croisière) | ~51 mois | ~70 mois |

Temps machine [Probable, dérivé de 27 s/doc] : 19 420 × 27 s ≈ **146 h de runtime** ⇒ ~1 100 j (~3 ans) au budget actuel de 8 min/j de la re-analyse ; ~135 j si on lui donnait TOUTE l'enveloppe de 65 min/j (ce qui gèlerait consolidation, missions, réconciliation) ; ~97 j au quota brut de 90 min/j (impossible : l'intake vivant et le chien de garde y vivent aussi). À titre de comparaison, l'ADR-0018 avait déjà écarté la re-analyse de 3 733 docs pour ≈ 97 $ (« hors de question », l. 24).

**Tous les mails** : le nombre total de mails **n'est écrit nulle part dans le dépôt** [Certain] — seule la fenêtre 30 j est lue en continu ; l'historique n'a été parcouru que pour `has:attachment`. Chiffrage par tranche de 10 000 mails, à partir de `LLM_PRIX` (l. 64-67) et des coûts live :
- Lecture « à la façon du tri/intentions » (Haiku, expéditeur + sujet + corps 3 000 car.) : ~0,0012 $/appel mesuré sur les mini-appels, **~0,002-0,004 $/mail** avec corps [Supposition] ⇒ **20-40 $ / 10 000 mails**.
- Lecture « à la façon d'un document » (Sonnet 2 passes) : **~250-360 $ / 10 000 mails** [Probable].
- Contrainte dure : côté quota Gmail, 150 fils/j par campagne de fond ⇒ **~67 j / 10 000 fils** ; relever ce plafond a déjà tué le tri vivant (804 erreurs « too many times », `Config.gs` l. 237-238).

Conclusion de section [Certain] : au régime de croisière (10 $/mois), une lecture complète de l'Index est un projet de **4 à 6 ans** ; sous le plafond de rattrapage (40 $), un an et plus, et il faudrait sacrifier toutes les autres campagnes de fond pour tenir sous 6 mois. Le vrai goulot n'est pas le dollar mais les **90 min/j de runtime** et le quota Gmail — sauf à sortir le traitement d'Apps Script, ce qui ramène à la question du §3 (qui détient alors le scope).

## 6. Le garde-fou « ce qui sort du compte Google se tranche par ADR »

**[Certain]** Il existe, et il est écrit à trois endroits.

`CLAUDE.md` §9, règle « Vie privée » : « **Ce qui SORT du compte Google de Marc se juge à part, et se tranche par un ADR** : le texte des documents vers claude.ai (ADR-0042 §3), le nom du dernier document classé vers hubperso.com (ADR-0057 §3). Chaque sortie nomme la frontière franchie ET le garde-fou obtenu en échange — jamais une permission nue. »

ADR-0042 §3 (l. 60-63) : « **Confidentialité (révision assumée d'ADR-0007)** : `lire_document`/`question_documents` font TRANSITER du texte de document moteur → Vercel → claude.ai. Même famille que le transit Anthropic déjà assumé ; RIEN n'est stocké ni loggé côté Vercel (`no-store`, pas de log de contenu), et la porte est la clé d'accès de Marc. L'état serveur reste métadonnées seulement. »

ADR-0057 §3 (l. 78-101) : « **Le fait NEUF, lui, est réel** : jusqu'à aujourd'hui aucun nom de fichier ne **sortait** du compte Google de Marc. […] Publier un nom au hub le fait voyager moteur → Vercel → hubperso.com. C'est cette frontière qui est franchie, et c'est elle que cet ADR assume — comme l'ADR-0042 §3 l'a fait pour le texte des documents vers claude.ai. **Le garde-fou reçu en échange**, et il est précis : **le nom voyage dans `details`, JAMAIS dans `metrics`.** Hubperso **persiste** les métriques : sa table `releves` (Neon) archive `metriques` en JSONB, avec 90 jours de rétention […] Un nom placé en métrique […] ne ferait pas que sortir du compte de Marc, il s'y **installerait**. Dans `details` il transite, s'affiche, et disparaît. `app/test/hub-summary.test.ts` verrouille la contrainte. »

Socle : ADR-0007 §1 (l. 24-29) assume le seul transit historique — le texte des documents vers l'API Anthropic, « rétention zéro », « on assume le transit » — et §2 fige « métadonnées seulement » dans l'état (verrou `test/privacy.test.js`).

**Ce que ça impose à toute base de connaissances** [Certain, par lecture des trois textes] : (1) un ADR AVANT le code, qui nomme la frontière (quel contenu, vers quel hôte, persisté ou transitoire) ; (2) un garde-fou en échange, testé (ex. « jamais dans une table qui persiste ») ; (3) l'état de Marc reste métadonnées + hash ; (4) le contenu ne sort que par les relais déjà gardés (moteur `/exec` + secret), jamais par un nouveau scope Gmail/Drive sur un projet standard (§3). Une base de connaissances qui **stocke** le texte des mails ou des documents hors du compte Google serait une frontière **nouvelle** — plus large que 0042 (transit) et 0057 (un nom) — donc un ADR à part entière, pas une extension de l'un d'eux.

**Fichiers cités** : `/home/user/DriveAI/src/appsscript.json`, `/home/user/DriveAI/api/_lib.ts`, `/home/user/DriveAI/src/Config.gs`, `/home/user/DriveAI/src/Gmail.gs`, `/home/user/DriveAI/src/Intentions.gs`, `/home/user/DriveAI/src/TriGmail.gs`, `/home/user/DriveAI/src/Prefiltre.gs`, `/home/user/DriveAI/src/Llm.gs`, `/home/user/DriveAI/src/Ocr.gs`, `/home/user/DriveAI/src/Journal.gs`, `/home/user/DriveAI/src/JetonHubperso.gs`, `/home/user/DriveAI/test/scopes.test.js`, `/home/user/DriveAI/test/privacy.test.js`, `/home/user/DriveAI/docs/adr/0007-securite-vie-privee.md`, `/home/user/DriveAI/docs/adr/0012-tri-gmail-natif.md`, `/home/user/DriveAI/docs/adr/0018-reanalyse-ciblee-v2.md`, `/home/user/DriveAI/docs/adr/0041-tasks-calendar-projet-hubperso.md`, `/home/user/DriveAI/docs/adr/0042-mcp-driveai.md`, `/home/user/DriveAI/docs/adr/0057-le-hub-voit-ce-que-le-moteur-fait.md`, `/home/user/DriveAI/docs/COUTS.md`, `/home/user/DriveAI/docs/HUBPERSO.md`, `/home/user/DriveAI/docs/DEPLOIEMENT.md`, `/home/user/DriveAI/CLAUDE.md`, `/home/user/DriveAI/HANDOVER.md`, `/home/user/hubperso/auth.ts`, `/home/user/hubperso/lib/jetonsGoogle.ts`, `/home/user/hubperso/docs/CONNEXION-UNIQUE.md`.