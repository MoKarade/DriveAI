# ADR-0061 — Le CONTENU des documents quitte le compte, et ce qu'on obtient en échange

- **Statut** : **proposé** (session Claude, 16/09/2026). Marc ratifie ; la PR reste en brouillon
  d'ici là (règle `claude-config` : un ADR en statut Proposé est la seule exception qui reste
  en brouillon).
- **Portée** : `src/Memoire.gs`, le pipeline d'analyse (`src/Llm.gs`, `src/Main.gs`), et une
  route de lecture sur la web app. **Aucun changement au classement** — la taxonomie, le
  routage et la zone protégée ne bougent pas d'une ligne.
- **Amont** : **ADR-0061 est la suite directe de l'ADR-0059** (phase 0 : l'inventaire, `0 $`,
  `document.existe` seul) et **l'exécution de l'ADR 0004 de MemoryAI** (accepté par Marc le
  16/09), qui demande le contenu.
- **Révise** : l'ADR-0059 §4 points **1** et **3**, et la glose du CLAUDE.md §9. Voir §3 — ce
  sont des **révisions nommées**, pas des contournements.

---

## 1. Ce qui a changé depuis l'ADR-0059

L'ADR-0059 a livré la phase 0 : `Memoire.gs` pousse **un fait par document classé**,
`document.existe`, dont la valeur est un `fileId`. Zéro appel LLM, zéro coût, une liste de
champs FERMÉE que `test/memoire.test.js` verrouille.

Mesuré côté MemoryAI le 16/09 (`memoryai_etat`, `memoryai_inventaire`) : **2 729 faits
`document.existe`**, contre **98 faits qui parlent réellement de Marc**. Le canal fonctionne, et
il transporte exactement ce que l'ADR-0059 a décidé qu'il transporte : **des pointeurs**.

Marc, le 16/09 : « il extrait toutes les infos de chaque fichier […] stocke toutes les infos même
le fournisseur, l'envoyeur du mail, le numéro de téléphone sur un document etc etc, vraiment
toutes les infos ». L'ADR 0004 de MemoryAI, accepté le même jour, crée la table `pieces` pour
les recevoir.

**Ce que DriveAI doit décider ici** : il est le seul à pouvoir lire ces documents. Rien ne sort
de son compte sans qu'il le décide, et le CLAUDE.md §9 exige que cette décision soit un ADR.

---

## 2. La frontière franchie, nommée

### Ce qui sortait jusqu'ici

Un `fileId`, un domaine, un type, une date, un émetteur — tous **déjà écrits dans le NOM du
fichier** par la convention `AAAA-MM-JJ_Type_Émetteur.ext`. Rien qui ne soit pas dans le nom.

### Ce qui sortira

**Le contenu extrait d'un document** : émetteur complet, numéros de référence, dates,
**montants**, personnes nommées, lieux, numéros de téléphone, **et les numéros d'identité** —
plus un résumé de deux ou trois phrases.

Y compris pour les documents de `04 · Immigration`, `identité` et `fiscal`. Y compris pour les
documents **des proches de Marc** (ADR 0004 §5.1 décision n° 3).

### Ce qui ne sortira PAS

- **Le texte intégral n'est jamais PERSISTÉ** dans la Mémoire (ADR 0004 §5.2 décision n° 9 :
  champs + résumé, pas le texte brut). Il **transite** pour être lu, il n'est pas stocké.
- **L'état de DriveAI reste des métadonnées.** L'Index et le Journal ne persistent toujours
  aucun corps de document — l'invariant du CLAUDE.md §9 tient **chez nous**, et
  `test/privacy.test.js` continue de l'exiger. Ce qui change est ce qui SORT, pas ce qu'on garde.
- **Aucun scope OAuth n'est ajouté.** Aucun nouveau secret Google. Le moindre privilège du
  §1.3 tient sans une ligne de changement.

---

## 3. Les invariants que cet ADR RÉVISE, nommément

⚠️ Les deux ont été posés en question à Marc dans l'ADR-0059 §4, avec une recommandation, et il
avait répondu dans l'autre sens. **Il revient dessus le 16/09, en connaissance de cause.** C'est
son droit, et c'est écrit ici pour qu'aucune session ne prenne la révision pour un oubli.

| # | Ce que l'ADR-0059 §4 posait | Ce que l'ADR-0061 fait |
|---|---|---|
| 1 | « Des FAITS dérivés (jamais le texte, **jamais un extrait N ≥ 1**) sont persistés hors du compte » | Un **résumé** et des **champs** extraits sortent, à tous les niveaux, N3 compris |
| 3 | « **maintenir "jamais un montant"** ? oui [recommandé] » — et Marc avait répondu oui | Les **montants sortent**. ⚠️ Corollaire non négociable en §4 : ils ne deviennent JAMAIS des faits, seulement des champs de `pieces` — **FinanceAI reste la source des chiffres**, ADR-0045 tient |

⚠️ **Ce que ça coûte, dit une fois et jamais adouci ensuite.** Le NAS de Marc, ses numéros de
passeport et de permis — et ceux de ses proches — quitteront son compte Google, transiteront par
un modèle, et vivront chiffrés dans une base hébergée aux États-Unis. Une fuite n'est pas
rattrapable : on ne rappelle pas un numéro d'identité. Ses proches n'ont rien choisi.

---

## 4. Les garde-fous obtenus en échange

| Menace | Garde-fou | Où il se vérifie |
|---|---|---|
| La frontière s'élargit sans que personne ne le voie | La liste des champs poussés reste **FERMÉE** (`champsPieceMemoire_`, jumelle de `champsFaitMemoire_`), et le test échoue si un champ s'y ajoute | `test/memoire.test.js` |
| Le texte intégral finit par être persisté « puisqu'il transite déjà » | L'envoi **refuse** un corps qui porte un champ de texte brut, et MemoryAI le refuse aussi côté réception — la garde existe **aux deux bouts** | test d'envoi + contrat `pieces` |
| Un montant devient un fait et FinanceAI cesse d'être la source unique | `valeur_type: "montant"` reste **422** sur la route des faits ; un montant n'existe que comme champ d'une `piece`. **ADR-0045 est PRÉSERVÉ** | test côté MemoryAI, inchangé |
| DriveAI persiste du contenu chez lui « au passage » | `test/privacy.test.js` reste tel quel : Index et Journal restent métadonnées | `test/privacy.test.js` |
| La campagne mange le quota et affame l'intake | Budget QUOTIDIEN **prélevé** sur l'enveloppe, jamais ajouté (§6), garde-temps par run, et l'étape reste sous try/catch — « un échec ne doit JAMAIS bloquer l'intake » | `test/orchestration.test.js` |
| Une extraction déraille sur 19 900 documents | Trois freins côté MemoryAI (plafond de dépense, contrôle qualité aux 500, bouton d'annulation) et **100 documents stratifiés d'abord** | ADR 0004 §10 |
| Le classement dérive parce qu'on a touché au pipeline | L'extraction est une **étape distincte**, après la décision de classement. Elle ne peut pas changer une cible : le protocole §11 (ADR d'abord, audit sur du réel, non-régression) s'applique **et rien dans ce lot ne touche `Router.gs`** | `test/audit-logique.test.js` |

---

## 5. L'architecture : DEUX chemins, parce qu'ils n'ont pas le même coût

### 5.1 Flux vivant — DriveAI extrait, et c'est presque gratuit

Au moment où le moteur classe un document, **il a déjà son texte en main** : l'OCR est payé, la
lecture est payée. Ajouter un appel Haiku d'extraction dans la foulée coûte un appel de plus sur
quelques documents par jour.

C'est donc DriveAI qui extrait pour le flux vivant, et **seuls les champs sortent** — la
frontière la plus étroite possible pour ce chemin.

⚠️ **L'extraction ne partage PAS le prompt du classement.** Deux passes, deux prompts, deux
raisons : mêler « où ranger ce papier » et « que contient-il » dans un seul appel rendrait une
régression de classement indistinguable d'une régression d'extraction — et le classement est la
raison d'être de l'app.

### 5.2 Rattrapage des ~19 900 — le mur du quota, et ce qu'il impose

Le texte des documents déjà classés a été **jeté** (c'est l'invariant de vie privée, et il a bien
fonctionné). Le rattrapage exige donc de **re-lire** chaque document : lecture Drive + OCR + LLM.

Le quota Apps Script est de ~90 min/jour de temps d'exécution, **partagé** avec le tick et une
dizaine de campagnes de fond dont la somme des budgets est verrouillée à **63 min/j** par
`test/orchestration.test.js`. Faire les trois étapes ici, c'est le mur que tout le §9 du
CLAUDE.md raconte.

**Recommandation [Probable] : DriveAI fait la lecture et l'OCR ; l'extraction LLM se fait
ailleurs.** Concrètement : une route de la web app, gardée par le `WEBAPP_SECRET` **existant**,
rend le texte OCR d'un `fileId` ; la campagne de MemoryAI (GitHub Actions, ADR 0004 §7) le tire
par lots et appelle Haiku. Le quota Apps Script ne paie que ce que lui seul peut faire.

⚠️ **Cette voie fait sortir le TEXTE OCR du compte, vers un runner GitHub.** C'est une frontière
**plus large** que le §2, où seuls les champs sortent. Elle est ici en toutes lettres plutôt que
découverte à mi-chemin — et c'est la **question Q1** de la §9.

⚠️ Le coût en quota de la seule lecture+OCR sur 19 900 documents **n'est pas mesuré** [À vérifier].
Il se mesure sur les 100 documents stratifiés, avant d'engager quoi que ce soit — jamais extrapolé
d'un chiffre-titre (§9 : « quand un RAPPORT EXHAUSTIF existe, ne jamais chiffrer depuis un
échantillon », et son symétrique : ne jamais chiffrer un inconnu depuis rien).

---

## 6. Le budget : PRÉLEVÉ, jamais ajouté

La règle du §9 est explicite — « **Accélérer une campagne sous plafond PARTAGÉ : RÉALLOUER,
jamais AUGMENTER** » — et elle est tenue par un test qui verrouille la somme à **63 min/j**.

Le budget de la campagne de rattrapage se prélève donc sur l'enveloppe, et l'ADR **ne propose pas
quelle campagne payer** : ce choix se fait sur l'état RÉEL des campagnes au moment du lot (laquelle
a convergé, laquelle est en pause), pas sur une lecture de `Config.gs` faite aujourd'hui. Ce qui est
figé ici, c'est la contrainte : **le test d'invariant doit rester vert sans qu'on touche à son
total**, et le prélèvement se prouve par mutation (gonfler un budget doit faire échouer le test).

⚠️ Le **flux vivant** ne consomme aucune campagne : son coût est un appel LLM sur un document qu'on
était déjà en train de lire, dans le budget d'analyse existant.

---

## 7. Ce que ça ne fait pas

- Ça ne touche pas au **classement** : ni `Router.gs`, ni la taxonomie, ni les cibles.
- Ça ne touche pas à la **zone protégée** : un document de `04 · Immigration` n'est ni déplacé ni
  détaché ; il est seulement LU, comme il l'est déjà à chaque classement.
- Ça n'ajoute **aucun scope OAuth**, aucun secret Google, aucune suppression.
- Ça ne persiste **aucun corps de document chez DriveAI** : l'invariant du §9 tient.
- Ça ne rend **aucun montant sous forme de fait** : FinanceAI reste la source des chiffres.

---

## 8. Plan

| Lot | Contenu | Prouve |
|---|---|---|
| **D1** | Le contrat `pieces` côté DriveAI : `champsPieceMemoire_` (liste FERMÉE), envoi, refus d'un champ de texte brut, tests jumeaux de ceux de `champsFaitMemoire_` | un champ ajouté fait rougir le gate |
| **D2** | Extraction du **flux vivant** : un prompt DÉDIÉ, une passe Haiku après la décision de classement, sous try/catch, jamais bloquante | un document déposé dans `00 · À trier` produit sa `piece` en quelques minutes |
| **D3** | **Audit sur 100 documents stratifiés** (manuscrit, scan croche, anglais, formulaire, facture à colonnes, papier d'immigration) — tableau nom / champs extraits / verdict, **avant** toute campagne | le taux d'erreur par type, mesuré, pas estimé |
| **D4** | La voie de rattrapage retenue en Q1, avec son budget prélevé et son test d'invariant | la somme des budgets quotidiens reste à 63 min/j |

⚠️ **D3 est une porte, pas une étape.** Le protocole §11 l'exige (« audit sur du réel avant de
modifier le pipeline »), et l'ADR 0004 de MemoryAI en fait le critère de mort de son socle : moins
de 8 des 10 questions de test qui trouvent leur réponse, et les 19 900 ne partent pas.

---

## 9. Questions ouvertes — l'arbitrage de Marc

**Q1 — le rattrapage.** Deux voies, et elles n'ont pas la même frontière :

- **(a) Le texte OCR sort vers GitHub Actions**, qui appelle Haiku. Le quota Apps Script ne paie
  que la lecture. ⚠️ Le texte intégral de chaque document transite par un runner GitHub — un acteur
  de plus dans le chemin, et le plus large franchissement de cet ADR.
- **(b) Tout reste dans Apps Script.** Frontière étroite : seuls les champs sortent, jamais le
  texte. ⚠️ Le quota devient le facteur limitant, et le rattrapage se compte en mois, prélevés sur
  une enveloppe déjà pleine.

*Recommandation [Probable] : (a), à la condition que D3 mesure d'abord ce que la lecture+OCR coûte
vraiment. Si elle s'avère bon marché, (b) redevient défendable et garde la frontière étroite.*

**Q2 — les documents des proches.** L'ADR 0004 de MemoryAI dit « mêmes règles que Marc », et
DriveAI ne sait pas distinguer un passeport de Marc de celui d'un proche : les deux sont dans
`04 · Immigration`. **Question : est-ce que DriveAI doit essayer de les distinguer** (un champ
« titulaire » extrait, et un réglage côté Mémoire) **ou pousser sans distinction** ? Sans
distinction est plus simple et retire à Marc la possibilité de changer d'avis pour eux seuls.

---

## 10. Risques, dits une fois

1. **Le texte des documents devient lisible hors du compte Google.** C'est le cœur de cet ADR,
   et aucun garde-fou ne l'annule — ils le bornent.
2. **L'extraction se trompe, et personne ne relit** : l'ADR 0004 a supprimé la validation. Un
   numéro mal lu vivra dans la Mémoire et sera redit avec aplomb. D3 mesure le taux d'erreur ;
   il ne le rend pas nul.
3. **Le quota d'analyse est déjà tendu.** Ajouter un appel LLM par document au flux vivant est
   marginal aujourd'hui ; ça cesse de l'être le jour où le flux grossit. La métrique à surveiller
   est le temps d'exécution quotidien, pas le nombre de documents.
4. **Deux prompts au lieu d'un** : le classement et l'extraction dériveront séparément. C'est le
   prix de pouvoir diagnostiquer une régression — et il faut que les deux soient audités
   séparément, jamais ensemble.
5. **La liste FERMÉE des champs est le seul verrou de la frontière.** Elle ne tient que tant que
   le test qui la garde est lu. C'est la leçon du §9 : « promesse de verrou = verrou codé dans le
   même commit ».
