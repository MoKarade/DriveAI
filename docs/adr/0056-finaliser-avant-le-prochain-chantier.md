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
4. **12 mutations, 12 attrapées** : gate quotidienne retirée · ms écrasées au lieu d'accumulées ·
   marge de démarrage retirée · enveloppe gonflée de 12 min · transfert à moitié rendu · nom du
   dossier divergent · fenêtre étendue à 2018 · source == cible · tag non bumpé · garde « racine
   seule » retirée PUIS inversée · carte re-gatée sur la liste · prédicat amputé du bilan · compte
   rendu remonté au-dessus de la liste · zone collante sous la barre d'onglets.

## Ce qu'on assume

- **Trois tests mentaient déjà, et ce lot les a fait tomber** : `majSante_` affirmait dériver les
  20 min de CONFIG en écrivant `20` en dur (son propre commentaire avait prédit qu'il tomberait
  « le jour où les 20 min sont réallouées »), et deux tests de campagne recopiaient le tag
  `c26-08`. Tous trois dérivent désormais de la constante.
- **C28-86 ne demande plus rien au code** : Marc met les deux fichiers illisibles à la poubelle
  lui-même. La mission Carrière convergera d'elle-même quand ils auront disparu.
- **La ligne de Progression de `reanalyse` est absente de l'état** alors que `Suivi.gs` la déclare.
  Diagnostiqué depuis (voir plus bas) et compensé par une ligne de santé dédiée : une campagne
  qu'on rallume sans rien pour la suivre est une campagne qu'on croira finie.

---

## Revue flotte adversariale — 2ᵉ passe (avant merge)

Trois 🔴 trouvés APRÈS la rédaction ci-dessus. Les trois sont corrigés dans ce même lot ; ils sont
consignés ici parce que chacun est un cas d'école d'une leçon déjà écrite au §9.

1. **La campagne descendait tout le sous-arbre de `06`.** `collecterAReanalyser_` est récursive : à
   côté des 328 fichiers à plat, elle ramassait tout ce que C28-90/C28-105 venaient de ranger — y
   compris les dossiers que **Marc** a construits — et les faisait repasser par `planRoutageV2_`,
   qui calcule la cible depuis le SEUL nom. Or les trois gardes qui protègent le déjà-rangé (D8
   cible faible, D9 ancêtre, D10 structure de Marc) vivent dans `decisionConsolidation_`, **pas**
   dans le flux : un document dont le nom n'apprend rien serait reparti **à plat à la racine du
   domaine** — le défaut que la contre-revue de C28-90 avait mesuré (332 des 475) et fermé,
   ré-ouvert par une autre porte. Et le coût annoncé aurait été multiplié par 2 à 3.
   ➜ `CONFIG.REANALYSE_RACINE_SEULE: true`, la descente est conditionnelle.
2. **La carte du compte rendu se démontait au succès complet.** Gatée sur `videsCandidats.length`,
   elle disparaissait à la dernière ligne corbeillée — donc le bilan n'était visible **que s'il
   restait des échecs**. C'était C28-93 déplacé d'un cran. ➜ prédicat pur `carteVidesVisible`.
3. **La zone collante se rendait SOUS la barre d'onglets du téléphone.** ➜ `bottom: calc(var(--barre-basse-h) + env(safe-area-inset-bottom))`.

Plus, sans gravité de garde-fou : le dossier Davila passait de CIBLE à SOURCE **sous le même tag**
(les fichiers déjà déplacés portaient une clé de SUCCÈS et n'auraient jamais été repris) ➜ tag
bumpé `ecoles-archives06` → `…06b` ; pas de marge de démarrage avant le mur (un document LLM lancé
dans la dernière minute est TUÉ, le `finally` ne tourne pas, le budget fuit) ➜ `PILOTE_MARGE_DOC_MS` ;
et six commentaires devenus faux après la fusion des deux nœuds collège/lycée.

**12 mutations jouées, 12 attrapées** — dont la garde « racine seule », qui n'était couverte par
**aucun** test au premier jet : la retirer laissait la suite verte. Son test observe le CHEMIN
(`getFolders` jamais appelé), pas la taille du résultat — un sous-dossier vide rendrait la même
liste (§9, « un mock qui compose son résultat ne distingue pas deux chemins »).

## Ce que ça coûte vraiment, et ce qui reste à trancher

- **Durée : 14 à 21 jours** [Probable]. 8 min/j ÷ **20-30 s par document** — le chiffre MESURÉ du
  projet pour le pipeline complet OCR + Sonnet v2 (`Config.gs`, `RESET_LLM_MAX_PAR_RUN`) — donne 16
  à 24 documents/jour pour 328. Ce n'est pas une campagne de quelques jours ; elle tourne en fond.
  C'est le prix d'un budget prélevé plutôt qu'ajouté, et c'est le bon arbitrage — mais il se dit.
- **La réallocation est neutre au tableau, pas dans la machine.** L'enveloppe reste à 63 min/j,
  mais le donneur (`GMAIL_HISTO`) est **terminé** : il ne consommait plus rien. Le moteur va donc
  réellement consommer **+8 min/j** de quota runtime, sur les ~90 min/j d'Apps Script. Marge
  confortable, mais l'invariant d'enveloppe ne la mesure pas — il somme des PLAFONDS, pas de la
  consommation.
- **Le frein est à 40 $ pour une campagne annoncée à 8,6 $** — 4,6× le besoin. Le frein est un
  filet anti-emballement, pas un budget ; le laisser là n'est pas une erreur. Mais s'il reste à 40
  et que la mesure du coût dérape, rien ne s'arrêtera avant 40 $. **Décision de Marc**, pas la
  mienne : redescendre à ~15 $ le temps de la campagne, ou le laisser à 40.
- **C28-112 est diagnostiqué, et il se répare tout seul avec ce lot.** La ligne manquait à cause
  d'une règle de `pousser` (Journal.gs) : *« finie avant d'avoir eu une ligne → rien à montrer »*.
  C26-08 était marquée terminée (`DriveAI_REANALYSE === 'c26-08'`) et n'avait jamais eu de ligne :
  chaque tick voyait `termine: true` et refusait d'en créer une. Le tag neuf `c28-92` rend
  `termine` faux, donc la ligne NAÎT au prochain tick — avant même le premier document — et ses
  compteurs repartent de zéro (`DriveAI_REANALYSE_BARRE_TAG` purge `_BASE`/`_TRAITES` au changement
  de tag). Aucun code à écrire. En plus, `majSante_` porte une ligne dédiée « **Re-datation de 06** » :
  en attente / en cours avec `N / base` et les minutes du jour / terminée ✅ — donc la campagne est
  suivable dès maintenant, sans attendre sa barre.

---

## Revue flotte adversariale — 3ᵉ passe (code · sécurité · quotas)

Trois agents, lancés en parallèle sur le lot déjà commité. Deux 🔴 de plus, et **cinq mutations
jouées par les agents ont SURVÉCU** — dont deux qui ré-introduisaient un bug que la 2ᵉ passe
prétendait avoir fermé. C'est la leçon du lot : une correction n'existe que si une mutation la fait
tomber, et il faut jouer la mutation SUR LE POINT D'APPEL, pas seulement sur la fonction pure.

### 🔴 1 — La marge de démarrage protégeait le mauvais budget

`PILOTE_MARGE_DOC_MS` était retranchée du sous-budget LOCAL de la campagne (2 min). Or le terme qui
mord dès que l'amont du tick a consommé 2 min est le garde-temps du TICK (`budgetMsRun_()`, 3 min),
qui n'en avait **aucune**. Un document pris à 179 s de tick coûte encore 1 à 3 min : 179 + 180 + les
écritures d'état du `finally` franchissent le **mur DUR de 6 min**, où l'exécution est TUÉE — le
`finally` ne tourne pas, jusqu'à ~4 min sur un budget quotidien de 8 échappent au compteur, et le
MÊME document repart en tête au tick suivant, sans compteur pour l'arrêter. Une protection annoncée
et absente est pire qu'une protection absente : elle clôt la question.
⇒ `estBudgetDepasseDoc` (Main.gs), garde-temps du tick **amputé de la marge**, réservé aux étapes
qui lancent un document LLM complet. Verrouillé par un tripwire d'orchestration + 2 mutations.

Deux corollaires du même endroit :
- **Le reliquat plus petit qu'un document** clampait `murDemarrage` à 0 : la garde devenait
  « elapsed > 0 », fausse au premier appel, et un document démarrait avec quelques secondes de
  budget. ⇒ sortie explicite `if (budgetRun <= PILOTE_MARGE_DOC_MS) return;` avant le `try`.
- **Le RECENSEMENT héritait de la marge LLM** alors qu'il n'est que du comptage Drive. Fenêtre
  amputée ⇒ trois passes incomplètes ⇒ le filet du compte partiel accepte une **base à 0**, écrite
  une fois pour toutes (« 5 / 0 documents »). ⇒ deux murs distincts, comme `Reset.gs`.

### 🔴 2 — La convergence était devenue topologique, et le compteur qui l'aurait dit était effacé

Depuis `RACINE_SEULE`, « terminé » veut dire « plus rien à la racine de `06` ». Mais cette racine
n'est pas drainée que par nous : la **consolidation passe AVANT** dans le tick, avec 24 min/j contre
8, en pure I/O — des dizaines de fichiers/minute contre 16 à 24 par JOUR — et D8 ne protège
explicitement PAS les fichiers à plat (c'est le but d'ADR-0052). Elle emporte donc le stock, classé
sur son NOM et sa **date fausse**, la passe suivante collecte 0, et la campagne écrit « terminée ✅ »
sans avoir rien re-daté : les ~8,6 $ sont dépensés pour rien et le problème d'origine revient intact.
Pire, `finaliserCompteurCampagne_` écrivait alors `TRAITES = BASE` — il **effaçait le seul chiffre**
qui aurait dit « 41 re-datés sur 328 », à l'instant même où il fallait le lire.

⇒ Deux correctifs conjoints, prévenir **et** détecter :
1. **D11** (`decisionConsolidation_`) — la racine d'un domaine EN COURS de re-datation ne se vide
   pas sous la campagne. Borné aux domaines de `REANALYSE_CIBLES`, à la racine seule, et il se lève
   TOUT SEUL à la convergence : c'est un chemin de retour (un état observable), jamais un délai.
   ADR-0052 reprend la main sur `06` dès que la campagne a fini. Échec **ouvert** assumé et testé :
   une lecture de Property qui lève rend `false`, donc le pire cas est ce qui se passait avant ce
   lot — jamais un rangement bloqué à vie par un blip.
2. Le compteur **n'est plus figé à 100 %** : le journal de fin dit `N / M`, et signale l'écart.

### 🟠 3 — La re-datation pouvait DÉTRUIRE une bonne date, définitivement

`reanalyserFichier_` passait `getLastUpdated()` comme date de référence. Quand la passe 2 rend
`date_doc: null` (scan mal OCRisé), `dateNormalisee_` retombe dessus : `2015-06-12_Bulletin_Avila.pdf`
devenait `2026-09-14_…`, **sortait de la fenêtre de scolarité**, retombait à plat — et la clé de
campagne étant inscrite, **plus jamais re-collecté**. La campagne existe pour RÉPARER des dates :
en détruire de bonnes au passage est l'inverse de son but, et les ~89 des 328 qui ne portent pas
`2026` sont exactement la population exposée. ⇒ `dateReferenceReanalyse_` : le préfixe `AAAA-MM[-JJ]`
du nom courant d'abord, Drive en repli, avec garde de plausibilité. Verrouillé **au point d'appel**.

### 🟠 4 — Trois verrous promis qui n'existaient pas (mutations survivantes)

- **Le drapeau STRICT du garde `04`.** `aParentProtege_(f, proteges, true)` : retirer le `true`
  laissait 1297 tests verts, parce que le mock rendait `true` sans lire ses arguments (§9 mot pour
  mot). Sans STRICT, une chaîne d'ancêtres illisible rend « non protégé » au lieu de s'abstenir, et
  `deplacerEtRenommer_` retire le premier parent — qui peut être `04`. ⇒ les DEUX points d'appel
  consignent désormais l'argument.
- **La ligne de Santé ne disait que 2 causes d'arrêt sur 6** : pendant le frein à 40 $, un reset ou
  une panne de plateforme, elle affichait « en cours — 0 / 328 · 0 des 8 min/j ». C'est le mode de
  panne du §1.6 DANS la surface écrite pour le fermer. ⇒ `statutReanalyse_` pure, six causes, une
  assertion par cause. Et le test de santé n'exerçait **jamais** la branche « en cours » : renommer
  `budgetJourReanalyse_` laissait tout vert. ⇒ harnais qui pose les Properties et charge
  `Migration.gs` pour de vrai.
- **Le tripwire de `carteVidesVisible` se contournait par la forme conjonctive**
  (`videsCandidats.length > 0 && carteVidesVisible(…)`) — c'est-à-dire le bug C28-110 réintroduit,
  et la façon dont une prochaine session « nettoiera » l'affichage. Il asserta l'absence d'une forme
  qui n'avait jamais existé dans ce fichier. ⇒ la LIGNE entière est verrouillée, du début à la fin.
  Idem pour l'assertion CSS, qui passait si la règle sortait de la media query — où
  `var(--barre-basse-h)` n'est pas déclarée, la déclaration est jetée, et le bilan repasse sous la
  barre d'onglets.

### 🟡 Le reste, corrigé ici

Recensement racine-seule non testé · `REANALYSE` absent du garde « campagne ACTIVE à budget 0 =
muette » (9 jambes dans la somme, 5 dans le garde) · `GMAIL_HISTO_PRETEES_MIN` non relié au
transfert (un prochain 12 → 10 l'aurait laissé à 8) · un bilan de lot PÉRIMÉ qui survit désormais à
la liste · cinq contrats inter-modules absents de `surface-moteur.test.js` alors que leurs jumeaux
y étaient.

### Ce qui a été vérifié et qui tenait

Zone protégée `04` intacte (aucun chemin de détachement ; collecte bornée au seul `06`, domaine
protégé sauté en défense en profondeur, refus inscrit sous la clé de campagne ⇒ convergence) ·
aucune suppression, aucun scope élargi, aucun secret · enveloppe à 63 min/j exactement, 9ᵉ jambe
dans les TROIS sommes · `finally` qui accumule les ms même sur exception · étape enveloppée d'un
try/catch (l'intake ne peut pas être gelé par elle) · coût en appels Drive : ~5 par tick.

**27 mutations jouées sur l'ensemble du lot, 27 attrapées** — dont 8 qui avaient d'abord survécu et
ont exigé d'écrire le test manquant.
