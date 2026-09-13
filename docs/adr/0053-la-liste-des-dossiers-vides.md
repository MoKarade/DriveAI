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
| des nœuds que la table recrée PAR NOM | `Robovic`, `Automatech`, `DriveAI`, `Novel Software`, `Candidatures` | supprimés, ils reviennent au premier document qui les vise |
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
| réseau, quota, session | *(aucun)* | **on ne conclut pas** : la ligne reste candidate, re-tentée |

La dernière ligne est la garde qui compte : une incertitude ne se transforme pas en verdict. Un
quota d'une minute retirerait sinon de la liste des dossiers que personne n'a regardés.

**D4 — Ce que ce lot NE fait PAS.** Le moteur ne corbeille toujours rien : la mutation reste dans
`app/src/corbeille.ts`, au clic de Marc, avec re-vérification live de chaque dossier (ADR-0014,
§1.2 — non négociable). « Supprime tous les vides » se lit donc : *un* clic sur « Tout corbeiller »,
qui traite maintenant les 124 lignes au lieu de s'arrêter sur la première.

**D5 — La peinture rouge reste telle quelle** (choix de Marc, 13/09). Deux canaux de proposition
coexistent donc : la couleur dans Drive et la liste dans l'app. La sonde de dé-peinture de C28-90
reste le chemin de retour du premier.

## 3. Conséquences

- Ce que Marc verra au prochain clic : les dossiers réellement vides partent à la corbeille Drive
  (récupérables 30 jours) ; les autres quittent la liste avec leur raison ; un bilan chiffré.
- Les futurs constats seront moins nombreux et situables. Ils ne peuvent plus contenir un nœud de
  la structure : c'est vérifié par la table, pas par une liste que quelqu'un devra maintenir.
- Coût : le chemin coûte quelques appels `getParents` **par dossier réellement devenu vide** (cas
  rare, déjà en aval d'une garde de vacuité), la garde par capacité aucun appel réseau.

## 4. Ce qui reste ouvert

- Les 114 dossiers réellement vides d'août ne sont supprimés qu'au clic. Tant qu'il n'a pas lieu,
  ils restent dans Drive, vides.
- Rien ne re-propose un dossier vidé AVANT ce lot autrement que par ces lignes : la détection ne se
  déclenche qu'au moment où un dossier DEVIENT vide. Un balayage périodique des dossiers vides du
  Drive serait un autre chantier — et il faudrait d'abord trancher s'il est souhaitable.
