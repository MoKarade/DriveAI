# ADR-0050 — Un fil LU sort de la boîte : ⏰ et « À vérifier » deviennent des libellés, plus des ancres

- **Statut** : accepté (2026-09-09)
- **Contexte** : Marc, 2026-09-09 : « mes mails sont toujours pas triés automatiquement et archivés
  automatiquement » — deux jours après ADR-0049, qui avait rétabli l'archivage pendant une panne d'agenda
- **Révise** : ADR-0010 §3 (« un fil ⏰ n'est jamais archivé — la boîte de Marc sert de todo »),
  ADR-0012 (« À vérifier » jamais archivé), ADR-0022 (nettoyage profond : « ⏰ / À vérifier restent en boîte »)
- **Complète** : ADR-0043 / ADR-0049 (mode dégradé inchangé), leçon §9 « verdict négatif keyé sous version »

## 1. Problème

Le tri POSE ses libellés ; l'archivage, lui, ne part presque jamais. Comptage exhaustif des 50 premiers
fils de la boîte (MCP Gmail, 09/09 13:20 UTC) : **21 non lus, 14 ⏰ « À traiter », 17 « À vérifier »,
3 ⚠️ Suspect**. Le seul cas que la règle archive — lu ET catégorisé ET sans ⏰ — est quasi vide.

Deux aggravations structurelles :

1. **⏰ est un cliquet.** Le moteur n'a pas le droit de retirer un libellé (§1.3, verrou CI) et
   `important = important| ∨ dejaPoses[⏰]` : un fil marqué ⏰ une fois l'est à vie, donc jamais archivé,
   même lu, même traité. Les conversations avec un hôte Airbnb en font partie (« Bonjour Marc, comment
   allez-vous ? » attend une réponse, le mini-check dit vrai).
2. **« À vérifier » attrape par construction les mails que Marc s'envoie.** Le message de référence de
   la catégorisation est « le plus récent qui ne vient PAS de Marc » — un fil de Marc à Marc n'en a pas,
   donc pas de catégorie, donc « À vérifier », donc jamais archivé.

Ce n'est pas un bug : chaque règle fait exactement ce qu'elle dit. C'est la **population** qui ne
correspond plus : les exclusions couvrent ~100 % du flux réel. Même famille que la leçon « garde-fou
étroit, calibré sur du réel » — une règle juste sur le papier, qui ne laisse rien passer en vrai.

## 2. Décisions de Marc (2026-09-09, questions groupées)

1. Fil ⏰ lu → **« Tout archiver sauf les mails non lus »** (réponse libre, plus large que l'option proposée).
2. Fil « À vérifier » lu → **archiver**.
3. Non lus → **inchangé** : jamais archivés, sauf une promo/newsletter reconnue de façon DÉTERMINISTE.
4. Vieux stock (> 30 j, hors fenêtre du tri vivant) → **relancer une passe**.

Point tranché par prudence, non contredit par Marc (proposer ≠ faire) : **⚠️ Suspect reste en boîte**.
Un avertissement d'hameçonnage caché ne sert à rien ; ce sont 3 fils.

## 3. La règle (`decisionTri_`, pure)

| Cas | Libellés | Archivé ? |
|---|---|---|
| suspect | ⚠️ seul | non (inchangé) |
| catégorie connue | catégorie (+ ⏰ si important) | **lu** — ⏰ ne bloque plus |
| catégorie inconnue | « À vérifier » (+ ⏰ si important) | **lu** — nouveau |
| promo déterministe, catégorisée, hors zone protégée | catégorie | oui même non lue (inchangé) |
| analyse indisponible (ADR-0043) | libellés | non (inchangé) |

Deux précisions :

- **⏰ est posé aussi sur un fil sans catégorie.** Jusqu'ici « À vérifier » sortait tôt, sans ⏰.
  Maintenant que ces fils s'archivent, un fil important sans catégorie partirait SANS son marqueur —
  ⏰ est le seul signal qui survit à l'archivage, il doit y être.
- **Mode dégradé inchangé.** Sans verdict d'analyse, `important` est inconnu, ⏰ ne peut pas être posé :
  archiver perdrait le todo. On attend (rare, auto-réparé, ADR-0049).

Ce que ça change pour Marc : **la boîte = ses mails non lus** ; **le libellé ⏰ = sa liste de tâches**
(un clic dans Gmail, les non-lus y ressortent). Un nouveau message sur un fil archivé le ramène en boîte.

## 4. Rétroactivité : la version des règles dans la clé

Sans rien d'autre, ce changement ne toucherait AUCUN des ~90 fils déjà en boîte : leur clé d'idempotence
`tri|<fil>|<ts>|lu` est posée, ils rendent `'deja'` à vie. C'est le piège décrit en §9 (« une clé posée
sur un verdict de règle le fige à vie ; la version de la table fait partie de l'état »).

- **Clé** : `tri|<fil>|<ts>|lu` → `tri|<fil>|<ts>|lu|<CONFIG.TRI_REGLES_VERSION>` (`r2`). Les anciennes
  clés (sans version, ou `|deg`) deviennent invisibles ⇒ chaque fil de la fenêtre 30 j est réévalué UNE
  fois sous les règles courantes, puis sa clé versionnée le fige comme avant. Exception voulue :
  `tri-abandon|<fil>|<ts>` (fil ILLISIBLE après `QUARANTAINE_MAX` essais) n'est pas versionnée — un échec
  de LECTURE n'est pas un verdict de RÈGLE ; un nouveau message lui redonne sa chance, comme avant. `purgerClesTriIndex_`
  (« pas suspect ») travaille par préfixe `tri|<fil>|` : inchangé.
- **Nettoyage profond** (`nettoyerBoiteHistorique_`) : ré-armé quand `DriveAI_TRI_BOITE_VERSION` ≠ version —
  marqueur « terminé », ancre, offset et compteurs de passes effacés, version posée. L'ANCRE doit être
  re-posée : l'ancienne (juillet) laisserait un trou entre elle et −30 j, couvert par aucun des deux scans.
- **Coût** : une relecture par fil (libellés + messages), catégorie par la table apprise (LLM seulement pour
  un expéditeur inconnu), écritures bornées par `TRI_MAX_FILS_PAR_RUN` = 30 et les plafonds de 150 fils/jour
  (cyclique, nettoyage). Vitesse réelle (revue apps-script-quota) : c'est le scan AVANT qui porte la rafale
  et il n'a pas de plafond quotidien — pendant la réévaluation aucune page n'est « à jour », il descend
  page après page à 30 écritures par tick ⇒ la fenêtre 30 j (~90 fils) en **3 ticks, ~15 min** ; le stock
  > 30 j suit au nettoyage profond, à 150 fils lus par jour. Estimation LLM < 0,20 $ [Supposition]. Frein §2.6
  inchangé. Réversible : un fil archivé garde tous ses libellés.

## 5. Risques

- **Perte du réflexe « boîte = todo ».** C'est le choix de Marc ; le libellé ⏰ le remplace. Si un fil ⏰
  archivé n'est plus vu, revenir en arrière = bumper la version avec `archiver = !important` — une ligne.
- **Rafale** : jusqu'à 30 archivages par tick le premier jour. Réversible ; aucune suppression (§1.2).
- **Suspect** : inchangé, 3 fils. Marc peut demander l'inverse.
- **Version oubliée** : un futur changement de règle sans bump ne se propagerait pas — le commentaire de
  `TRI_REGLES_VERSION` le dit, et le test « ancienne clé ⇒ réévalué » verrouille le mécanisme.

## 6. Tests

`test/tri-gmail.test.js` : `decisionTri_` sur chaque ligne du tableau §3 (⏰ lu archivé, « À vérifier » lu
archivé / non lu reste, ⏰ ajouté sans catégorie, suspect reste, dégradé reste, promo sans catégorie non
lue reste) ; clé versionnée (ancienne clé présente ⇒ fil RE-TRIÉ et clé versionnée posée ; clé versionnée
présente ⇒ `'deja'`) ; ré-armement du nettoyage profond (version absente/différente ⇒ marqueur, ancre,
offset, passes effacés + version posée ; version égale ⇒ « terminé » respecté, zéro recherche).

## 7. Mutations

Exécutées sur `test/tri-gmail.test.js` (62 tests), copie de sauvegarde restaurée et relue après chaque mutation :

| # | Mutation | Tests qui tombent |
|---|---|---|
| M1 | clé sans version (`+ '\|' + TRI_REGLES_VERSION` retiré) | 12 |
| M2 | ⏰ bloque encore l'archivage (`entierementLu && !important`) | 4 |
| M3 | « À vérifier » jamais archivé (retour tôt rétabli) | 3 |
| M4 | ⏰ non posé sans catégorie | 1 |
| M5 | ré-armement sans effacer l'ANCRE | 1 |
| M6 | ré-armement jamais déclenché (`if (true) return`) | 1 |
| M7 | promo sans catégorie archivée (garde `f.categorie` retirée) | 1 |
| M8 | mode dégradé archive quand même | 2 |
| M9 | ré-armement n'écrit pas la version (boucle à chaque tick) | 1 |
| M10 | ré-armement n'efface pas `PASSES_PROPRES` (revue flotte : l'assertion initiale était tautologique, la fin de passe l'effaçait de toute façon — désormais prouvé sur les appels faits AVANT la première recherche) | 1 |

10/10 attrapées.
