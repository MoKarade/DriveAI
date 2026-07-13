# ADR-0021 — Zéro configuration client & verrou d'identité ALLOWED_EMAIL

- **Statut** : Accepté (C28-20, demande Marc 2026-07-13 : « je veux jamais avoir à mettre les
  infos pour me connecter genre le id de la feuille etc, je veux rien, juste mon compte Google »).
- **Décideurs** : Marc (choix produit), NotebookLM (plan technique), Claude (exécution).
- **S'appuie sur** : C28-14 (BFF Vercel, cookie HttpOnly chiffré), §2.3 (moindre privilège),
  §2.4 (aucun secret en dur).

## Problème

Au premier lancement (ou après un vidage du navigateur), l'app exigeait la saisie manuelle de
l'ID de la Sheet d'état, de l'URL de la web app et de son secret — stockés en `localStorage`.
C'est de la friction pure pour un produit mono-utilisateur, et le secret de la web app vivait
en clair dans le stockage du navigateur. Par ailleurs, RIEN ne limitait QUI pouvait ouvrir une
session : n'importe quel compte Google passant le consentement obtenait un cookie de session
(ses propres données, mais notre `/api/*` comme passerelle).

## Décisions

1. **La config vient du serveur** : `SPREADSHEET_ID`, `WEBAPP_URL`, `WEBAPP_SECRET` deviennent
   des variables d'environnement Vercel, délivrées par un nouvel endpoint `GET /api/config` —
   UNIQUEMENT à une session valide (cookie `driveai_rt` déchiffrable). Côté client :
   `app/src/config.ts` garde la config **en mémoire de module** (jamais persistée), chargée par
   `chargerConfigServeur()` après connexion ; l'écran Configuration, `enregistrerConfig` et le
   `localStorage` associé sont SUPPRIMÉS. Plus de variables `VITE_*` figées au build.
2. **Verrou d'identité** : `/api/login` demande en plus les scopes `openid email` (lecture
   d'identité — aucun service, §2.3 intact) ; `/api/callback` décode l'`id_token` retourné par
   l'échange code→token (canal serveur↔Google en HTTPS, pas de vérification de signature
   nécessaire — recommandation Google pour ce canal) et compare l'email VÉRIFIÉ à la variable
   `ALLOWED_EMAIL` (insensible à la casse). Mismatch, email non vérifié, `id_token` absent OU
   `ALLOWED_EMAIL` non configurée ⇒ échec FERMÉ : **aucun cookie posé**, redirection
   `/?erreur=acces_refuse` (bannière explicative sur l'écran de connexion).
3. **Échec fermé partout** : `/api/config` répond 401 sans cookie valide (le secret de la web
   app ne sort jamais vers un anonyme) et 500 si les variables serveur sont incomplètes (jamais
   une config partielle). Côté app, un échec de chargement ramène à l'écran de connexion avec un
   message — jamais des vues qui échouent en boucle.

## Conséquences

- **Marc ne saisit plus rien** : se connecter avec le bon compte Google suffit, sur n'importe
  quel navigateur/appareil. Le « premier lancement » et le « navigateur vidé » deviennent
  identiques au cas nominal.
- **Surface de sécurité réduite** : le secret de la web app quitte le `localStorage` (il ne
  transite plus que vers une session authentifiée) ; seul le compte `ALLOWED_EMAIL` peut ouvrir
  une session — le verrou est la SEULE barrière d'accès à `/api/config`, il est donc testé.
- **4 variables Vercel à ajouter** (une fois) : `ALLOWED_EMAIL`, `SPREADSHEET_ID`, `WEBAPP_URL`,
  `WEBAPP_SECRET` — voir `docs/DEPLOIEMENT.md` §Phase 4. Tant qu'elles manquent, l'app affiche
  « configuration indisponible » après connexion (comportement voulu, jamais silencieux).
- **Rotation de `COOKIE_SECRET` OBLIGATOIRE au déploiement** (trouvaille de la revue flotte) :
  le verrou n'est vérifié qu'à la CRÉATION du cookie, jamais à sa consommation — un cookie de
  session posé AVANT C28-20 (n'importe quel compte, 1 an) passerait `/api/config`. Régénérer le
  secret invalide toutes les sessions pré-verrou ; Marc se reconnecte une fois en passant par
  le verrou. Documenté dans `docs/DEPLOIEMENT.md`.
- **Périmètre OAuth** : `openid email` s'ajoute au consentement de l'APP (côté Vercel).
  Les `oauthScopes` du MOTEUR Apps Script sont INCHANGÉS — aucune ré-autorisation, aucun arrêt
  des déclencheurs (la leçon « étendre oauthScopes = arrêt total » ne s'applique pas ici).

## Tests (app/test/bff.test.ts + app/test/callback.test.ts)

- `emailDepuisIdToken` : email vérifié → minuscules ; `email_verified:false`, email absent, JWT
  malformé → null (échec fermé).
- `SCOPES_IDENTITE` : exactement `openid email`, jamais un scope de service.
- `/api/config` : 200 avec cookie déchiffrable ; 401 sans cookie ou cookie forgé (aucune fuite
  du secret dans la réponse — et le 401 précède le 500 : un anonyme ne sonde pas l'état de la
  config serveur) ; 500 si variables incomplètes.
- `/api/callback` (HANDLER, `callback.test.ts` — « promesse de verrou = verrou codé ») :
  compte autorisé → cookie posé + `/` ; compte étranger, `ALLOWED_EMAIL` absente, `id_token`
  manquant ou email non vérifié → AUCUN cookie + `/?erreur=acces_refuse` ; non-régression
  C28-14 (pas de refresh_token → `/?auth=echec`).
- `session.test.ts` (verrou localStorage de google.ts) : INTACT.
