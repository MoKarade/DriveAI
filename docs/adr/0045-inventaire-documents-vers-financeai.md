# ADR-0045 — Un inventaire de documents pour FinanceAI, et pourquoi ce n'est PAS un auto-apply

- **Statut** : **Proposé** — demande la ratification de Marc avant implémentation
- **Décideurs** : Marc, Claude · **Source** : chantier « intégration entre les apps », 2026-08-20
- **Concerne aussi** : `FinanceAI` (consommateur), `hub-contract` (aucun changement)

## Contexte

DriveAI classe déjà, avec un domicile stable, exactement les documents que FinanceAI consomme :

| DriveAI range | FinanceAI expose |
|---|---|
| `02 · …/Revenus & paie/<Employeur>` | `apply_payslip` |
| `…/Impôts/<AAAA>` | `apply_tax_slip` |
| relevés bancaires / courtage | `apply_bank_statement`, `apply_broker_statement` |

Entre les deux il n'y a **rien**. Le transport, c'est Marc. Et le `RapportPaies` des mois
manquants livré par C28-49 PR2 est précisément l'information que FinanceAI devrait recevoir,
plutôt que d'être recopiée à la main.

## La décision qui compte : **inventaire, pas valeurs**

La première idée — « DriveAI pousse la paie, FinanceAI l'applique » — est **rejetée**, et il
faut dire pourquoi, parce qu'elle paraît évidente.

`apply_payslip` ne prend **pas un fichier ni un identifiant Drive**. Il prend des montants
déjà extraits (`grossAnnual`, `netAnnual`, `rrspContributedAnnual`, `employer`), et sa propre
description dit : « applique une fiche de paie que **TU as déjà analysée** […] **N'invente
jamais de chiffres** ». L'extraction est faite par un humain ou par Claude qui a lu le document.

Or le LLM de DriveAI n'extrait **pas** ces montants. Il extrait des faits de CLASSEMENT — date,
type, émetteur, entité, descripteur — pour nommer et ranger. Le construire pour extraire des
montants financiers et les pousser dans le patrimoine donnerait exactement le mode d'échec que
tout le dépôt s'interdit : **une paie mal lue écrirait un salaire faux dans les projections, avec
une sauvegarde mais aucun signal.** Ce serait crédible, silencieux, et ça se découvrirait au
moment où on croit le chiffre.

Donc DriveAI publie **ce qui existe et où**, jamais **combien**.

## Décision

### 1. Un endpoint SÉPARÉ, jamais le summary du hub

`GET /api/hub/documents` (broker Vercel, comme `summary.ts`). Le summary du hub est de
l'**affichage** : 6 métriques, 10 alertes, plafonné par le contrat. Un inventaire n'y entre pas,
et l'y forcer déformerait les deux.

Le contrat `@mokarade/hub-contract` **n'est pas touché**. Il décrit le fil hub ↔ apps ; ceci est
un fil app ↔ app.

### 2. Métadonnées d'inventaire seulement

Par période et par type : `{ type, periode, employeur?, compte?, driveFileId, classeLe }`.
**Jamais** le corps du document, jamais un montant, jamais un extrait.

ADR-0007 est respectée et il faut être précis sur ce qu'elle dit vraiment : elle interdit de
**persister le corps d'un document** dans l'état ou les logs. Les noms, chemins et domaines sont
explicitement des métadonnées, et l'Index les stocke déjà (`Clé · Traité le · Fichier · Domaine ·
Chemin · Statut · Empreinte`). Ce qui est **nouveau** ici, et qui justifie un ADR plutôt qu'un
simple ajout : ADR-0007 raisonnait dans un cadre « tout tourne dans le compte Google de Marc, pas
de serveur tiers ». Envoyer ces métadonnées à une app SŒUR sort de ce cadre — même propriétaire,
même domaine de confiance que le hub qui reçoit déjà un flux, mais ce n'est plus le cadre décrit.

### 3. Le jeton identifie l'appelant, et l'appelant ne choisit pas son périmètre

Même posture que `/api/acces` côté Hubperso : `x-hub-token`, comparaison en temps constant,
**503** si non configuré, **401** si refusé, **405** hors GET. Le jeton **identifie** FinanceAI,
donc le **domaine interrogeable est déduit du jeton**, jamais du paramètre de requête. Une app ne
peut pas énumérer l'inventaire d'un domaine qui n'est pas le sien.

### 4. Point à point, pas un bus

FinanceAI appelle DriveAI directement. Pas de file de messages dans le hub : il est délibérément
sans état (il fetch et il rend), et pour cinq apps avec deux ou trois arêtes réelles, un bus
coûterait plus que ce qu'il rapporte. Si les arêtes se multiplient, la question se rouvre — elle
ne se pré-décide pas ici.

### 5. Ce que FinanceAI en fait : une LISTE, jamais une écriture

FinanceAI compare l'inventaire à ce qu'il a déjà appliqué et produit une liste actionnable —
« 3 paies classées dans Drive pour des mois non appliqués ». **Aucune écriture automatique.**
Seul FinanceAI sait ce qui est déjà appliqué ; c'est ce qui rend le rapprochement utile, et c'est
aussi pourquoi il doit rester chez lui.

## Conséquences

- Une action Apps Script de plus (`action=hub-documents`), donc **un déploiement du moteur** :
  la CI ne le garde pas, `deploy.yml` si (cf. CLAUDE.md §6).
- Une variable de jeton de plus des deux côtés. Jamais en dur.
- DriveAI reste ignorant de FinanceAI : il publie un inventaire, il ne sait pas qui le lit.

## Ce qui est délibérément laissé DEHORS

- **Les montants.** Voir plus haut. C'est le cœur de l'ADR, pas un détail d'implémentation.
- **Les autres arêtes** (CarAI `bail` → dettes, BatchChef → dépenses). Réelles, nettement moins
  rentables. Une arête à la fois, celle qui coûte du temps chaque mois.
- **Le sens retour** (FinanceAI dit à DriveAI « appliqué »). Demanderait un état partagé ; la
  liste suffit tant que Marc est dans la boucle.

## Alternatives écartées

- **Auto-apply des montants** — écarté, §« La décision qui compte ». Le mode d'échec est
  silencieux et se croit.
- **Passer par le summary du hub** — écarté : un inventaire n'est pas de l'affichage, et le
  contrat plafonne à 6 métriques / 10 alertes.
- **Un bus de messages dans le hub** — écarté pour l'instant : le hub est sans état par choix,
  et N=5 avec 2-3 arêtes ne le justifie pas.
- **FinanceAI lit le Drive directement** — écarté : il faudrait lui donner un scope Drive, alors
  que DriveAI a déjà l'inventaire indexé. Deux lecteurs du même Drive divergeraient.
