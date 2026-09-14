# ADR-0056 — Le hub voit ce que le moteur FAIT, et un nom de fichier quitte le compte de Marc

- **Statut** : accepté — arbitrage explicite de Marc, 14/09/2026 : « Oui, avec un ADR qui l'assume »
- **Portée** : `api/hub/*` (broker Vercel) et `majResumeHub_` (moteur). Aucun autre chemin.
- **Contrat** : consomme `hub-contract` **v1.3.0** (`expectedMaxAgeSec`, `details`, `primary`)
- **Révise** : une **glose** de l'ADR-0007, pas l'ADR-0007 — voir §3, qui commence par corriger
  ce que j'ai d'abord cru.

## Contexte

Marc, 14/09/2026 : « les données ne sont pas à jour, le hub est assez inutile pour le moment, je
veux retravailler à fond et que tout marche tout le temps ».

Le widget DriveAI publiait **trois nombres** : classés sur 7 jours, file de revue, erreurs sur
7 jours. En régime normal les deux derniers valent **0** — c'est le but de l'app. Le widget
affichait donc, l'essentiel du temps, un chiffre hebdomadaire et deux zéros : rien qui bouge, rien
qui dise ce que le moteur est en train de faire. Pendant ce temps, l'onglet `Progression` du moteur
porte l'avancement d'une quinzaine de campagnes de fond, avec statut, reste à faire et estimation
de fin — visible dans l'app DriveAI, invisible au hub.

Deux choses manquaient donc, et ce ne sont pas les mêmes :

1. **De quoi juger la fraîcheur.** Le hub sait mesurer un âge, mais il n'a aucune connaissance du
   rythme des apps — c'est voulu (principe n°1 de Hubperso). Sans `expectedMaxAgeSec`, DriveAI
   était dans l'état `age-connu-non-juge` de l'ADR-0003 de Hubperso : « je peux afficher l'âge, je
   ne peux pas dire s'il est normal ».
2. **De quoi voir le travail.** Un moteur de classement dont le hub ne montre que des compteurs à
   zéro ressemble à un moteur arrêté.

## Décision

### 1. `expectedMaxAgeSec` est DÉRIVÉ, jamais choisi

`AGE_MAX_ATTENDU_SEC` = `SEUIL_MUET_MS` + `CACHE_TTL_MS` = 45 min + 5 min = **3 000 s**.

C'est le point d'architecture de cet ADR. `SEUIL_MUET_MS` est déjà le seuil au-delà duquel DriveAI
se déclare elle-même `degraded` ; `CACHE_TTL_MS` s'y ajoute parce qu'un résumé servi depuis le
cache du broker porte un `dataAsOf` vieilli d'autant.

Un nombre indépendant aurait produit la pire panne possible pour un tableau de bord : **le hub
affichant « donnée figée » pendant que le widget de la même app affiche `ok`**. Deux diagnostics
opposés sur la même réalité, c'est la façon la plus sûre d'apprendre à n'en croire aucun. Dérivé,
l'écart est impossible par construction — un rajustement du seuil déplace les deux ensemble. Un
test échoue si la dérivation est rompue.

**Corollaire tenu dans le même changement** : le commentaire de `SEUIL_MUET_MS` disait
« déclencheur à 30 min + marge ». Les deux moitiés étaient fausses — le déclencheur du tick est à
**5 min** (`CONFIG.TICK_MINUTES`), et c'est le **chien de garde** qui est à 30
(`CONFIG.WATCHDOG_MINUTES`). La valeur de 45 min est bien calibrée, sa raison écrite désignait le
mauvais mécanisme. Une justification fausse est pire qu'aucune : la prochaine session l'aurait
« corrigée » vers 10 min pour coller au déclencheur, et DriveAI serait passée en `degraded` à
chaque tick manqué.

### 2. L'avancement des campagnes passe par l'onglet `Progression`, pas par les Properties

`missionsPourHub_` (PURE, testée) lit les lignes **brutes** de l'onglet, garde les lignes de
`type: 'campagne'`, met les actives avant les terminées, et **borne à 6**.

**Pourquoi l'onglet et pas les compteurs bruts.** Les compteurs vivent bien dans les Properties
(`chargerEtatMissions_`), mais le **statut lisible** (« en pause (frein budget) »), le reste à
faire et l'estimation de fin sont calculés par `lignesProgression_` — avec, dedans, tout ce que
cette fonction a appris à ne PAS dire : pas d'horizon sur une campagne en pause, pas de date de fin
sur une mission convergée à reliquat (retour Marc du 20/08 : « je vois encore des missions… Fin
estimée : ~92 j »). Recalculer ces phrases côté hub donnerait un **second jugement** sur la même
réalité, et c'est le premier qui divergerait sans que personne ne le voie. L'onglet est réécrit en
entier à chaque tick, **juste avant** `majResumeHub_` dans le `finally` : le relire publie exactement
ce que Marc voit dans l'app.

**Côté FRAIS du partage cher/frais de C28-59**, donc rafraîchi à chaque tick. Une lecture bornée de
~50 lignes n'a rien de commun avec la relecture de l'Index ENTIER que le throttle de 15 min protège
— et c'est justement ce que Marc veut voir BOUGER.

**Borné à 6 et pas à 8** : le contrat plafonne une section de détail à 8 lignes, et un dépassement
fait **rejeter le résumé entier** — le hub afficherait « réponse invalide », c'est-à-dire accuserait
DriveAI d'une panne qu'elle n'a pas. Deux lignes de marge rendent ce rejet impossible. Ce qui est
tronqué n'est pas tu : `missionsOmises` porte le compte et le titre de la section l'affiche.

### 3. Un nom de fichier sort du compte Google de Marc — et il ne sort que par `details`

**Ce que j'ai d'abord cru, et qui est faux.** J'ai présenté ceci comme une révision de l'ADR-0007.
Ce n'en est pas une : son §2 **liste explicitement** `Fichier` parmi les métadonnées légitimes de
l'Index, et décrit le Journal comme contenant « des noms de fichiers ». L'ADR-0007 n'a jamais
interdit les noms de fichiers. Ce qui l'interdisait était une **glose plus stricte**, écrite dans
des commentaires de code (`api/hub/_engineState.ts` : « jamais un nom de fichier ni un contenu ») et
reprise dans le `CLAUDE.md`. Les deux sont corrigés ici.

**Le fait NEUF, lui, est réel** : jusqu'à aujourd'hui aucun nom de fichier ne **sortait** du compte
Google de Marc. L'ADR-0007 raisonne sur ce que l'**état** persiste, dans un Drive qui est le sien.
Publier un nom au hub le fait voyager moteur → Vercel → hubperso.com. C'est cette frontière qui est
franchie, et c'est elle que cet ADR assume — comme l'ADR-0042 §3 l'a fait pour le texte des
documents vers claude.ai.

**Le garde-fou reçu en échange**, et il est précis : **le nom voyage dans `details`, JAMAIS dans
`metrics`.**

Hubperso **persiste** les métriques : sa table `releves` (Neon) archive `metriques` en JSONB, avec
90 jours de rétention, à chaque relevé de son horloge. Elle ne stocke **pas** `details`. Un nom placé
en métrique serait donc recopié dans une base externe toutes les 30 minutes — il ne ferait pas que
sortir du compte de Marc, il s'y **installerait**. Dans `details` il transite, s'affiche, et
disparaît. `app/test/hub-summary.test.ts` verrouille la contrainte : le nom doit être **absent** de
`metrics`, `alerts`, `actions` et `usage`, et **présent** dans `details`.

**Trois autres bornes, chacune pour une raison nommée** :

- **Le nom et sa date ne se publient qu'ENSEMBLE.** Un nom sans date se lirait « à l'instant »
  alors qu'il peut avoir douze jours — et c'est précisément ce que ce champ existe pour dire. Le
  couple est vérifié à l'entrée du broker, pas laissé à la charge du rendu.
- **L'âge est RELATIF** (« il y a 22 min »), jamais une date absolue. Le broker tourne sur Vercel
  en UTC et `Intl` prendrait le fuseau de la MACHINE : le hub serait faux de 4 ou 5 h selon la
  saison, sans aucun signe extérieur. C'est le garde-fou `FUSEAU` de Hubperso, vu du côté
  producteur. Un écart n'a pas de fuseau.
- **Le nom est tronqué à 60 caractères, avec un signe visible.** Le contrat ne borne pas la valeur
  texte d'une ligne de détail : la charge est au producteur.

### 4. Le dernier document classé se cherche sur TOUT l'Index

Pas sur la fenêtre de 7 jours des compteurs. « Rien de classé depuis douze jours » est une
information — « aucun document classé » serait faux, et c'est exactement le genre de vide qui se lit
comme une panne. Une ligne d'Index sans colonne `Fichier` (il en existe, écrites par d'anciennes
campagnes) ne remplace jamais un nom connu, même si elle est plus récente.

### 5. Un garde de TAILLE sur la Property, qui largue l'optionnel et le dit

`DriveAI_HUB_SUMMARY` est une Script Property : Apps Script refuse au-delà de ~9 Ko par valeur, et
un registre voisin de ce même moteur est déjà à **8 377 octets**. Un `setProperty` refusé **ne casse
pas le tick** — il laisse le hub servir éternellement le dernier résumé écrit, sans que rien ne soit
rouge. Exactement la panne silencieuse que tout le reste de ce chemin existe pour supprimer.

Au-delà de `HUB_SUMMARY_MAX_OCTETS` (8 000), `majResumeHub_` republie donc **sans** l'avancement des
campagnes — le plus gros poste — plutôt que de risquer le résumé entier, et **le journalise** : une
dégradation silencieuse n'est pas une parade, c'est le défaut qu'on corrige.

Mesuré : le pire résumé possible au plafond normal fait **2 870 octets**. Un test l'affirme, pour
que le garde reste un filet et non un passage.

## Trade-offs

- **Le hub ne rend pas encore `details` ni `primary`.** Le contrat les porte (v1.3.0), Hubperso est
  re-pinné, mais son rendu est le lot suivant. `expectedMaxAgeSec` est en revanche **déjà** lu
  (`lib/gel.ts`) : DriveAI quitte l'état `age-connu-non-juge` dès ce déploiement. C'est un choix
  d'ordre assumé — publier d'abord donne au rendu de la vraie donnée à afficher plutôt que des
  fixtures.
- **Deux constantes en miroir** (`HUB_MISSIONS_MAX` en `.gs`, `MISSIONS_MAX` en `.ts`). `api/` est
  zéro-dépendance par construction et ne lit pas de `.gs` — même raison que la liste blanche
  `REJOUABLES` de `api/mcp/index.ts`. Le moteur borne déjà ; la borne du broker protège d'un moteur
  en avance d'un déploiement, ou compromis.
- **Une lecture de plus par tick** (l'onglet Progression, ≤ 60 × 13 cellules). Assumée : `majProgressions_`
  lit et écrit déjà ce même onglet au même tick, et le quota Apps Script se joue sur la relecture de
  l'Index non borné, pas sur 50 lignes.
- **Un nom de fichier s'affiche sur hubperso.com**, derrière le login Google du hub. C'est la
  contrepartie, elle est nommée, et Marc l'a tranchée explicitement.

## Alternatives rejetées

- **Ne rien publier de plus et attendre le rendu du hub.** Rejeté : c'est ce qui donnait « le hub
  est assez inutile ». Le rendu a besoin de données pour être jugé sur autre chose que des fixtures.
- **Un `expectedMaxAgeSec` calé sur le tick (5 min) ou sur le cache (5 min).** Le plus « frais » en
  apparence, et le pire en pratique : le hub aurait crié « figée » à chaque tick étalé, pendant que
  DriveAI se déclare `ok`. Une alerte permanente n'est pas une alerte.
- **Un seuil côté hub plutôt que côté app.** Interdit par le principe n°1 de Hubperso, et déjà
  rejeté par son ADR-0003 : ce serait de la connaissance d'app codée en dur dans un tableau de bord
  générique.
- **Recalculer statut et estimation dans le broker** à partir des compteurs bruts. Rejeté : deux
  jugements sur la même réalité, dont un seul a appris à se taire sur les pauses.
- **Le nom du dernier classé en MÉTRIQUE** (`format: 'text'`). C'était le plus simple à afficher, et
  c'est ce qui aurait installé les noms de documents de Marc dans une base Neon pour 90 jours. C'est
  le refus qui donne à la décision 3 son contenu : sans lui, « on publie le nom » n'aurait été
  qu'une permission.
- **Publier les 8 missions de curation par leur tag** (`vehicule`, `annees02`…) plutôt que par le
  libellé du registre. Rejeté : deux noms pour la même chose, c'est le piège des deux
  canonicaliseurs qui divergent — déjà payé sur `06` en septembre.
