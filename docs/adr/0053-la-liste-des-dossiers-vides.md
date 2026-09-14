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

**D9 — Un lot écourté le DIT, et il s'écourte tout seul sous la panne.** `BilanLot` porte
`nonTentees` et `interrompu` : une session morte à la 40ᵉ ligne sur 124 rendait exactement le même
bilan qu'un lot complet, et rien nulle part ne disait que 84 lignes n'avaient jamais été tentées
(« une passe abandonnée doit se DIRE dans l'état », §9). Et `CORBEILLE_MAX_PANNES` = 5 pannes
CONSÉCUTIVES coupent le lot : sous un 429 généralisé, 124 lignes × ~4 appels × 4 tentatives ≈ 2 000
requêtes partaient en rafale sur un quota **partagé avec le moteur**. Le compteur se remet à zéro
dès qu'une ligne aboutit ou reçoit un verdict — il vise la RAFALE, jamais le cumul.

**D10 — Le SECOND producteur de propositions est gardé lui aussi.** Après une fusion validée dans
l'app, le moteur appendait directement une ligne `vide-candidat` pour la source drainée, sans passer
par `detecterDossierVide_` — donc sans la garde par capacité, alors que §3 affirmait le contraire.
`proposerSourceFusion_` (PURE) porte désormais la décision, avec la nuance déjà codée chez son
voisin `estAncreStructurelleFusion_` : pour une fusion de DOUBLONS DE MÊME NOM, proposer la source
reste légitime (le canonique existe toujours).

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
