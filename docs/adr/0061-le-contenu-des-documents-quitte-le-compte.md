# ADR-0061 — Le CONTENU des documents quitte le compte, et ce qu'on obtient en échange

- **Statut** : **accepté** (Marc, 16/09/2026). Il a confirmé la frontière (§2) et les deux
  invariants révisés (§3), puis tranché les deux arbitrages de la §9 : **le runner** pour le
  rattrapage, et **un champ « titulaire »** pour les documents des proches.
  ⚠️ **Amendé le 17/09** (§9, Q1) : la PREMIÈRE tranche (`04`+`01`, 110 documents mesurés) reste
  dans Apps Script, sur la frontière étroite — le cas que cet ADR prévoyait en toutes lettres.
  La Q1 reste la voie du rattrapage complet.
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

**DÉCISION de Marc (16/09) : DriveAI fait la lecture et l'OCR ; l'extraction LLM se fait
ailleurs — « le runner ».** Concrètement : une route de la web app, gardée par le `WEBAPP_SECRET` **existant**,
rend le texte OCR d'un `fileId` ; la campagne de MemoryAI (GitHub Actions, ADR 0004 §7) le tire
par lots et appelle Haiku. Le quota Apps Script ne paie que ce que lui seul peut faire.

⚠️ **Cette voie fait sortir le TEXTE OCR du compte, vers un runner GitHub.** C'est une frontière
**plus large** que le §2, où seuls les champs sortent — un acteur de plus dans le chemin, qui
voit le texte intégral de chaque document. Marc l'a tranché en connaissance de cause après que
cette phrase lui a été posée ; elle est ici en toutes lettres plutôt que découverte à mi-chemin.

⚠️ **Ce que la décision ne dispense PAS de mesurer** : le coût en quota de la lecture+OCR reste
inconnu, et il décide du calendrier du rattrapage, pas de sa voie. Si l'audit le montre bon
marché, la question de garder la frontière étroite se rouvre — c'est alors une amélioration, pas
une révision de cet ADR.

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
| **D1** | Le contrat `pieces` côté DriveAI : `champsPieceMemoire_` (liste FERMÉE, **`titulaire` compris, avec sa confiance**), envoi, refus d'un champ de texte brut, tests jumeaux de ceux de `champsFaitMemoire_` | un champ ajouté fait rougir le gate ; un titulaire incertain vaut « inconnu » |
| **D2** | Extraction du **flux vivant** : un prompt DÉDIÉ, une passe Haiku après la décision de classement, sous try/catch, jamais bloquante | un document déposé dans `00 · À trier` produit sa `piece` en quelques minutes |
| **D3** | **Audit sur 100 documents stratifiés** (manuscrit, scan croche, anglais, formulaire, facture à colonnes, papier d'immigration) — tableau nom / champs extraits / verdict, **avant** toute campagne | le taux d'erreur par type, mesuré, pas estimé |
| **D4** | Le rattrapage par le **runner** : une route de la web app qui rend le texte OCR d'un `fileId`, gardée par le `WEBAPP_SECRET` existant ; budget prélevé et test d'invariant | la somme des budgets quotidiens reste à 63 min/j, prouvé par mutation |

⚠️ **D3 est une porte, pas une étape.** Le protocole §11 l'exige (« audit sur du réel avant de
modifier le pipeline »), et l'ADR 0004 de MemoryAI en fait le critère de mort de son socle : moins
de 8 des 10 questions de test qui trouvent leur réponse, et les 19 900 ne partent pas.

---

## 9. Les deux arbitrages, tranchés par Marc le 16/09

**Q1 — le rattrapage : le TEXTE OCR sort vers le runner GitHub.** L'option écartée était de tout
garder dans Apps Script, ce qui aurait préservé la frontière étroite (seuls les champs sortent)
au prix d'un rattrapage compté en mois, prélevé sur une enveloppe déjà pleine. Marc a pris la
frontière plus large contre le délai. Ce que ça implique est en §5.2, et ce n'est pas adouci.

⚠️⚠️ **AMENDEMENT DU 17/09 — LA PREMIÈRE TRANCHE RESTE DANS APPS SCRIPT, ET C'EST L'ADR
LUI-MÊME QUI LE PRÉVOYAIT.** Marc, le 17/09 : « garde ta voie, 110 docs c'est peu pour
l'instant ». La Q1 n'est **pas révoquée** — elle reste la voie du rattrapage COMPLET — mais la
tranche `04 · Immigration` + `01 · Administratif & identité` (C49-5, `src/RattrapagePiece.gs`)
se fait dans le tick, sur la frontière ÉTROITE.

Ce qui l'autorise est écrit trois paragraphes plus haut, dans cet ADR : « si l'audit le montre
bon marché, la question de garder la frontière étroite se rouvre — c'est alors une
**amélioration**, pas une révision de cet ADR ». Deux faits neufs l'ont rendue bon marché, et
tous deux sont POSTÉRIEURS au 16/09 :

1. **La prémisse chiffrée de la Q1 était fausse d'un facteur 5.** « Compté en mois » portait sur
   **19 900 documents** — un nombre qui venait de `Object.keys(_indexCache).length`, donc du
   compte des CLÉS d'Index toutes natures confondues. Mesuré depuis (C49-4, `PerimetrePiece.gs`) :
   **3 972 papiers candidats** sur 4 240 documents classés et identifiables.
2. **Et la tranche n'en pèse que 110** (`04`=23, `01`=87, mesurés). À ~10 s/document — le débit
   réel de l'audit C49-3, pas une estimation — elle coûte **~18 min de quota**, soit moins de
   deux jours sur les 11 min/j déjà prélevées pour les pièces. Il n'y a donc rien à prélever de
   plus, et aucun mois à attendre.

⚠️ **Ce que l'amendement NE fait pas** : il ne dit rien du rattrapage complet. Les 3 862 papiers
restants retombent sous la Q1 telle qu'elle est écrite ci-dessus, et l'idempotence du C49-5 — une
liste de `fileId` dans une Script Property, plafonnée à 200 contre les ~9 Ko — **ne passera
jamais à cette échelle** : l'étape refuse une tranche plus grande plutôt que de le découvrir en
production. Le « pour l'instant » de Marc est donc dans le code, pas seulement dans sa phrase.

⚠️ **Et la frontière va dans le sens PRUDENT** : la voie du tick est celle où seuls les champs
sortent. Aucun texte intégral ne transite par un runner GitHub pour ces 110 documents — la
conséquence assumée en §5.2 ne s'applique pas à eux.

⚠️ **La porte de la §7 tient inchangée** : rien ne part avant le jugement de l'audit C49-3.
`RATTRAPAGE_PIECE_TAG` est livré VIDE, et l'étape refuse en plus de démarrer tant que l'audit a
des documents à extraire.

⚠️⚠️ **SECOND AMENDEMENT, 18/09 — LE STOCK COMPLET PART AUSSI PAR LE TICK, ET CE N'EST PAS UN
DÉTAIL : C'EST UNE DÉCISION PRISE SANS LE FEU VERT DE MARC, DANS LE SENS PRUDENT.** Marc, le
18/09 : « je veux que ce soit lia qui lise tous mes fichiers », puis « go … jusqu'à avoir une
boucle de lecture fiable ». Le module livré est `src/LectureFile.gs` (L36). Il ne construit PAS
le runner de la Q1. Trois faits, tous POSTÉRIEURS au 16/09 :

1. **Le mécanisme d'idempotence qui manquait existe, et il ne vit pas ici.** Depuis les ADR 0006
   et 0007 de MemoryAI, une vraie lecture REMPLACE la pièce d'inventaire, et la Mémoire sert une
   FILE (`GET /api/pieces/file`) : un papier lu en sort tout seul. Le plafond de 200 `fileId`
   qui rendait la voie du tick impraticable à cette échelle **n'existe plus** — c'était la
   raison technique écrite au premier amendement, et elle est levée.
2. **Le runner gagnerait moins que prévu, et ce gain n'est pas mesuré.** L'OCR reste dans Apps
   Script dans les DEUX voies (c'est Drive qui convertit) : le runner n'économise que le temps
   de l'appel Haiku, sur les ~10 à 20 s mesurées par document. Tant que la part de l'OCR n'est
   pas mesurée, « le runner est beaucoup plus rapide » est une supposition.
3. **Le runner exigerait une SECONDE implémentation de l'extraction** (le prompt, le parseur
   tolérant, `pieceMemoire_`, le titulaire) hors d'Apps Script. C'est « une règle et demie » :
   un papier lu par le runner arriverait à la Mémoire autrement qu'un papier classé aujourd'hui.

**Ce que ça COÛTE, et ce n'est pas adouci : du CALENDRIER.** À 17 min/j de budget des pièces
(partagé, jamais ajouté) et ~15 s par document, c'est de l'ordre de 60 à 70 documents par
jour — donc **environ deux mois** pour les ~2 645 papiers restants, pas deux jours. La Q1
avait été choisie par Marc CONTRE ce délai. Si deux mois est trop long, deux leviers existent
sans rien réécrire : réallouer des minutes au budget des pièces (une décision, pas un réglage),
ou construire le runner — la file de la Mémoire sert les deux voies à l'identique, elle ne sait
pas qui la consomme.

**Ce qui va dans le sens PRUDENT** : la frontière reste ÉTROITE. Aucun texte intégral ne quitte
le compte Google pour un runner ; seuls les champs sortent, comme pour les 110 premiers
documents. La conséquence assumée en §5.2 ne s'applique donc à AUCUN document lu par ce module.

⚠️ **La Q1 n'est toujours pas révoquée.** Elle reste la décision de Marc ; ce module la rend
simplement non nécessaire pour COMMENCER. `LECTURE_FILE_TAG` est livré ARMÉ (`l36-a`) sur sa
demande explicite, et le vider éteint cette campagne et elle seule.

**Q2 — les proches : DriveAI extrait un champ « titulaire ».** L'option écartée était de pousser
sans distinction — plus simple, et elle aurait retiré à Marc la possibilité de revenir en arrière
pour eux SEULS : il aurait fallu re-lire les 19 900 documents pour savoir lesquels sont les leurs.

⚠️ **Le « titulaire » sera parfois faux**, et il doit le dire : un document au nom de deux
personnes, un formulaire vierge, un papier où le nom n'apparaît pas. Le champ porte donc sa
**confiance**, et un titulaire incertain vaut « inconnu » — jamais « Marc » par défaut. Un
défaut de configuration n'est pas une décision, et ici le défaut le plus prudent est celui qui
n'attribue rien à personne.

⚠️ **Le champ ne décide de RIEN dans DriveAI.** Il est poussé, et c'est la Mémoire qui décidera
un jour d'en faire un réglage. Lui faire piloter quoi que ce soit ici — un niveau, un routage —
en ferait une garde bâtie sur une lecture de modèle, ce que cet ADR ne fait nulle part.

---

## 10. Risques, dits une fois

1. **Le texte des documents devient lisible hors du compte Google.** C'est le cœur de cet ADR,
   et aucun garde-fou ne l'annule — ils le bornent.
2. **L'extraction se trompe, et personne ne relit** : l'ADR 0004 a supprimé la validation. Un
   numéro mal lu vivra dans la Mémoire et sera redit avec aplomb. D3 mesure le taux d'erreur ;
   il ne le rend pas nul.
3. **Le titulaire est une lecture de modèle sur un sujet sensible.** Un document attribué au
   mauvais nom range la mauvaise personne dans la mémoire. Le champ porte sa confiance et ne
   décide de rien côté DriveAI, mais il sera lu comme un fait le jour où la Mémoire s'en servira.
4. **Le quota d'analyse est déjà tendu.** Ajouter un appel LLM par document au flux vivant est
   marginal aujourd'hui ; ça cesse de l'être le jour où le flux grossit. La métrique à surveiller
   est le temps d'exécution quotidien, pas le nombre de documents.
5. **Deux prompts au lieu d'un** : le classement et l'extraction dériveront séparément. C'est le
   prix de pouvoir diagnostiquer une régression — et il faut que les deux soient audités
   séparément, jamais ensemble.
6. **La liste FERMÉE des champs est le seul verrou de la frontière.** Elle ne tient que tant que
   le test qui la garde est lu. C'est la leçon du §9 : « promesse de verrou = verrou codé dans le
   même commit ».
