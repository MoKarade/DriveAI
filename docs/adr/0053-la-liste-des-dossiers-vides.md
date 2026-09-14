# ADR-0053 — La liste des dossiers vides ne propose plus ce que le moteur recrée

**Statut** : accepté · **Date** : 2026-09-13 · **Décision de Marc** : « il me propose trop de
dossiers à mettre en poubelle, même des dossiers utiles — fais un nettoyage et améliore », puis,
sur les 114 restants : « **supprime tous les vides** ».

Révise le fonctionnement de la liste `vide-candidat` d'**ADR-0025 (axe 1)** ; ne touche PAS à
**ADR-0014** (la corbeille reste l'affaire de l'app, au clic de Marc, jamais du moteur).

## 1. Le constat, compté plutôt que supposé

Décompte exhaustif de l'onglet `Réorg` le 13/09 : **124 dossiers** proposés à la corbeille, tous
vidés entre le **1er et le 15 août** par le grand rangement. Aucun depuis. Dedans :

| ce qu'on y trouve | exemples | pourquoi c'est faux |
|---|---|---|
| des noms de RACINE DE DOMAINE | `02 · Finances`, `05 · Carrière` | l'app REFUSE de les corbeiller par leur nom |
| des nœuds que la table recrée PAR NOM (7 lignes, 6 noms) | `Robovic` (×2), `Projets`, `Automatech`, `DriveAI`, `Novel Software`, `Candidatures` | supprimés, ils reviennent au premier document qui les vise |
| une entité du référentiel | `IUT Du Littoral` | idem : le flux la recrée |
| des doublons de NOM sans chemin | deux `Mémoire`, deux `Exercices`, quatre graphies d'`IUT Du Littoral` | impossible de savoir lequel est lequel |
| des dossiers qui n'existent PLUS | `1gG2fec…` → l'API rend `404` | la ligne survit au dossier |

Et le défaut qui rendait la liste **inutilisable en entier** : le bouton « 🗑 Tout corbeiller (124) »
faisait `for (…) { await corbeillerDossierVide(…) }` dans un `try` unique — **la première exception
arrêtait tout**. Le premier de la liste étant un dossier nommé `02 · Finances`, refusé par son nom,
le bouton ne corbeillait **rien**, et le message d'erreur ne parlait que de lui. 124 propositions,
zéro action possible autrement qu'une par une.

## 2. Décisions

**D1 — Le moteur ne propose plus ce que la TAXONOMIE sait recréer.** Garde par CAPACITÉ
(`estNoeudRecreable_`, PURE) plutôt que par liste d'exceptions (leçon §9) : on demande à la table
elle-même si elle connaît ce nœud, **à n'importe quelle profondeur**, plus les sous-dossiers
d'école, les entités VALIDÉES du référentiel, les années/schémas, et tout nom de racine de domaine
(`^\d{2} · `). Une liste d'exceptions serait fausse au premier nœud ajouté, et personne ne saurait
qu'elle l'est. Échec fermé : un dossier sans nom n'est jamais proposé.

**D2 — Le constat porte le CHEMIN, pas le nom.** `cheminPourConstat_` remonte jusqu'à la racine de
domaine (borné à 10 niveaux, dégradé sur le nom seul si la chaîne est illisible). Un constat qu'on
ne peut pas situer n'est pas un constat — c'est ce qui forçait Marc à trancher en bloc.

**D3 — Un refus ne stoppe plus le lot : il classe SA ligne.** `statutRefusCorbeille` (PURE) traduit
chaque refus connu en statut, et la ligne quitte la liste en disant pourquoi :

| refus | statut | sens |
|---|---|---|
| `Google API 404` | `vide-disparu` | le dossier n'existe plus |
| `non-vide` | `vide-repris` | le classement l'a re-rempli |
| `racine-systeme`, `zone-protegee`, `dossier-structurel`, `pas-un-dossier` | `vide-protégé` | n'aurait jamais dû être proposé |
| `ascendance-illisible` | *(aucun)* | on n'a pas PU lire la chaîne : ce n'est pas un verdict |
| réseau, quota, session | *(aucun)* | **on ne conclut pas** : la ligne reste candidate, re-tentée |

Les deux dernières lignes sont la garde qui compte : une incertitude ne se transforme pas en
verdict. Un quota d'une minute retirerait sinon de la liste des dossiers que personne n'a regardés.

⚠️ **`ascendance-illisible` est un motif NEUF, et c'est le cœur de D3** (🔴 de la revue). Avant,
`verdictCorbeille` rendait `zone-protegee` dans les DEUX cas : « un ancêtre EST la zone protégée »
et « je n'ai pas pu lire les ancêtres ». Le refus était le bon (échec fermé, §1.2) — mais le MOTIF
était un mensonge, et c'est lui que `statutRefusCorbeille` lit désormais pour décider qu'une ligne
quitte la liste **définitivement** : le moteur dédoublonne sur `videcandidat|<fileId>` et ne
re-proposera JAMAIS une ligne retirée. Un `429` sur un simple GET d'ancêtre aurait donc effacé à vie
une proposition légitime, sous l'étiquette « protégé ». Deux faits différents, deux motifs
différents, même refus — leçon §9 : *un verdict pris sur la donnée RICHE ne se re-dérive jamais
depuis sa forme APPAUVRIE*, ici le texte du message d'erreur.

⚠️ **Où vit vraiment ce verrou** (précision de la 2ᵉ revue). Ce qui protège, c'est la SCISSION dans
`verdictCorbeille` : tant qu'un seul motif couvrait les deux faits, aucune ligne en aval ne pouvait
les distinguer. La ligne `ascendance-illisible` de `statutRefusCorbeille`, elle, ne change le
résultat que sur les COMPOSITES (`ascendance-illisible` + `racine-systeme` / `dossier-structurel` /
`pas-un-dossier`) — un motif seul retombe de toute façon sur le `return null` final. La revue l'a
montré en la supprimant : 16/16 tests verts. Elle est donc désormais verrouillée par ces trois cas
composites, et ce paragraphe dit qui fait quoi plutôt que de créditer la mauvaise ligne.

**D4 — Ce que ce lot NE fait PAS.** Le moteur ne corbeille toujours rien : la mutation reste dans
`app/src/corbeille.ts`, au clic de Marc, avec re-vérification live de chaque dossier (ADR-0014,
§1.2 — non négociable). « Supprime tous les vides » se lit donc : *un* clic sur « Tout corbeiller »,
qui traite maintenant les 124 lignes au lieu de s'arrêter sur la première.

**D6 — La garde s'applique AUSSI au STOCK déjà proposé** *(🔴 de la 2ᵉ revue, trouvé par DEUX
agents en convergence)*. `estNoeudRecreable_` n'avait qu'un site d'appel, sur le chemin d'ÉCRITURE
d'un nouveau constat. Or les 124 lignes d'août étaient DÉJÀ dans l'onglet, qui est append-only :
rien ne les re-filtrait. Et c'est le même lot qui rend le bouton « Tout corbeiller » OPÉRANT — donc,
au clic, `Robovic` (×2), `Projets`, `Automatech`, `DriveAI`, `Novel Software`, `Candidatures` et
`IUT Du Littoral` seraient partis à la corbeille : exactement les « dossiers utiles » de la plainte
de Marc, exactement ce que D1 déclare intouchable. Corriger le flux sans nettoyer le stock aurait
rendu le défaut EFFECTIF au lieu de le fermer.
`filtrerVidesCandidatsRecreables_` (one-shot, versionné par `VIDES_FILTRE_TAG`) relit les lignes
`vide-candidat`, leur ré-applique la garde et les passe à `vide-protégé`. Aucune mutation Drive :
seuls des statuts changent. C'est aussi le chemin de RETOUR qui manquait aux lignes déjà mal
proposées. La VERSION dans le tag est ce qui rend l'affinage effectif : ajouter un nœud à la
taxonomie re-filtre le stock au bump suivant (leçon §9).

⚠️ **Et l'affinage marche dans les DEUX sens** (3ᵉ revue). Une première écriture ne re-collectait que
les lignes `vide-candidat` : un bump pouvait RETIRER une proposition, jamais la rendre. Or C28-89 a
réellement retiré `Modèles & formulaires` de la table — la ligne correspondante serait restée
« protégée » à vie pour un dossier que plus rien ne recrée. C'est le refus keyé sur « je n'ai pas su
faire » de §9, sans sa version. Le filtre écrit donc sa MARQUE et son tag dans le détail
(`[filtre-vides c2893-1]`), et re-juge les lignes marquées d'un tag différent : encore un nœud ⇒ on
ré-écrit sous le tag courant, plus un nœud ⇒ retour à `vide-candidat`. Les `vide-protégé` posés par
l'**APP** (zone protégée, racine système) ne portent pas la marque et ne sont jamais relus : eux sont
définitifs par nature.

⚠️ **La colonne « Chemin actuel » porte TROIS formats, et aucun discriminant ne les sépare.** Un nom
NU (lignes d'avant C28-93), un chemin ancré sur la racine de domaine (`cheminPourConstat_`), et un
chemin d'INVENTAIRE SCOPÉ ancré sur le dossier que Marc analysait (`Robovic/Projets`, produit par
`inventaireDossiers_` quand on clique « Analyser la structure » sur un dossier). Se tromper coûte
dans les deux sens : découper toujours retire à tort un dossier réellement nommé « Impôts/Archives »,
ne jamais découper laisse passer `Robovic/Projets` — et une première écriture, qui ne découpait que
les chaînes commençant par une racine de domaine, a effectivement rouvert la garde sur `Projets` et
`Candidatures`, les noms mêmes de la plainte de Marc (régression attrapée en 4ᵉ revue).
`estNoeudRecreableDepuisConstat_` essaie donc les **deux** lectures et refuse si l'une d'elles est un
nœud — sauf pour un chemin ancré sur un domaine, qui ne se lit que par son dernier segment (sa chaîne
entière commence par `NN · `, que la garde reconnaît comme un nom de racine : la lire en bloc
protégerait tout ce qui est sous un domaine, donc tout). Le prédicat qui déclenche l'action
quasi-irréversible est STRICT et, dans le doute, REFUSE (§9). Conséquence assumée : un dossier
réellement nommé « Impôts/Archives » n'est plus proposé. `nomDepuisConstat_` ne sert plus qu'à
l'AFFICHAGE.

⚠️ **La marque du filtre porte son tag ET le statut qu'il a écrit** (`[filtre-vides c2893-1 →
vide-protégé]`). Le tag seul ne suffisait pas : l'app n'écrit QUE la colonne F (le statut), jamais la
G (le détail), donc une marque sans statut prouvait seulement « le filtre a touché cette ligne un
jour ». Scénario : le filtre rend une ligne candidate, Marc clique, Drive refuse (zone protégée),
l'app écrit `vide-protégé` en F — et au bump suivant la ligne redevenait `vide-candidat`,
réapparaissait dans la liste, échouait encore, à chaque bump. En comparant le statut inscrit au
statut RELU, toute écriture de l'app fait diverger les deux et rend son verdict définitif.

**D7 — `vide-repris` est le seul statut RÉVISABLE de la famille.** Le moteur dédoublonne sur la
seule présence de `videcandidat|<id>`, quel que soit le statut. `vide-disparu`, `vide-protégé` et
`corbeillé` sont définitifs par nature ; `vide-repris` dit « il n'était plus vide AU MOMENT DU
CLIC » — un fait qui redevient faux dès que la consolidation le re-vide. Sans exception, un dossier
re-rempli puis re-vidé n'aurait plus JAMAIS été proposé, alors que c'est son cas d'usage. Cas
fréquent et sournois : `compterEnfantsStrict` compte aussi les enfants CORBEILLÉS (exigence
ADR-0014), donc un dossier qui n'a plus que des corbeillés rend `non-vide` → `vide-repris` alors
que rien ne l'a re-rempli. Le refus reste juste ; sa PERMANENCE ne l'était pas.

**D8 — Un dossier à la corbeille n'est jamais une CIBLE de classement** *(garde-fou §1.2, relevé en
revue)*. `sousDossier_` faisait `getFoldersByName(...).next()`, et cet itérateur rend AUSSI les
dossiers corbeillés. Un dossier mis à la corbeille au titre d'ADR-0014 redevenait donc la cible du
classement : les documents y étaient déposés, puis **purgés avec lui à 30 jours** — une suppression
automatique, le garde-fou non négociable. Défaut PRÉ-EXISTANT, mais rendu atteignable par ce lot
puisqu'il débloque le bouton. Fermé ici plutôt que renvoyé au backlog : laisser ouvert un chemin
vers la suppression automatique n'est pas une option. Coût : un `isTrashed()` par résolution de
dossier.

⚠️ **Et pas seulement la FEUILLE de la chaîne — ses RACINES aussi** (3ᵉ revue). Le classement résout
`racine → segment → segment` ; ne garder que `sousDossier_` laissait le trou sur `dossierDomaineAuto_`
et `dossierRacineParNom_`, c'est-à-dire sur `_Doublons`, `_Médias`, `_Technique`, `_Miroir du dépôt`,
et les domaines AUTO (`07 · Santé`, `09 · Voyages`). Pire : ces deux-là résolvent par un **ID mémorisé
en Script Property**, qui SURVIT au corbeillage. Scénario : Marc corbeille `_Doublons` depuis Drive
(la garde de nom qui le protège vit dans l'APP, pas dans Drive), `routageDoublon_` continue d'y
envoyer chaque doublon, et 30 jours plus tard Drive purge le dossier **avec son contenu** — §1.1(c),
« un doublon, MÊME SENSIBLE, va dans `_Doublons`, jamais effacé », sur la population dont C28-49 PR4
a mesuré qu'elle contenait 1 076 fichiers dont trois passeports. `dossierVivantOuNull_` et
`racineVivanteOuCreee_` ferment les deux voies (ID et nom). La voie par ID du routage d'entités,
elle, était déjà fermée (`dossierEntiteParId_`).
Effet de bord assumé : si Marc RESTAURE dans les 30 jours un dossier qu'on a remplacé, il se retrouve
avec deux homonymes. Un doublon se répare ; une purge à 30 jours non.

**D11 — Ce que le moteur NE peut pas promettre : qu'une abstention soit rattrapée.** Les cinq
appelants de `detecterDossierVide_` n'observent le dossier qu'APRÈS qu'un fichier l'a QUITTÉ. Une
fois le dossier vide, plus aucun fichier n'en sort : il n'est jamais re-constaté. Sur un blip de
lecture du référentiel, la proposition est donc perdue — pas le dossier, qui reste simplement vide
et non proposé. Un commentaire du code a d'abord promis l'inverse (« sera re-constaté plus tard ») ;
il est corrigé. L'arbitrage est assumé, et c'est le même que partout dans ce lot : un dossier vide
qui subsiste coûte moins qu'un dossier utile corbeillé. Un mécanisme de constat différé est au
backlog (C28-97).

**D9 — Un lot écourté le DIT, et il s'écourte tout seul sous la panne.** `BilanLot` porte
`nonTentees` et `interrompu` : une session morte à la 40ᵉ ligne sur 124 rendait exactement le même
bilan qu'un lot complet, et rien nulle part ne disait que 84 lignes n'avaient jamais été tentées
(« une passe abandonnée doit se DIRE dans l'état », §9). Et `CORBEILLE_MAX_PANNES` = 5 pannes
CONSÉCUTIVES coupent le lot : sous un 429 généralisé, 124 lignes × ~4 appels × 4 tentatives ≈ 2 000
requêtes partaient en rafale sur un quota **partagé avec le moteur**. Le compteur se remet à zéro sur
une ligne ENTIÈREMENT propre — il vise la RAFALE, jamais le cumul — et il surveille les **deux**
canaux : une première écriture ne comptait que Drive, or un 429 côté Sheets laissait le lot aller au
bout, 124 dossiers réellement corbeillés et 124 statuts perdus, avec `interrompu: ''` ; Marc
rechargeait, revoyait ses 124 lignes, et rien ne disait que les dossiers étaient déjà à la corbeille.

**D10 — Le SECOND producteur de propositions est gardé par la MÊME règle, pas par une variante.**
Après une fusion validée dans l'app, le moteur appendait directement une ligne `vide-candidat` pour
la source drainée, sans passer par `detecterDossierVide_` — donc sans la garde par capacité, alors
que §3 affirmait le contraire. `proposerSourceFusion_` (PURE) porte désormais la décision.
⚠️ Une première écriture exemptait les fusions de DOUBLONS DE MÊME NOM, en copiant la réserve du
voisin `estAncreStructurelleFusion_`. La 3ᵉ revue a mesuré ce que ça donnait : `Robovic` REFUSÉ par
un producteur et PROPOSÉ par l'autre dès que la cible porte le même nom, puis défait par le filtre du
stock au bump suivant — trois règles, deux verdicts, exactement le corollaire §9 « mutualiser UNE
dimension d'une règle ne couvre pas les autres ». Et la justification (« le canonique existe
toujours ») ne tenait que pour un dossier d'ENTITÉ, où `repointerEntites_` vient de re-pointer le
`Dossier ID` ; pas pour un nœud de table à profondeur ≥ 2, que la table recrée PAR NOM au premier
document — le ping-pong même que la garde doit fermer. Les deux producteurs appliquent donc le même
prédicat. Ce qu'on perd : un doublon d'entité vidé n'est plus proposé, donc un dossier vide subsiste.
Un dossier vide qui reste coûte moins qu'un dossier utile corbeillé.

**D5 — La peinture rouge reste telle quelle** (choix de Marc, 13/09). Deux canaux de proposition
coexistent donc : la couleur dans Drive et la liste dans l'app. La sonde de dé-peinture de C28-90
reste le chemin de retour du premier.

## 3. Conséquences

- Ce que Marc verra au prochain clic : les dossiers réellement vides partent à la corbeille Drive
  (récupérables 30 jours) ; les autres quittent la liste avec leur raison ; un bilan chiffré.
- Les constats — futurs ET déjà écrits (D6) — sont moins nombreux et situables. Ils ne peuvent plus
  contenir un nœud de la structure : c'est vérifié par la table, pas par une liste que quelqu'un
  devra maintenir, et sur les DEUX producteurs (consolidation et fusion, D10).
- Un référentiel d'entités MUET fait s'abstenir de tout constat. `entitesValideesParCle_` échoue
  OUVERT (elle avale son exception et rend `{}`) : bonne dégradation pour le ROUTAGE, où le document
  part à plat et sera repris ; faux verdict DÉFINITIF pour une proposition à la corbeille. D'où
  `entitesValideesOuNull_` (qui DIT l'échec) et `estNoeudRecreablePrudent_` (qui s'abstient).
  L'abstention porte aussi sur un référentiel VIDE, parce que les deux sont aujourd'hui
  indiscernables — `chargerEntitesCache_` pré-positionne son cache à vide AVANT de lire la Sheet,
  donc un second appel dans le même run ne lève plus. Bug de fond, PRÉ-EXISTANT, au backlog ; une
  fois corrigé, la condition « vide » pourra être relâchée.
- Re-vérification au clic : le mémo d'ascendance n'est plus purgé entre deux lignes d'un même lot
  (il l'était par un `viderCachePlages()` global). Le dossier LUI-MÊME reste relu en direct ; seule
  une mutation d'un ANCÊTRE vers `04` pendant le lot passerait — et le moteur ne déplace jamais un
  dossier VERS 04. Écrit ici parce que la note d'interface (« re-vérifié au clic ») est désormais un
  poil plus large que le code.
- Coût : le chemin coûte quelques appels `getParents` **par dossier réellement devenu vide** (cas
  rare, déjà en aval d'une garde de vacuité), la garde par capacité aucun appel réseau.

## 4. Ce qui reste ouvert

- Les 114 dossiers réellement vides d'août ne sont supprimés qu'au clic. Tant qu'il n'a pas lieu,
  ils restent dans Drive, vides.
- Rien ne re-propose un dossier vidé AVANT ce lot autrement que par ces lignes : la détection ne se
  déclenche qu'au moment où un dossier DEVIENT vide. Un balayage périodique des dossiers vides du
  Drive serait un autre chantier — et il faudrait d'abord trancher s'il est souhaitable.
