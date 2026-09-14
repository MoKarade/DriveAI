# ADR-0056 — Finaliser avant le prochain chantier

**Statut** : accepté · **Date** : 2026-09-14 · **Demande de Marc** : « j'ai un gros chantier que je
veux faire mais d'abord regarde ce qu'il faut finaliser », puis, sur les quatre points remontés :
« C28-93 tout vider a jamais marché · C28-90 fusionne en un 2014-2018 · C28-86 pose question ·
C28-92 oui », et enfin « go, 2014-2017 c'est bon ».

Trois lots dans une seule livraison. Ils n'ont rien en commun sauf leur raison d'être : **vider la
file de ce qui attendait une décision**, pour que le chantier suivant parte d'un socle propre.

---

## A · « Tout corbeiller » n'a jamais marché — et le code, lui, marchait

### Ce qui a été mesuré, plutôt que supposé

| question | réponse | comment |
|---|---|---|
| L'app en ligne porte-t-elle le correctif de C28-93 ? | **oui** | l'empreinte du fichier servi par `drive.hubperso.com` (`index-DF2-98ka.js`) est **exactement** celle de la compilation locale |
| Les 112 propositions existent-elles vraiment ? | **oui** | statut `vide-candidat`, colonne F, format inchangé par le filtre C28-93 |
| Marc voit-il la liste et le bouton ? | **oui** | « 🗑 Tout corbeiller (112) », actif |
| Que se passe-t-il au clic ? | **« rien du tout »** | sa réponse |

Or **tous** les chemins de `corbeillerLot` produisent un affichage : un bilan, une erreur, ou les
deux. Le code ne peut pas être silencieux. Ce qui peut l'être, c'est **l'endroit où il parle** :

```
<div class="prop-carte vides">
  <b>Dossiers vides</b>
  {erreur} {bilan} {progression}   ← le compte rendu est ICI, en TÊTE
  …112 lignes…
  [ 🗑 Tout corbeiller (112) ]      ← et le bouton ICI, tout en BAS
```

Marc clique en bas ; le résultat s'affiche 112 lignes plus haut, hors de son écran. De là où il
est, il ne se passe rien. **Le défaut n'est pas dans la logique, il est dans la mise en page** — et
c'est pour ça qu'aucune relecture de `corbeille.ts` ne pouvait le trouver.

### Décision

Le compte rendu vit désormais **au bas de la carte et en position collante** : il reste visible où
qu'on soit dans la liste, ce qui vaut aussi pour un clic 🗑 unitaire fait tout en haut. Et **aucun
`return` muet** : un clic sans effet (app occupée, liste vide) DIT pourquoi.

### La leçon, qui dépasse ce bouton

C28-93 avait vérifié son effet sur le **compteur du moteur** (124 → 112). Personne n'avait vérifié
ce que **l'écran montre après l'action**. Un correctif d'interface ne se prouve pas par un chiffre
d'état : il se prouve en regardant l'écran là où l'utilisateur regarde.

---

## B · Les deux dossiers de collège/lycée n'en font plus qu'un (C28-90)

Marc : « fusionne en un 2014-2018 », puis, sur le nom : `Collège & Lycée — divers (2014-2018)`.

- Le dossier Drive `…(2014-2017)` est **renommé** `…(2014-2018)` (fait).
- `Lycée — Thérèse Davila (2017-2018)` devient une **source** de `ecoles-archives06` : son contenu
  part dans le dossier fusionné. C'est la seule paire de la mission dont la source est un dossier de
  Marc — elle existe parce que c'est LUI qui a demandé la fusion.
- La table du flux ne porte plus qu'un nœud, et `ecoleParNomReset_` / `RESET_FENETRES_ECOLE`
  rendent ce libellé.
- **`Archives scolaires` repasse de 8 à 7 enfants** ⇒ son exemption au plafond ≤ 7 est **retirée**.
  Une exemption devenue inutile se retire : gardée, elle couvrirait en silence le prochain
  dépassement — celui que personne n'aura décidé.

### La fenêtre reste 2014-09 → 2017-08, et c'est la seule décision non évidente du lot

Marc a dit « 2014-2018 » ; sa prépa couvre 2017-09 → 2018-08. Étendre la fenêtre jusqu'en 2018 la
ferait **chevaucher** celle de la prépa : tout document de cette année-là tomberait dans deux
fenêtres et serait **refusé** — l'année de prépa deviendrait inclassable par la date. Signalé à
Marc, qui a tranché : « 2014-2017 c'est bon ». Le NOM du dossier couvre la période de ses
documents ; la FENÊTRE, elle, doit rester disjointe. **Prouvé par mutation** : étendre la fenêtre à
2018 fait tomber 3 tests.

---

## C · Re-dater les 328 fichiers de `06` (C28-92) — et lui donner enfin un budget

### Le travail utile n'est pas celui qu'on croyait

C28-88 a prouvé que la lecture LLM **ne trouve pas l'école** dans ces documents. Elle trouve la
**DATE** : 239 des 328 fichiers à plat portent `2026`, la date de RÉCEPTION faute de date lisible à
l'import, alors que le document porte la sienne dans son en-tête. Re-datés, ils tombent dans les
fenêtres de scolarité et se rangent seuls. **328 × 0,0261 $ ≈ 8,6 $**, dans l'enveloppe approuvée,
sous le frein `LLM_BUDGET_CAMPAGNES`.

`REANALYSE_TAG` : `c26-08` → `c28-92`. `REANALYSE_CIBLES` : `['06 · Études & diplômes']` — la
collecte n'itère QUE sur cette liste, donc le coût reste borné à `06`.

### Le trou qu'on ne pouvait pas laisser en rallumant cette campagne

`reanalyse` n'avait **aucun budget quotidien** — seulement un plafond de 2 min par tick. « Un
plafond par RUN ne borne pas la JOURNÉE » (§9, C28-42) : à 288 ticks, elle pouvait à elle seule
franchir le mur runtime d'Apps Script (~90 min/j) et **geler tous les déclencheurs, chien de garde
compris** (C28-29). Pire, n'ayant pas de constante `*_BUDGET_JOUR_MS`, elle était **invisible de
l'invariant d'enveloppe** : le test restait vert pendant que l'enveloppe croissait. C28-86 le
signalait depuis le 12/09.

`REANALYSE_BUDGET_JOUR_MS: 8 min`, **prélevées et non ajoutées** (§9 « réallouer, jamais
augmenter ») : `GMAIL_HISTO_BUDGET_JOUR_MS` passe de 20 à 12 min. C'est la réallocation que C28-70
attendait faute de preuve — et **la preuve est désormais écrite par le moteur lui-même** : sa ligne
de santé dit « Historique Gmail : terminée ✅ — ses 20 min/j sont RÉALLOUABLES ». La somme de
l'enveloppe reste **exactement 63 min/j**, et la nouvelle constante est ajoutée **aux deux sommes**
de l'invariant ainsi qu'à son inventaire.

### Ce qui est parké, et qui est dit

`03` et `08` sortent des cibles. Leurs clés `reanalyse|c26-08|<fileId>` survivent : reprendre
C26-08 se fera par un NOUVEAU tag et ces domaines remis dans la liste (backlog **C28-111**). Le
compteur de C26-08 n'est pas lisible d'ici — sa ligne de Progression est absente, ce qui est en
soi un défaut d'observabilité — mais la ventilation LLM de septembre montre **zéro dépense de
re-analyse** : rien d'actif n'est interrompu.

---

## Méthode de test

1. Le budget quotidien **coupe** (plafond atteint aujourd'hui), **se libère** (même plafond, mais
   consommé hier), **s'écrit** sous le jour courant, et s'écrit **même sur exception** — les quatre,
   dérivés de la constante, jamais de sa valeur du jour.
2. L'invariant d'enveloppe somme la 9ᵉ jambe ; l'inventaire des constantes la classe.
3. Le nom du dossier fusionné est verrouillé des deux côtés (table ↔ mission ↔ fenêtres).
4. **5 mutations, 5 attrapées** : gate quotidienne retirée · ms non écrites · enveloppe gonflée de
   12 min · nom du dossier divergent · fenêtre étendue à 2018.

## Ce qu'on assume

- **Trois tests mentaient déjà, et ce lot les a fait tomber** : `majSante_` affirmait dériver les
  20 min de CONFIG en écrivant `20` en dur (son propre commentaire avait prédit qu'il tomberait
  « le jour où les 20 min sont réallouées »), et deux tests de campagne recopiaient le tag
  `c26-08`. Tous trois dérivent désormais de la constante.
- **C28-86 ne demande plus rien au code** : Marc met les deux fichiers illisibles à la poubelle
  lui-même. La mission Carrière convergera d'elle-même quand ils auront disparu.
- **La ligne de Progression de `reanalyse` est absente de l'état** alors que `Suivi.gs` la déclare.
  Non diagnostiqué ici (backlog C28-112) : une campagne qu'on rallume sans barre de progression est
  une campagne qu'on ne saura pas suivre.
