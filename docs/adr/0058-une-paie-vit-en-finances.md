# ADR-0058 — Une paie vit en Finances, quel que soit l'avis du LLM

* **Statut** : accepté
* **Date** : 2026-09-14
* **Demande de Marc** : « mes paies ne devraient pas arriver dans employeur mais seulement dans
  finances », puis, en réponse à mes deux questions : « **rl-1 aussi dans finances, attestation
  d'emploi reste dans 05** ».
* **Protocole** : §11 (toute modification du classement passe par un ADR AVANT la première ligne
  de code).

---

## Le problème, mesuré avant d'être décrit

`2026-09_Paie_Robovic Inc..pdf` a été classé le 14/09 à 18:00 dans
`05 · Emploi & carrière/Employeurs/Robovic`. Il devrait être dans
`02 · Finances/Revenus & paie/Robovic`.

**Audit du Drive réel, pas un échantillon** (§9 : « quand un rapport exhaustif existe, ne jamais
chiffrer depuis un échantillon ») :

| Dossier | Paies trouvées |
|---|---|
| `05 · Emploi & carrière/Employeurs/Robovic` | **1** — celle du 14/09, déposée par le FLUX |
| `05 · Emploi & carrière/Employeurs/Automatech` | 0 |
| `02 · Finances/Revenus & paie/Autres employeurs` | 1 — correctement classée |
| `02 · Finances/Revenus & paie/Robovic` | les précédentes, correctement classées |

Le stock à rapatrier est donc **UN fichier**. Ce n'est pas une migration : c'est une fuite, au
rythme d'une paie par période de paie.

## Pourquoi les deux comportements cohabitent

**Les missions de curation connaissent déjà la règle.** `routerCarriere_` (`src/Missions.gs`) la dit
mot pour mot : *« le domicile UNIQUE des paies est 02, quelle que soit la graphie du type »*, et
renvoie vers `Revenus & paie/<employeur>`. C'est pour ça que toutes les paies ANCIENNES sont au bon
endroit : une mission les y a rapatriées.

**Le flux vivant, lui, ne la connaît pas.** `planRoutageV2_` (`src/Router.gs`) prend le domaine tel
que le LLM le rend :

```js
var domaine = di ? di.domaine : c.domaine;   // di = pièce d'identité → domaine dérivé du TYPE
```

Or une paie **nomme un employeur** dans son en-tête. Le LLM répond donc « 05 · Emploi & carrière »,
ce qui n'est pas absurde — c'est simplement la mauvaise règle pour ce type de document. Le flux
applique ensuite `cheminCibleReset_('05 · Emploi & carrière', nom)`, qui connaît parfaitement les
paies… mais seulement **à l'intérieur de `02`**. Dans `05`, rien ne les reconnaît.

Résultat : les missions rangent, le flux dé-range, et comme les missions sont des campagnes qui
convergent puis s'arrêtent, c'est le flux qui a le dernier mot sur tout ce qui arrive désormais.

## La décision

**Le domaine d'une paie et d'un RL-1 est dérivé de leur TYPE, jamais de la réponse du LLM.**

Ce n'est pas une exception inventée pour l'occasion : c'est **exactement le patron déjà en place
pour les pièces d'identité**, deux lignes plus haut dans la même fonction
(`estDocumentIdentitePersonnel_` → `dossierIdentite_().domaine`). Une carte d'identité aussi nomme
une autorité émettrice ; on ne laisse pas le LLM en déduire le domaine. Les paies rejoignent cette
courte liste de types dont le domicile est une **propriété du document**, pas une interprétation.

### Ce qui est couvert, et ce qui ne l'est pas

| Type | Domaine | Pourquoi |
|---|---|---|
| Paie, bulletin/fiche/feuille de paie, bulletin de salaire | **02** | Décision de Marc. Prédicat PARTAGÉ `estTypePaieReset_` — mot entier, jamais « paiement ». |
| **RL-1** (relevé 1) | **02** | Décision de Marc (« rl-1 aussi dans finances »). Émis par l'EMPLOYEUR : même mode de panne exactement. |
| **RL-31** (relevé 31) | **inchangé** | Émis par le **propriétaire** (occupation d'un logement), pas par l'employeur. Il n'a pas le mode de panne « le LLM voit un employeur et route en 05 », et le tirer vers 02 serait un changement que Marc n'a pas demandé. Le prédicat partagé `estFeuilletFiscalReset_` couvre RL-1 **et** RL-31 : on le RÉUTILISE en lui soustrayant explicitement le 31, plutôt que d'écrire une deuxième règle qui divergera (§9, « deux canonicaliseurs du projet DIVERGENT »). |
| **Attestation d'emploi, lettre d'embauche** | **05** | Décision de Marc (« attestation d'emploi reste dans 05 »). Ce sont des documents de CARRIÈRE, pas de revenu. |
| CV, lettre de motivation | **05** | Inchangé. |
| `Relevé_<employeur>` sans numéro | **inchangé** | ADR-0044 D9 en fait une paie mensuelle — mais **uniquement parce qu'un employeur est déjà garanti par le contexte de la mission**. Au point de décision du flux, cette garantie n'existe pas : appliquer la règle ici capturerait les relevés BANCAIRES. §9, « l'asymétrie des verdicts commande la sévérité du prédicat » — un verdict qui DÉPLACE est définitif de fait, donc le prédicat est strict et, dans le doute, refuse. |

### Une seule règle, deux consommateurs

Le prédicat est posé dans `src/Reset.gs`, à côté de ses deux briques, et il **dérive le type par la
MÊME fonction que `cheminCibleReset_`** (`analyserNomClasse_` + `normaliserCle_`) :

```js
function estRevenuEmployeurReset_(nom, typeBrut) {
  var t = normaliserCle_(analyserNomClasse_(nom).type || '');
  if (estTypePaieReset_(t)) return true;
  if (estFeuilletFiscalReset_(t) && !estRl31Reset_(t)) return true;
  var b = normaliserCle_(typeBrut || '');          // le numéro du feuillet, voir plus bas
  return !!b && estFeuilletFiscalReset_(b) && !estRl31Reset_(b);
}
```

Il est appelé sur le nom FINAL, celui-là même que `cheminCibleReset_` reçoit ensuite. Le flux et le
reset lisent donc le même texte avec la même règle : la convergence est structurelle, pas une
coïncidence à re-vérifier (§9, C28-26 — « deux formules équivalentes écrites séparément divergent
toujours quelque part »).

## Ce que ça ne change pas

- **Aucune suppression, aucun scope, aucune sortie de `04`** : le changement porte sur le choix du
  domaine, en amont d'un pipeline dont toutes les gardes restent en place.
- **Le sous-chemin dans `02`** est déjà écrit et testé (`Revenus & paie/<employeur>`, employeur
  hors table → racine de `Revenus & paie`, jamais deviné). Rien à y toucher.
- **Les missions** ne bougent pas : elles avaient raison depuis le début.

## Méthode de test

1. **Non-régression sur les pièges connus**, chacun en test bloquant : « paiement », « reçu de
   paiement », « relevé de paiement » ne sont JAMAIS des paies (piège #228, mot entier) ; un CV et
   une attestation d'emploi chez Robovic restent en `05` ; un relevé BANCAIRE reste en `02` mais
   pas dans `Revenus & paie`.
2. **RL-31 reste où il est** — la soustraction explicite est testée, dans les deux sens.
3. **Corpus réel** : la décision est rejouée sur les noms réels du Drive, pas sur des cas choisis.
4. **Mutations** : retirer le forçage ⇒ tombe ; retirer la soustraction du RL-31 ⇒ tombe ; perdre
   le « mot entier » (« paiement » redevient une paie) ⇒ 5 tests tombent ; retirer la lecture du
   type brut ⇒ tombe.

## Le rattrapage du stock

Un seul fichier. Il sera repris **par la mission `paies` existante**, dont c'est exactement le
travail — sans bump de tag : ce fichier n'a jamais porté sa clé de succès, il n'est donc pas figé.
Si la mission ne le reprend pas (elle est marquée « terminée »), le déplacement se fera par une
proposition dans la file de réorg, validée par Marc — jamais d'office.

## Ce qu'on assume

- **Le LLM continuera de répondre « 05 » pour une paie**, et c'est très bien : on ne cherche pas à
  le corriger, on cesse de lui déléguer une décision que le TYPE tranche mieux que lui. C'est le
  même arbitrage que pour les pièces d'identité.
- **Un document dont le type n'est PAS reconnu comme une paie continue de suivre le LLM.** Le
  prédicat n'élargit rien : dans le doute, il refuse, et le document est classé comme avant.


---

## Deux faits mesurés pendant l'implémentation (et non supposés)

### 1. Le numéro du feuillet ne survit PAS au renommage

`nommerDocument_` réduit « Relevé 1 » à « **Relevé** » dans le nom final. Or
`estFeuilletFiscalReset_` est ANCRÉ sur le nombre — c'est ce qui l'empêche d'attraper un « Relevé
10 ». Au moment où le flux lit le nom final, le « 1 » a donc déjà disparu, et le RL-1 serait resté
en `05` malgré la règle.

Le prédicat lit donc **aussi le `type_doc` brut du LLM**, seul endroit où le numéro est encore là —
et **seulement pour le feuillet** : les paies traversent le renommage intactes et restent jugées sur
le nom, là où la convergence avec `cheminCibleReset_` est structurelle. Élargir le chemin « type
brut » aux paies relâcherait un verdict qui DÉPLACE sans rien gagner.

### 2. Un RL-1 atterrit dans `Revenus & paie/<employeur>`, pas dans `Impôts & déclarations`

Conséquence directe du point 1 : le nom ayant perdu son numéro, la table de `02` le lit comme un
`Relevé_<employeur>`, c'est-à-dire — par ADR-0044 D9 — une paie mensuelle. Il est donc **bien « dans
finances »**, ce que Marc a demandé, mais **pas dans le sous-dossier fiscal**.

Le corriger demanderait de faire survivre le numéro au renommage, ce qui touche TOUT le nommage du
projet. **Hors périmètre, signalé plutôt que fait** (§6 : un travail « pendant qu'on y est » est un
travail non demandé). Figé par un test, pour que ce soit visible et non découvert par hasard.

### 3. Limite connue, non élargie : la graphie « RL-1 »

Le prédicat partagé reconnaît « relevé 1 », pas « RL-1 ». L'élargir depuis ce lot créerait une
divergence avec ses autres consommateurs (la mission paies, la consolidation). Figé par un test en
l'état, pour que l'élargissement soit un jour une DÉCISION et pas un effet de bord.

## Ce que les tests ont coûté (et ce que ça dit)

Deux tests existants sont tombés : ils utilisaient **une paie comme figurant** pour prouver tout
autre chose (« un employeur validé garde son dossier », « une entité au Dossier ID périmé est
re-pointée »). Flipper leur attendu les aurait gardés verts en leur faisant prouver autre chose.
Le figurant a donc été remplacé — et il a fallu le remplacer **à conditions égales** : la première
tentative (`Attestation d'emploi`) résout un niveau plus profond (`/Attestations & lettres`), si
bien que le dossier FINAL n'est plus celui de l'entité et que le re-pointage ne se déclenchait plus.
Le test serait tombé pour une raison sans aucun rapport avec son sujet. `Document professionnel`
résout à la même profondeur que l'ancienne paie : le sujet est intact.

**4 mutations jouées, 4 attrapées** : forçage retiré · soustraction du RL-31 retirée · « mot entier »
perdu (« paiement » redevient une paie) · lecture du type brut retirée.
