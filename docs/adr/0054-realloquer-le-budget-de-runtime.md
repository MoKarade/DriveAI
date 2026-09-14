# ADR-0054 — Réallouer le budget de runtime vers le vrai goulot

**Statut** : accepté · **Date** : 2026-09-14 · **Demande de Marc** : « fais la réallocation, jveux
utiliser le temps dispo au max ».

Révise les réallocations de **2026-08-11** (exec↔fusion) et **C28-49/ADR-0039** (gen↔missions) —
leurs verrous de COUPLE sont remplacés par un verrou de BLOC. Ne touche à aucun garde-fou du §1.

## 1. Le constat, mesuré avant de bouger quoi que ce soit

DriveAI partage un **mur dur de ~90 min/jour** de temps d'exécution Apps Script. Au-delà, ce ne sont
pas les campagnes qui ralentissent : **TOUS les déclencheurs gèlent, chien de garde compris** —
c'est l'incident C28-29, et c'est pour ça que la règle du projet est « **réallouer, jamais
augmenter** » (§9).

État lu le 14/09 (`etat_moteur` + comptage des dossiers de destination, jamais un compteur seul) :

| campagne | budget/j | ce qu'elle fait vraiment |
|---|---|---|
| Historique Gmail | **20 min** | on ne sait pas si elle tourne encore — le compteur qui trancherait n'existait pas (voir §3) |
| Consolidation — génération | 10 min | **le goulot** : consomme ses 10 min ENTIÈRES, 1 domaine sur 9, aucun progrès depuis 18 h |
| Consolidation — exécution | 12 min | **à vide** : plan drainé 372/372, statut « attend la génération » |
| Réconciliation Index | 12 min | perpétuelle, filet de sécurité — on n'y touche pas |
| Historique du vrac | 4 min | suivi journalier, 1 écriture/tick |
| Missions de curation | 2 min | 8 missions s'y partagent 2 minutes ; `retour-ecoles06` avance de +5 fichiers par passe |
| Doublons | 3 min | **terminée** — « terminée ✅ le 2026/08/22 — 1076 écartés » |
| **total** | **63 min** | plafond dérivé : 65 min |

La génération est le goulot **structurel** : l'exécution ne peut drainer que ce qu'elle produit, et
la racine `08 · Perso & projets` reste à 116 fichiers en vrac tant que son domaine n'est pas passé.

## 2. Décisions

**D1 — Transfert vers la génération, enveloppe INCHANGÉE.** `16/8/1` au lieu de `10/12/3` :

| | avant | après | pourquoi |
|---|---|---|---|
| Consolidation — génération | 10 | **16** | le goulot mesuré |
| Consolidation — exécution | 12 | **8** | tourne à vide ; a drainé 372 lignes avec 12 min, en drainera ~250/j avec 8 — très au-delà de ce qu'une génération à 1 domaine/j produit |
| Doublons | 3 | **1** | campagne TERMINÉE, **lu** et non supposé (§1.6) |

Somme du bloc : **27 min/j avant comme après**. L'enveloppe reste à 63 pour un plafond de 65.
Aucune minute n'est créée.

**D2 — Un verrou de BLOC remplace les deux verrous de COUPLE.** Les paires `exec + fusion = 12` et
`gen + missions = 12` devenaient fausses dès qu'une réallocation traverse les deux paires — ce qui
est exactement le cas ici. Le nouvel invariant porte sur la somme des cinq campagnes qui se prêtent
mutuellement du budget (`gen + exec + fusion + missions + doublons = 27 min/j`).
Ce qu'il protège est identique et c'est le seul point qui compte : **aucun transfert interne ne peut
faire croître l'enveloppe**. L'agrégat « ≤ 65 min » ne suffit pas — il est structurellement AVEUGLE
à un transfert à moitié annulé (leçon C28-42 : 62 ≤ 65 reste vert pendant que l'enveloppe grimpe) ;
une somme de bloc constante, elle, tombe au premier déséquilibre, dans les deux sens. L'autre moitié
du verrou est conservée : **une campagne ACTIVE n'a jamais un budget de 0** (sinon elle est MUETTE —
un no-op silencieux). Prouvé par mutation dans les deux sens.

**D3 — Ce qu'on ne réalloue PAS, et pourquoi.** Les **20 min/j** de l'historique Gmail sont le plus
gros bloc de l'enveloppe et le donneur évident (déjà noté en ADR-0047 §6, backlog C28-70). Ils
restent en place : **rien nulle part ne dit si cette campagne tourne encore**. §1.6 est explicite —
« ne pas déclarer une campagne finie sans lire son compteur », et l'incident qui a produit cette
règle est exactement celui-là : une campagne annoncée terminée qui ne l'était pas, restée en pause
deux semaines sans que personne le voie. Deux lectures de `gmail_histo_fils_jour` à 0 ne sont PAS
une preuve : 0 fil peut vouloir dire « finie », « budget épuisé » ou « suspendue ».

## 3. Rendre l'historique Gmail LISIBLE (ce qui débloquera les 20 min)

⚠️ **Correction apportée en revue** : une première rédaction affirmait que la campagne « n'était
visible NULLE PART ». **C'est faux.** L'onglet Progression lui consacre une ligne depuis C28-44
(`Suivi.gs`, « Historique Gmail (PJ) »), avec un statut à quatre valeurs et un compteur de fils
rendu MONOTONE ; la télémétrie publie `gmail_histo_fils_jour` avec son plafond. Ce qui manquait
vraiment — et qui suffit à justifier la ligne — ce sont les **minutes consommées**, le seul chiffre
qui dise si les 20 min sont réellement utilisées. La leçon vaut d'être écrite : j'ai cherché la
ligne dans un export TRONQUÉ de la Sheet et conclu de son absence qu'elle n'existait pas.

La campagne ne pouvait pas prendre une clé dans le registre de suivi : il est **saturé**
(8 377 des 8 500 octets du plafond dérivé, ~199 octets par entrée — une 43ᵉ clé le ferait
déborder, cf. ADR-0047 §6 et le corollaire §9 « un registre borné finit par se fermer, et il se
ferme sans le dire »). Elle se rend donc visible dans l'onglet **Santé**, comme `Doublons` et
« Rangement ancien Drive » : un texte, zéro octet de Property.

La ligne dit l'état, **les minutes** et **les fils** consommés aujourd'hui. Elle ne répète PAS le
compte de fils parcourus : la Progression le porte déjà, de façon monotone — deux surfaces qui
affichent le même fait avec deux conversions différentes, c'est le défaut que §9 interdit.

Trois précautions, chacune contre une façon de se tromper sur ce « 0 minute » :

1. **Le statut est RICHE et PARTAGÉ.** `statutHistoGmail_` est une seule règle, consommée par la
   Progression ET par la Santé. Sans elle, une campagne SUSPENDUE (quota Gmail) ou EN PAUSE (frein
   budget) affichait « en cours · 0 min » — et la lecture naturelle de ce 0 est « elle ne s'en sert
   pas, prends ses 20 minutes ». Le jour où Marc redescend `LLM_BUDGET_CAMPAGNES` à 10 — ce que
   §1.6 lui demande de faire — ce faux signal serait devenu permanent. La ligne dit désormais
   explicitement « elle ne PEUT pas consommer ».
2. **Les DEUX plafonds sont affichés.** La campagne est bornée en minutes *et* en fils/jour, et
   c'est le second qui mord en régime normal : à plein régime elle peut n'afficher que « 0,4 des
   20 min ». Le même piège, transposé d'une unité à l'autre.
3. **Échec FERMÉ** : une lecture d'état en panne rend « illisible », **jamais** « terminée » (et
   elle est journalisée). Un catch optimiste ferait libérer le budget d'une campagne encore
   vivante — le symétrique exact du 🔴 `ascendance-illisible` de C28-93 : une panne n'est pas un
   verdict.

## 4. Conséquences

- La génération passe de 10 à 16 min/j, soit **+60 % de budget** sur le seul poste qui bloque le
  reste. ⚠️ Budget, pas débit mesuré : « 372 lignes drainées » est un CURSEUR, pas une cadence, et
  personne n'a lu les ms réellement dépensées alors que le diagnostic un-clic les imprime. Si la
  génération n'affiche pas `16/16 ÉPUISÉ` dans les 24 h, ce n'est pas le budget qui la bornait et
  les 4 minutes doivent retourner à l'exécuteur (vérification inscrite au HANDOVER).
- **Un plafond de RATIO accompagne le transfert** : `génération ≤ 2 × exécution`. Le précédent est
  documenté dans `Config.gs` — en août 2026, à ce ratio exact (12/6), la contre-pression
  (`CONSOLIDATION_BACKLOG_MAX`) a ÉTRANGLÉ la génération, « throttlée, 2,3/12 min seulement »,
  parce que l'exécuteur ne rattrapait pas. 16/8 atteint ce plafond pile ; au-delà, on reproduit un
  blocage déjà vécu, et **sans symptôme visible** (la contre-pression est dans la fonction, pas dans
  une gate : l'étape s'enregistre comme une exécution normale).
- Le prochain tick écrit la ligne « Historique Gmail ». Si elle dit « terminée », ses minutes
  deviennent réallouables — mais **pas pour doubler la génération** : le plafond de ratio l'interdit
  (vérifié par mutation). Une réallocation saine ressemblerait à « −6 à l'historique, +4 à la
  génération, +2 à l'exécution » : somme constante ET ratio tenu.
- Aucun garde-fou du §1 n'est touché : ce lot ne déplace aucun fichier, ne supprime rien, n'ajoute
  aucun scope et ne change aucune règle de classement.

## 5. Ce qui reste ouvert

- Les 20 min de l'historique Gmail, en attente de la mesure ci-dessus (C28-70).
- Les 8 missions de curation se partagent 2 min/j : `retour-ecoles06` avance de +5 fichiers par
  passe pour ~139 à rapatrier. C'est le prochain bénéficiaire naturel d'une réallocation.
- Personne ne mesure le runtime RÉELLEMENT consommé par jour. Le plafond de 65 min est **dérivé**
  d'une réserve estimée à 25 min pour le socle non budgété, pas d'une mesure. Tant que ce chiffre
  n'existe pas, « utiliser le temps dispo au max » ne peut se faire que par transferts — jamais en
  relevant le plafond.
- Trois trous relevés en revue et **non corrigés ici** (backlog C28-100 à C28-102) : le budget par
  run de la génération est calculé depuis SON début et non depuis le reliquat du tick (elle peut
  réserver plus de temps au walk qu'il n'en reste, et imputer quand même ces minutes au quota) ;
  `PILOTE_BUDGET_JOUR_MS` (30 min/j) n'est dans AUCUN des deux invariants ; la contre-pression de
  la génération est invisible dans le suivi.
