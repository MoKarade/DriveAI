# ADR-0063 — Lire l'IMAGE du papier (Sonnet 5), et l'auditer sur vingt avant la campagne

- **Statut** : **accepté** — Marc, 24/09/2026 : « Vision Sonnet partout », « Tout relire »,
  « 100 $ au total », « Lecture d'abord », puis « OK lance L1 ».
- **Portée** : `src/PieceVision.gs` (nouveau), `src/AuditVision.gs` (nouveau), `src/Memoire.gs`
  (un troisième interrupteur et les bornes v3), `src/Cout.gs` (Sonnet 5 à son prix),
  `src/RattrapagePiece.gs` (pause), `src/Main.gs`, `src/Journal.gs`. **Aucun changement au
  classement** : ni `Router.gs`, ni la taxonomie, ni la zone protégée.
- **Amende** : l'ADR-0061 §2 (« ce qui sortira ») et §5.1 (Haiku une passe). Tout le reste de
  l'ADR-0061 tient, garde-fous compris.
- **Jumeau** : l'ADR 0010 de MemoryAI (rang 3 de la lignée, bornes relevées). À fusionner
  **avant** celui-ci : sans lui, la Mémoire range chaque lecture payée en « déjà présente ».

---

## 1. Ce qui l'a déclenché

Marc, 24/09 : « si je demande mon numéro de passeport je veux le voir […] il m'a demandé
l'échéance de mon passeport, ça il devrait l'avoir lu […] il ne récupère pas assez d'info par
document. Littéralement TOUT est à récupérer, même une analyse de ma tête sur mon passeport ».

Mesuré le jour même, dans ce dépôt :

- **La lecture passait par l'OCR.** Son passeport canadien, photographié, ne rendait que des
  fragments de fabricant ; le modèle répondait honnêtement « illisible » (C49-7). Le papier était
  lisible, sa transcription non. Les PDF chiffrés, les TIFF et les PNG à palette tombaient en
  refus 400 à la conversion (C49-28). Sur la tranche lue par Haiku, une part des papiers est
  sortie en `illisible` / `ocr-echec` / `sans-texte` — tous perdus pour la Mémoire.
- **Le prompt demandait peu** : un résumé de trois phrases, quatre familles, 40 champs libres.

## 2. La décision

1. **Le modèle reçoit le FICHIER**, plus seulement son OCR : un PDF en bloc `document`, une
   photo en bloc `image`, un document Google exporté en PDF. Ce que l'API refuse (TIFF, HEIC,
   photo de plus de 5 Mo) passe par l'**aperçu que Drive en fabrique**, demandé à 2 400 px. Les
   formats bureautiques (.docx, .xlsx, HTML) restent sur leur TEXTE, qui est exact.
2. **Sonnet 5**, réflexion désactivée (lire n'est pas raisonner), 8 000 jetons de sortie, et un
   **prompt v3** qui demande TOUT : chaque numéro, montant, personne, adresse, date, la zone
   lisible par machine décodée, un résumé de 4 à 10 phrases, jusqu'à 80 champs libres. La porte
   « lisible » de C49-7 est gardée mot pour mot : la vision ne fabrique pas plus qu'Haiku.
3. **Nom d'extracteur `sonnet-5-vision-piece-v3`**, bornes 1 500 / 80 (celles de l'ADR 0010 de
   MemoryAI). Tout autre extracteur garde les bornes d'avant.
4. **L'apparence de Marc** (« une analyse de ma tête ») sort sous la clé `apparence (photo)`,
   **seulement si le titulaire lu est Marc lui-même** — garde dans le CODE (`titulaireEstMarc_`,
   mot entier, « Marc-André » n'y passe pas), jamais dans le prompt : un modèle qui se tromperait
   de titulaire ne doit pas pouvoir décider seul de décrire le visage d'un proche. Le prompt
   interdit toute origine ethnique et tout jugement.
5. **Sonnet 5 est compté à SON prix** (2 $ / 10 $ par million de jetons) dans des compteurs à
   lui. Rangé avec Sonnet 4.6, il serait compté 1,5× — et c'est ce total que lit le frein des
   campagnes : il s'enclencherait aux deux tiers de ce que Marc a décidé de dépenser.

## 3. Ce qui sort du compte Google — l'amendement de l'ADR-0061 §2

| Avant (ADR-0061) | Après (ADR-0063) |
|---|---|
| Le **texte OCR** transite par Anthropic | Le **fichier lui-même** (image, PDF) transite par Anthropic |
| La Mémoire reçoit des champs et un résumé ≤ 600 car. | La Mémoire reçoit des champs et un résumé ≤ 1 500 car., 80 champs libres |
| — | Une description factuelle du visage de **Marc** (jamais d'un proche) |

⚠️ **Ce que ça coûte, dit une fois** : une photo de passeport contient plus que son texte — un
visage, une signature. Elle transite par Anthropic comme le texte transitait déjà ; elle n'est
**persistée nulle part**, ni ici, ni dans la Mémoire, qui ne reçoit toujours que des champs.

**Ce qui ne bouge pas** : l'Index et le Journal restent des métadonnées (`test/privacy.test.js`) ;
aucun scope OAuth ajouté (l'aperçu Drive et `getAs` passent par le scope `drive` existant) ;
aucune suppression ; aucun montant ne devient un fait.

## 4. L'audit sur vingt papiers — la porte avant la campagne

`AUDIT_VISION_TAG` posé = l'audit tourne. Vingt papiers choisis **par issue Haiku**, d'abord ses
échecs (5 illisibles, 4 échecs d'OCR, 3 sans texte, 2 lectures impossibles, 2 extractions vides)
puis 4 bien lus comme **témoins** ; photos d'abord, puis l'ordre des domaines de Marc. Chacun est
lu, envoyé à la Mémoire (qui garde l'ancienne lecture), et mesuré dans l'onglet `AuditVision` :
voie, issue, titulaire, date de naissance oui/non, comptes par famille, jetons, **coût mesuré sur
la réponse**, durée, ce que la Mémoire en a fait.

⚠️ **L'onglet ne porte AUCUNE valeur** — des comptes et des oui/non. Les valeurs sont dans la
Mémoire, sous ses verrous (ADR 0007 de MemoryAI). Un test le vérifie sur un passeport complet.

**Budget** : celui des pièces (`AUDIT_PIECE_BUDGET_*`, 54 min/j, 2 min par passe) — aucune minute
ajoutée à l'enveloppe. Le frein en dollars s'applique. L'audit s'éteint seul à zéro restant.

**Pause du rattrapage Haiku** : tant que `AUDIT_VISION_TAG` est posé, `etapeRattrapagePiece_`
s'arrête (`vision-en-cours`) — il relirait en v2 des papiers que la vision relira en v3. Décision
prise sans question séparée à Marc, parce qu'elle découle de « Tout relire » ; elle est dite ici
et dans le compte-rendu, et le chemin manuel passe outre.

## 5. Coût attendu, avant mesure

Estimation : **3 à 5 ¢ par papier** (une page d'image ≈ 1 500 à 3 000 jetons d'entrée au nouveau
tokenizer, 1 000 à 3 000 de sortie). 100 $ couvriraient ~2 000 à 3 000 papiers sur ~4 300. Cette
estimation est **remplacée par la mesure de l'audit** avant toute campagne — c'est sa raison
d'être.

## 6. Ce qui reste à décider après l'audit

- La campagne elle-même (ordre 04 → 01 → 02 → 05 → 03 → 08 → 07 → 09, `06` à trancher), son
  plafond (100 $) et le relèvement du frein mensuel (`LLM_BUDGET_CAMPAGNES`, 40 $ aujourd'hui).
- Le flux vivant : il reste sur Haiku v2 tant que la campagne n'a pas prouvé la vision.

## 7. Risques

1. **Le temps d'un appel** : une réponse de 3 000 jetons prend 30 à 50 s. Le garde-temps est
   vérifié AVANT chaque papier, donc un papier peut déborder d'un appel ; l'audit le mesure.
2. **Un PDF de 40 pages** coûte le prix de trente papiers : au-delà de 10 Mo il passe par le
   texte. Ce seuil est un filet, pas une politique — l'audit dira s'il mord.
3. **L'apparence** est une lecture de modèle sur un sujet sensible : elle est bornée à Marc par
   le code, et elle vit au niveau du papier qui la porte (N3 pour un passeport).

## 8. Amendement du 24/09 (C49-30) — l'audit mesuré, et la campagne par tranches

**L'audit sur vingt papiers (mesuré le 24/09, lancé à la main)** :

- 15 lus, 5 échecs. 10 des 12 échecs d'Haiku (illisible, OCR raté, sans texte) sont lus. Les
  témoins (deux passeports français, deux permis de travail) sortent plus riches qu'en v2 (zone
  lisible par machine décodée, photo décrite), et une étiquette fausse de la v2 est corrigée.
- Le « passeport canadien » est la COUVERTURE d'un passeport français sur des cartes
  d'embarquement : aucune page de données. La lecture le dit au lieu d'inventer.
- Échecs : 2 fichiers disparus du Drive, 1 PDF protégé par mot de passe, 1 PNG refusé par
  l'API (« Could not process image »), 1 image illisible.
- La garde de l'apparence a tenu : décrite sur les passeports de Marc, sur aucun papier de
  tiers.
- **Coût mesuré : 0,57 $ pour 16 papiers.** Une photo coûte 1 à 2 ¢ ; un PDF de ~20 pages en
  image coûte ~15 ¢ (les trois affidavits font 0,46 $ à eux seuls).

**Ce que Marc a décidé (24/09)** : « texte si le PDF en a », « garder 40 $/mois », « tranche de
200 d'abord ».

1. **Un PDF qui a du texte part en TEXTE** (`pdf-texte`), borné à 60 000 caractères — plus les
   12 000 de l'analyse, qui coupaient un relevé en son milieu. « A du texte » = au moins 400
   caractères dont la moitié sont des lettres ou des chiffres : la longueur seule prendrait le
   bruit de l'OCR d'un scan pour une lecture. Si le texte ne donne rien (`illisible`, `vide`), le
   PDF est **montré une fois** en image ; une panne ne déclenche pas ce second essai. Le coût du
   papier est la SOMME des deux appels.
2. **La campagne est le rattrapage lu en vision** (`RATTRAPAGE_PIECE_VISION`, tag `v3-a`) :
   même ordre (`04 → 01 → 02 → 05 → 03 → 08 → 06 → 07 → 09`), même idempotence, même canal —
   seul le lecteur change. Le nouveau tag fait tout RELIRE (« Tout relire »).
3. **Deux arrêts, vérifiés avant la passe ET pour le chemin manuel** : 200 papiers traités sous
   le tag (`VISION_TRANCHE_MAX`), et 100 $ dépensés (`VISION_PLAFOND_DOLLARS`), mesurés sur les
   réponses et écrits après CHAQUE papier. Le frein mensuel (40 $) reste en place : il étale la
   campagne sur plusieurs mois.
4. **Une panne de la vision n'est jamais un verdict du papier** : `pousserPieceApresClassement_`
   aplatit tout échec en `extraction-vide` ; c'est le motif RICHE qui décide. Une panne passagère
   (réseau, 5xx, réponse illisible) arrête la passe sans marquer, et au 3ᵉ retour sur le même
   papier il est mis de côté pour ne pas bloquer la file. Une panne de crédit ne compte jamais.
   Trois refus identiques de l'API d'affilée (400, 413, aperçu absent) sont une cause commune :
   rien n'est marqué.

**Écarté** : relever le frein mensuel à 110 $ (Marc a choisi de garder 40 $) ; limiter les PDF à
5 pages en image (perdrait la fin des longs documents).

