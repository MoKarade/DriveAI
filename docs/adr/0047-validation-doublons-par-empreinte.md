# ADR-0047 — `_Doublons` : valider par empreinte avant de croire la détection

- **Statut** : accepté (2026-08-20)
- **Contexte** : C28-49 PR4 (ADR-0039). Bloque le rapatriement prévu par **ADR-0046 §3**
  (mission identité) : trois passeports de Marc dorment dans `_Doublons`.
- **Complète** : ADR-0039 (missions de curation), ADR-0016 (§1), P1-20 (fast-path doublon)

## 1. L'inventaire, lu EXHAUSTIVEMENT avant toute règle (protocole §11)

Les trois dossiers hors domaines, listés en entier par l'API Drive le 2026-08-20 (pas un
échantillon — leçon §9 « quand un rapport exhaustif existe, ne jamais chiffrer depuis un
échantillon ») :

| Dossier | Fichiers | Ce que la lecture montre |
|---|---:|---|
| `_Doublons` | **1 076** | 576 pdf, 165 html, 94 docx… **et des exemplaires UNIQUES**, cf. §2 |
| `_Technique` | **398** | 328 exports de mail `.html`, puis `.ics`/`.vcf`/`.p7s`/`.cs`/`.cpp` — **un seul** nom de forme documentaire, `2026-01-28_Rapport de service_Robovic.pdf`, que la règle D12 (ADR-0044) y a mis VOLONTAIREMENT |
| `_Médias` | **1 308** | 774 jpg + 332 mp4 + 83 gif + 81 png. 200 noms de forme documentaire, mais le nom n'y prouve rien : `2026-07_Relevé_Inconnu.mp4` est une vidéo |

## 2. 🔴 `_Doublons` contient des exemplaires UNIQUES — deux preuves

**Preuve A — les passeports.** Trois fichiers « Passeport » de Marc sont dans `_Doublons`, de
tailles **différentes** (737 871, 710 538, 335 945 octets) : ce ne sont donc pas des copies l'un
de l'autre. Le seul fichier « Passeport » ailleurs dans le Drive appartient à une TIERCE personne.

**Preuve B — le bulletin d'Avila.** `2017-06-01_Bulletin trimestriel` et
`2017-06-30_Bulletin scolaire trimestriel` font **exactement 1 178 426 octets** — mêmes octets,
donc vrais doublons l'un de l'autre — et sont **tous les deux** dans `_Doublons`. Le seul bulletin
d'Avila classé ailleurs fait 391 608 octets : c'est un autre document. Ce contenu-là n'existe
nulle part dans l'arborescence.

## 3. Pourquoi : `estDoublon_` répond à une question qui n'est pas la bonne

Le défaut se lit dans le code, sans instrumentation. `chargerIndexCache_` (Journal.gs) construit
`_empreintesCache` comme un **ENSEMBLE d'empreintes**, sans aucune notion de lieu :

```js
_empreintesCache[empreintes[i][0]] = true;   // « ce contenu a DÉJÀ ÉTÉ VU »
```

`estDoublon_(e)` répond donc à « ce contenu a-t-il déjà été vu ? », jamais à
**« un exemplaire est-il ENCORE classé ? »**. Les deux questions coïncident tant qu'un fichier
n'est présenté qu'une fois. Elles divergent dès qu'un fichier DÉJÀ indexé est **re-présenté** au
pipeline (reset, migration, rattrapage) sans `ignorerDoublon` : il devient **doublon de lui-même**
et part dans `_Doublons` — pendant que rien ne remarque que le dernier exemplaire classé vient de
quitter l'arborescence. Le piège est connu et documenté à trois endroits (`Migration.gs:17`,
`Intake.gs:123`, backlog C28-33 PR5) ; ce qu'aucun de ces trois ne dit, c'est que **le garde-fou
ne se referme jamais** : `_Doublons` n'est jamais relu.

C'est le pendant exact de la leçon §9 « un garde-fou qui met des items HORS CIRCUIT exige un
chemin de RETOUR auto ». `_Doublons` est une quarantaine sans dé-quarantaine.

## 4. Décision : VALIDER et RAPPORTER. Ne rien déplacer dans cette PR.

La campagne re-pose, pour chaque fichier de `_Doublons`, la question qui n'a jamais été posée :
**un exemplaire du même contenu existe-t-il encore hors de `_Doublons` ?** Trois verdicts :

- `confirmé` — un fichier de MÊME empreinte vit ailleurs. La détection avait raison. Rien à faire.
- `orphelin` — aucun. Le fichier écarté est le **seul exemplaire** de son contenu.
- `indéterminé` — empreinte indisponible (fichier Google natif : pas de `md5Checksum`).

**Aucun déplacement dans cette PR**, et c'est délibéré :

1. Un orphelin n'a pas de cible calculable. Les autres missions dérivent leur cible du nom par
   `cheminCibleReset_(domaine, nom)` — qui exige un **domaine**, que le reset tenait de son dossier
   source. Un fichier de `_Doublons` n'a pas de domaine d'origine, et beaucoup portent leur nom
   BRUT (le fast-path P1-20 nomme « date + nom d'origine », pas `Type_Émetteur`) :
   `2016-01-21_TPE.docx` ne se route pas. Inventer ici une règle nom→domaine, c'est écrire une
   DEUXIÈME règle de classement à côté de celle du flux — précisément ce que la leçon
   « une seule règle, deux consommateurs » interdit (C28-26 : les deux divergent, et la campagne
   re-déplace en boucle ce que le flux vient de classer).
2. La seule cible correcte reste donc l'analyse LLM, via `00 · À trier`. À ~0,026 $ le document
   (coût mesuré), rapatrier en aveugle coûterait jusqu'à **28 $** — sur un cumul déjà à 12,28 $ et
   un frein campagnes à 40 $. Et l'intake de `00 · À trier` est du **flux vivant**, que le frein
   §1.6 ne gate JAMAIS : la dépense passerait SOUS le garde-fou budgétaire. On ne déclenche pas
   une dépense non bornée sur une estimation.
3. Ce rapatriement re-buterait sur le piège d'origine : l'empreinte de l'orphelin est à l'Index,
   donc le fast-path le renverrait AUSSITÔT dans `_Doublons` (ping-pong) sans `ignorerDoublon`.

Le compte EXACT d'orphelins est donc le livrable. Il transforme un chantier chiffré au doigt
mouillé en une décision que Marc peut prendre avec son prix devant les yeux.

## 5. Mécanisme : `md5Checksum` de Drive, jamais l'Index

L'empreinte NE VIENT PAS de l'Index, et ce choix est structurant.

L'Index n'associe une empreinte à un `fileId` que pour les clés dont le dernier segment EST un
fileId (`PREFIXES_CLE_FICHIER_` = `drive|`, `tri33p|`, `migre|`, `reanalyse|`). Une pièce jointe
Gmail porte la clé `messageId|i|nom|taille` : **son empreinte est dans l'Index sans qu'on sache à
quel fichier Drive elle appartient.** Un jumeau classé venu de Gmail serait donc invisible, et on
déclarerait « orphelin » un fichier qui ne l'est pas — un faux positif silencieux, celui qui coûte
un document dupliqué au rapatriement.

`files.list` de l'API Drive rend `md5Checksum` **sans télécharger un octet**. C'est la même valeur
que `empreinteBlob_` (MD5 du contenu), elle existe pour tout fichier binaire, et elle est
indépendante de l'Index et de ses trous. Deux balayages :

- **Phase 1 — inventaire** : pagination de `_Doublons` (`'<id>' in parents`), une ligne par fichier
  dans l'onglet `RapportDoublons` : `[Fichier, ID, Empreinte, Verdict, Preuve, Horodaté]`.
- **Phase 2 — balayage** : pagination du Drive entier (`'me' in owners`, cf. ci-dessous) ; toute
  empreinte retrouvée sur un exemplaire encore accessible **hors `_Doublons` et hors zone
  d'attente** bascule ses lignes en `confirmé`.
- **Phase 3 — clôture** : après **deux** balayages COMPLETS (cf. ci-dessous), ce qui n'a pas de
  verdict devient `orphelin` (ou `indéterminé` si l'empreinte est vide). Bilan figé, drapeau FINI.

Trois précisions que la revue de flotte a rendues nécessaires, et qui changent le mécanisme :

**a) `'me' in owners`.** Sans ce filtre, `files.list` inclut les fichiers PARTAGÉS avec Marc — un
exemplaire appartenant à un TIERS confirmerait le doublon, alors que le tiers peut révoquer le
partage et laisser Marc sans aucune copie. §2 en donne le cas exact : le seul autre fichier
« Passeport » du Drive appartient à une tierce personne.

**b) Une ZONE D'ATTENTE ne prouve rien.** Un fichier dont le seul parent est `00 · À trier` est en
attente de traitement, pas classé — et l'intake du tick suivant, voyant son empreinte à l'Index,
l'enverra précisément dans `_Doublons`. Le compter comme survivant ferait dire « confirmé » à une
campagne qui reproduirait, une heure plus tard, le défaut qu'elle mesure. `_Technique`, `_Médias` et
`00 · À vérifier` restent des survivants : le fichier y est GARDÉ, même mal.

**c) DEUX balayages complets avant tout « orphelin ».** `files.list` paginé n'est pas un instantané
et n'a pas d'ordre stable ; pendant que le balayage s'étale sur plusieurs runs, le flux vivant et les
missions déplacent des fichiers. Un fichier déplacé entre la page *k* et la page *k+1* peut
n'apparaître dans **aucune** page — et l'on prononcerait « orphelin » sur une preuve d'absence
trouée. La seconde passe ne cherche plus que les candidats restants. C'est le patron déjà en vigueur
pour la campagne Gmail (« terminé quand DEUX passes consécutives ne collectent plus rien », §9).
Coût : ~34 requêtes REST au lieu de ~17, toujours sans télécharger un octet.

L'état vit dans l'ONGLET, pas dans une Property : 1 076 empreintes ≈ 43 Ko, très au-delà des ~9 Ko
d'une Script Property (leçon §9). Seuls les jetons de pagination et les curseurs y sont persistés.

**Asymétrie voulue.** Une collision d'empreinte ferait conclure `confirmé` à tort → **inaction**.
L'erreur inverse (`orphelin` à tort) ne coûte, dans cette PR, qu'une ligne de rapport. Le prédicat
sévère est du bon côté (leçon §9 « l'asymétrie des verdicts commande la sévérité du prédicat »).

## 6. Budget : 3 min/j prélevées sur la marge, PAS sur une campagne vivante

Enveloppe reset-OFF actuelle : 20 (Gmail histo) + 2 (conso) + 12 (conso exec) + 12 (sync) + 0
(fusion, parkée) + 4 (historique vrac) + 10 (missions) = **60 min/j** pour un plafond dérivé de
**65** (`test/orchestration.test.js`). `DOUBLONS_BUDGET_JOUR_MS = 3 min/j` porte la somme à **63**,
sous le plafond, et la constante est AJOUTÉE à la somme de l'invariant (leçon C28-42 : une
campagne de fond sans constante quotidienne rend le test structurellement aveugle).

3 min/j suffisent largement : ~34 requêtes REST de 1 000 fichiers (deux passes, cf. §5c), zéro
téléchargement, zéro LLM. La campagne est **one-shot** — convergée, elle ne coûte plus que deux
lectures de Property par tick, et son bilan est FIGÉ dans une Property pour que la ligne Santé cesse
de relire l'onglet à chaque tick.

Elle n'a **pas** d'entrée dans le registre de suivi C28-44 : celui-ci est saturé (8 377 des 8 500
octets du plafond dérivé, 42 clés à ~199 octets — 123 de marge). Une 43ᵉ ferait échouer le tripwire
de plafond (`test/suivi.test.js`) ; le flush lui-même dégrade proprement, mais la place n'y est plus.
La campagne se rend donc visible par une ligne **Santé** — qui porte aussi sa DERNIÈRE ERREUR, faute
de « dernier skip » dans l'app.

Ce n'est pas la bonne réallocation à terme : **`GMAIL_HISTO_BUDGET_JOUR_MS` (20 min/j) est le
donneur évident** — `HANDOVER.md` le dit « probablement TERMINÉ » et son compteur du jour est à 0
fils. « Probablement » n'est pas une preuve, et la leçon §1.6 est explicite (« ne pas déclarer une
campagne finie sans lire son compteur ») : la réallocation attend cette preuve. Consigné au backlog.

## 7. Ce que la campagne NE fait PAS

- **Aucune mutation Drive.** Lecture seule de bout en bout — y compris le résolveur : `_Doublons`
  est retrouvé par `idDoublonsSansCreer_`, jamais par `dossierDoublons_()` qui est un
  find-or-**CREATE** et ferait apparaître un dossier vide dès que la Script Property manque. Un
  `_Doublons` vide fraîchement créé aurait donné « terminée — 0 écartés », verdict terminal et
  inversé. Verrouillé par un tripwire en **liste blanche** : la seule méthode HTTP autorisée dans le
  fichier est `get` (une liste noire de motifs `DriveApp` ne peut pas verrouiller un module qui parle
  REST — un `method: 'patch'` avec `addParents` déplacerait un fichier sans écrire `moveTo`), plus
  l'interdiction nominale des déplaceurs maison. `§2` n'est même pas sollicité : rien ne bouge.
- **Aucun appel LLM.** Le coût de la campagne est nul.
- **`_Technique` : aucune mission, et c'est un résultat, pas un oubli.** 398 fichiers, un seul nom
  documentaire, posé là exprès. La sur-capture d'exports de mails a été corrigée en C28-28 PR1
  (`estExportDonnees_`) et les données le confirment. Construire une mission ici ferait payer un
  re-balayage quotidien pour zéro trouvaille.
- **`_Médias` : un constat écrit ici, pas une machine.** Le nom n'y est pas une preuve (les
  `Relevé_Inconnu.mp4` sont des vidéos). Trois fichiers méritent quand même l'œil de Marc, parce
  qu'ils démentent une promesse de C20-01 (« exception zone protégée/sensible : jamais
  rétrogradée ») : `2026-01-19_Formulaire fiscal_ARC.pdf`, `2025-02-04_Pièce d'identité_Inconnu.jpg`,
  `2026-06-29_Photo d'identité_Inconnu.jpeg`. Ils sont peut-être antérieurs au garde-fou. Backlog,
  avec leur nom — pas une campagne qui re-scannerait 1 308 fichiers chaque jour pour trois cas.

## 8. Suite

`orphelin` est un verdict, pas une action. Une fois le compte connu :
- **ADR-0046 (mission identité)** peut rapatrier les orphelins dont la cible se déduit du TYPE
  (passeport → `Pièces d'identité/Marc`) : zéro LLM, cible connue, périmètre étroit.
  ⚠️ **Un `orphelin` est un constat, pas un permis de déplacer.** Ici il ne coûte qu'une ligne de
  rapport ; le jour où il déclenche un DÉPLACEMENT, le prédicat change de côté (leçon §9 : « le
  prédicat qui déclenche l'action irréversible est STRICT et dans le doute REFUSE »). La double passe
  (§5c) réduit le risque, elle ne l'annule pas — un rapatriement automatique doit RE-VÉRIFIER
  l'absence de jumeau **au moment de l'acte**, jamais se fier au verdict figé dans le rapport.
- Le rapatriement de MASSE (le reste) est une décision de Marc, chiffrée au coût réel.
