# ADR-0022 — Fiabilité des intentions & nettoyage profond de la boîte

- **Statut** : Accepté (C28-22, 2026-07-15) — **révisé C28-48, 2026-08-14** (retour de panne
  automatique par sonde légère + diagnostic lisible ; cf. section « Révision C28-48 »)
- **Décideurs** : Marc, Claude (architecte NotebookLM)
- **Contexte** : trois problèmes vus en prod (retour Marc « anciens mails pas archivés »,
  diagnostic par export de la Sheet) qui partagent une cause racine : des garde-fous
  incomplets de bout-en-bout. L'idempotence a protégé les données, au prix d'un
  engorgement silencieux du quota Gmail.

## Problèmes

1. **Boucle 403 Tasks/Calendar → famine de quota.** L'API Google Tasks n'était pas activée
   dans le projet GCP (403 « has not been used » depuis le 07/07). `creerTache_` attrapait
   l'erreur et renvoyait `''` ; `creerIntentionIdempotente_` voyait un `'echec'`, ne posait
   pas la clé `intention|<messageId>`, et le message était **re-analysé + re-tenté à CHAQUE
   tick à l'infini** — brûlant le quota Gmail (79 erreurs le 14/07 avant 9h), qui re-mourait
   en quelques secondes après chaque rétablissement.
2. **Arnaques transformées en tâches.** Le tick exécute `traiterIntentionsMail_` AVANT
   `trierFilsGmail_` : les gardes anti-phishing (`heuristiquePhishing_`, promo déterministe)
   ne sont consultées qu'au TRI. Des arnaques « payer 10 USD à Google Cloud Compliance »
   contournaient donc la garde pour devenir des tâches « à payer ».
3. **Trou de périmètre > 30 j.** `scanAvantTri_`/`scanCycliqueTri_` (TRI_REQUETE = `newer_than:30d
   in:inbox`) et `scanArriereTri_` (ancré sur `after:<ancre−31j>`) ne couvrent que ~1 mois.
   Tout mail LU de plus de 30 jours restait dans la boîte à vie.

## Décisions

1. **Panne de configuration d'API (permanente).** Une erreur 403 « API not enabled » /
   « accessNotConfigured » / « SERVICE_DISABLED » sur Tasks/Calendar est une panne de
   PLATEFORME de CONFIG (pas imputable au mail) : `creerTache_`/`creerEvenement_` la
   **lèvent** (au lieu de renvoyer `''`) ; `creerIntentionIdempotente_` la reconnaît
   (`signalerPanneConfigApi_`), pose `DriveAI_PANNE_CONFIG_API` (suspension 24 h persistée)
   et journalise UNE fois. `traiterIntentionsMail_` se suspend tant que la panne est fraîche
   — plus aucun scan Gmail en pure perte (patron panne de compte LLM/quota Gmail, R2/C28-15).
2. **Tolérance aux échecs TRANSITOIRES (3-strikes).** Une création en échec NON-config (500,
   429 après retry, 400…) est comptée (`api-intention|<messageId>`, compteur d'échecs partagé) et,
   après `QUARANTAINE_MAX` (3) essais, l'intention est **abandonnée** : `creerIntentionIdempotente_`
   renvoie `'deja-faite'` pour que le message soit enfin marqué traité et libère le pipeline
   (fini la re-analyse infinie qui drainait le quota — leçon « échec sans marquage =
   re-tentative infinie »). L'abandon est tracé **une seule fois** (au franchissement du seuil,
   `essais === QUARANTAINE_MAX`, comme la campagne historique). **Le compteur est clé sur le
   `messageId` SEUL**, jamais sur le contenu (titre/date/heure du LLM) : le titre peut fluctuer
   d'un run à l'autre (Sonnet 2 passes) et une clé par contenu ne s'accumulerait jamais →
   non-convergence (le compteur reviendrait à 1 à chaque tick, le mail re-tenté à vie).
   **Compromis assumé (sémantique PAR MESSAGE)** : le compteur est partagé entre toutes les
   intentions du message (une incrémentation par appel). Un message à ≥ 3 intentions frappées par
   une panne transitoire brève peut voir sa 3ᵉ intention abandonnée dès le 1er tick — une intention
   légitime rare peut être perdue. Accepté : aucune clé stable PAR intention n'existe (titre ET
   ordre fluctuent) ; l'alternative rouvre la non-convergence. Convergent, sans fuite ni drain quota.
3. **Pré-filtre suspect (défense en profondeur).** `heuristiquePhishing_` (déterministe,
   gratuite) et le chemin dangereux « promo déterministe non lue » sont évalués DANS
   `traiterMessagePourIntentions_`, avant le mini-check LLM. Un mail suspect/dangereux est
   marqué `intention-ecartee` et ne produit JAMAIS de tâche/RDV — ni ne coûte d'appel LLM.
   **Limite assumée** : `heuristiquePhishing_` est une heuristique de MOTS-CLÉS/motifs, pas une
   garantie — une arnaque formulée d'une façon nouvelle (hors motifs connus) peut passer ce filtre.
   C'est de la défense en profondeur, pas un rempart unique : le signal `suspect` du tri
   (`decisionSuspect_`, confiance apprise) et la garde zone protégée restent les filets en aval.
   Élargir la couverture = enrichir les motifs de `heuristiquePhishing_` (re-tester sur du réel),
   jamais durcir le mini-check au point d'écarter du courrier légitime.
4. **Nettoyage profond de la boîte (`nettoyerBoiteHistorique_`).** Campagne de fond, requête
   FIGÉE `in:inbox before:<ancre−29 j>` (ancre absolue posée une fois ; **−29 j** volontaire : un
   jour de chevauchement idempotent avec la fenêtre du tri vivant `newer_than:30d`, pour ne
   laisser AUCUN mail dans l'angle mort entre les deux scans), offset persistant,
   DEUX passes propres consécutives pour converger, plafond quotidien en FILS
   (`TRI_BOITE_MAX_FILS_JOUR` 150) + budget/run — passe par `trierFil_` (libellés existants +
   archivage réversible seulement). Priorité STRICTE au flux vivant (tourne en DERNIER du tri).

## Révision C28-48 (2026-08-14) — la suspension se lève TOUTE SEULE, et elle dit POURQUOI

La décision 1 ci-dessus a tenu son objectif (plus de famine de quota), mais elle a montré deux
défauts en prod le 14/08, l'API **Calendar** n'étant pas activée dans le projet GCP :

1. **Le retour de panne était un DÉLAI, pas un signal.** La re-sonde n'arrivait qu'au bout de
   24 h, et elle passait par le chemin COÛTEUX (scan Gmail + appels LLM jusqu'à la première
   création). Résultat : Marc pouvait activer l'API à 08:00 et DriveAI ne le voyait pas avant le
   lendemain — inacceptable au regard de sa contrainte permanente (« je ne veux jamais avoir à
   lancer quoi que ce soit à la main »).
2. **Le diagnostic était illisible.** L'erreur conservée était le corps 403 BRUT, un JSON
   INDENTÉ : une fois tronqué pour l'affichage (cellule d'erreur de `Progression`, 40 caractères)
   il ne restait que `config-api Calendar : {    error : {` — donc impossible de distinguer
   « API pas activée » de « API activée dans un AUTRE projet GCP que celui du script ».

**Décisions.**

1. **Sonde LÉGÈRE** (`sonderApiConfig_`) : pendant la suspension, au plus 1 fois par
   `CONFIG.PANNE_CONFIG_SONDE_MS` (15 min), deux `GET` REST sur un identifiant **volontairement
   INEXISTANT** (`.../tasks/@default/tasks/driveaisondeconfigapi`,
   `.../calendars/primary/events/driveaisondeconfigapi`). Aucune donnée de Marc n'est lue (la
   réponse attendue est un 404), rien n'est énuméré, rien n'est écrit : le garde-fou « création
   uniquement, jamais les éléments EXISTANTS de Marc » reste entier, et **aucun scope n'est
   ajouté** (`tasks` et `calendar.events` sont déjà déclarés — pas de ré-autorisation, donc pas
   de gel du moteur). Verdict tri-état (`verdictSondeApi_`, PURE) construit en **ALLOWLIST** et
   non par un `else` optimiste (revue quotas) : 403 portant la signature « non activée » ⇒
   `desactivee` ; **404 ou 2xx** ⇒ `active` (404 est la réponse NOMINALE de la sonde) ; **tout le
   reste** — 400, 401, 403 de droits, 429, 5xx, exception ⇒ `indetermine`. La raison de cette
   asymétrie : `active` est le SEUL verdict qui rouvre `traiterIntentionsMail_`, c'est-à-dire un
   scan Gmail + jusqu'à `INTENTIONS_MAX_PAR_RUN` analyses LLM — exactement la boucle que la
   décision 1 a été écrite pour arrêter. Se tromper vers `active` la rejoue ~96×/jour au lieu
   d'1×/24 h ; se tromper vers `indetermine` ne coûte que l'attente d'avant C28-48. La direction
   chère exige donc une **preuve positive**. **Échec fermé** : seul `active` sur les DEUX API lève
   la suspension. Les 24 h restent la borne extérieure.
   Filets ajoutés par la revue : (a) **garde-temps DANS la boucle** de sonde
   (`PANNE_CONFIG_SONDE_MAX_MS` = 20 s) — `UrlFetchApp` n'accepte AUCUN timeout en Apps Script et
   la sonde tourne en tête de tick, deux endpoints qui pendent mangeraient la marge budget → mur
   de 6 min. ⚠️ Ce seuil borne le **cumul entre appels**, pas un appel : le 1er fetch n'est pas
   borné, donc le pire cas réel vaut 20 s + la durée d'UN appel (~60 s) ≈ **80 s** — il supprime le
   cas « 2 × 60 s », c'est son but, mais on ne raisonne pas dessus comme sur un timeout de 20 s ;
   (b) **pas d'anti-boucle ⇒ pas de sonde** : si l'horodatage `DriveAI_PANNE_CONFIG_SONDE` n'a pas
   pu être écrit (Properties en panne), on ne sonde pas du tout, sans quoi la sonde repartirait à
   chaque tick précisément pendant la panne du magasin d'état ; (c) l'horloge de budget du tick
   (`var debut`) est **remontée avant** les chargeurs de panne, pour que le temps de la sonde soit
   compté et visible dans la trace de durée ; (d) une sonde qui **CONFIRME** le refus rafraîchit
   `DriveAI_PANNE_CONFIG_API` — sans quoi la fenêtre de 24 h expirait, l'état était effacé comme
   « périmé », la sonde (qui n'existe que pendant une panne) s'éteignait et `Santé` repassait au
   vert alors que la sonde venait de prouver le contraire ; la suspension vit désormais tant que
   la sonde confirme et meurt quand elle infirme ; (e) le **verdict de la dernière sonde** est
   persisté (`DriveAI_PANNE_CONFIG_SONDE_ETAT`) et affiché : sous l'allowlist, une sonde qui ne
   conclut jamais (400 systématique si Google resserrait la validation de l'identifiant sondé)
   rendrait la reprise inopérante à vie et SANS TRACE.

   **Le préfixe canonique fait foi — ne jamais re-dériver un verdict déjà rendu.** Régression
   trouvée en revue avant merge : `creerTache_`/`creerEvenement_` testent la signature sur le corps
   403 **brut**, puis lèvent `'config-api <API> : ' + messageErreurGoogle_(corps)` ; or deux des
   quatre signatures (`accessNotConfigured`, `SERVICE_DISABLED`) vivent dans `error.errors[].reason`
   / `error.status`, **pas** dans `error.message`. `signalerPanneConfigApi_`, qui re-testait la
   signature sur le message EXTRAIT, rendait donc `false` sur un 403 « Access Not Configured »
   pourtant reconnu en amont : aucune suspension posée, le mail re-analysé à chaque tick (l'incident
   de la décision 1 de retour) et la sonde jamais armée — panne silencieuse et conditionnelle. Le
   préfixe `config-api <API> : ` suffit désormais à reconnaître le verdict.
   *Limite assumée, à ne pas surinterpréter :* l'« échec fermé » couvre la **levée** de la
   suspension, pas son **chargement** — un blip de `PropertiesService` fait lire `t = 0`, donc
   aucune suspension, donc retour au chemin coûteux (comportement préexistant, non introduit ici).
2. **Message EXPLOITABLE** (`messageErreurGoogle_`, PURE) : on conserve `error.message`, qui
   nomme le **numéro de projet GCP** et l'URL d'activation, plutôt que le JSON brut. Il est
   persisté (`DriveAI_PANNE_CONFIG_MSG`, borné 300 caractères, sur une ligne) et affiché dans
   l'onglet **Santé** (`texteSanteConfigApi_`, PURE) : « ⚠️ NON ACTIVÉE dans le projet GCP …
   re-sonde automatique toutes les 15 min · <message> ». L'état d'observabilité applique
   EXACTEMENT la même règle de fenêtre que la décision (`etatPanneConfigApi_`), et l'état PÉRIMÉ
   est effacé — un onglet Santé qui annoncerait une panne finie serait pire que rien.
   **Pas d'affirmation sans preuve (no-fake-data)** : hors panne, la ligne dit « ✅ aucune panne
   détectée », et ne devient « ✅ actives (sondées le JJ/MM HH:MM) » que si une sonde POSITIVE l'a
   réellement établi (`DriveAI_PANNE_CONFIG_OK`). Sans ça, l'expiration des 24 h effaçait l'état
   et affichait « opérationnelles » alors que rien ne l'avait vérifié — et si aucun mail
   actionnable ne repassait, le vert restait indéfiniment sur une API désactivée. La preuve
   positive est elle-même **périssable** (ignorée au-delà de la fenêtre de re-sonde) et **effacée**
   dès qu'une panne est constatée : sinon un « sondées le … » vieux de plusieurs semaines
   reverdirait l'onglet pendant une panne toute neuve.
3. **Filtre de PROVENANCE sur le message persisté** (ADR-0007). `signalerPanneConfigApi_` reçoit
   une exception levée depuis un `try` qui enveloppe TOUTE la création d'intention : un futur
   `throw` ajouté là pourrait porter le titre d'un mail. Seul un message au préfixe attendu
   (`config-api <API> : …`) est conservé ; sinon on dégrade vers un libellé générique.

**Coût.** Zéro appel réseau quand il n'y a pas de panne (sortie sur la première Property lue).
Pendant une panne : 2 requêtes par sonde, au plus 1 sonde/13 min ⇒ ~220 `UrlFetch`/jour sur un
quota de 20 000 (≈ 1 %) et ~1 à 3 min de runtime sur les ~90 min/jour — contre un scan Gmail et
des appels LLM pour l'ancienne re-sonde. 13 min et non 15 : le tick fait 5 min, une fenêtre de
15 min pile ne retombe sur le 3ᵉ tick que si le déclencheur ne dérive pas.

**Verrou.** L'exception au garde-fou « création uniquement » est livrée ATOMIQUEMENT : ADR (ici) +
en-têtes de `Tasks.gs`/`Calendar.gs` + `docs/ARCHITECTURE.md` + **`test/surface-tasks-calendar.test.js`**
(aucune URL Tasks/Calendar inattendue ; aucun `delete`/`patch`/`put` ; le SEUL `get` est celui de
la sonde ; `SONDE_CONFIG_ID` doit rester un littéral simple — aucune interpolation ne peut le
faire pointer sur un élément RÉEL de Marc ; en-têtes ⇄ code vérifiés dans les deux sens). Prouvé
par mutation : réintroduire un `method: 'delete'` fait échouer le test.

## Garde-fous (§2)

- **§2.3 moindre privilège Gmail** : aucune nouvelle mutation — le deep clean ne fait
  qu'appeler `trierFil_` (libellé existant + archivage réversible), aucune création/retrait
  de libellé, aucune suppression/corbeille. Surface d'écriture Gmail inchangée (verrou CI).
- **Quotas** : bornes quotidiennes en fils (deep clean) + suspension config persistée
  garantissent la survie du flux vivant ; les campagnes ne vampirisent jamais le quota.
- **Aucune suppression automatique** : préservé (§2.2).
- **Métadonnées seulement** (ADR-0007) : les nouveaux états sont des compteurs/timestamps.

## Méthode de test

Fonctions PURES testables (détection texte panne config, décision pré-filtre) ; tests moteur
sur : suspension config → intentions suspendues ; 3-strikes → `'deja-faite'` libère le message ;
tripwire « mail suspect/promo non lue → 0 intention SANS appel LLM » ; deep clean borné/reprenable
(offset, plafond quotidien, deux passes propres). Surface interne verrouillée.
