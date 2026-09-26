<!-- Extrait de l'ancien CLAUDE.md (§ 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

## 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

**CI verte ne veut pas dire « en ligne ».** Ce sont deux systèmes indépendants : la CI juge le
code, l'hébergeur construit et sert. Un merge peut passer le gate et ne jamais être déployé — la
branche reste verte, le site continue de servir l'ancien build, et rien n'est rouge nulle part.

Vécu le 31/07/2026 : quatre projets Vercel ont cessé de créer des déploiements pendant ~3 h.
DriveAI et JobAI ont rattrapé au push suivant ; Hubperso et BatchChef n'en ont pas eu — leur commit
d'en-têtes de sécurité est resté **cinq jours** en attente sans que personne ne le voie.

Donc, après un merge qui change ce qui est SERVI : vérifier qu'un déploiement de production a bien
été créé et qu'il est `READY`, puis **contrôler l'effet sur la réponse réelle** — un en-tête se lit
dans la réponse, il ne se déduit pas du fichier source.

Corollaire : un merge qui ne change QUE de la doc n'a pas de déploiement à vérifier. Le dire plutôt
que de laisser croire qu'on a vérifié.

**DriveAI a DEUX cibles, et la CI n'en garde qu'une.** Vercel déploie l'app + `api/` ; le moteur,
lui, part sur Apps Script via `deploy.yml` (`clasp push` + `clasp deploy -i $WEBAPP_DEPLOYMENT_ID` +
réinstallation des déclencheurs). Un merge qui touche `src/*.gs` n'est en ligne que quand CE
workflow-là est vert : le moteur continue sinon d'exécuter l'ancienne version, en silence, tick
après tick. Vérifier le run `deploy.yml`, pas seulement la CI ni Vercel.

### En-têtes de sécurité (`vercel.json`)

Ajoutés le 2026-07-31 — DriveAI n'en avait **aucun**. Ils vivent dans `vercel.json` (SPA Vite
servi en statique, pas de config de framework où les mettre).

⚠️ **`vercel.json` REFUSE les clés de commentaire `//…`** (contrairement à `package.json`) :
son schéma rejette toute propriété additionnelle et le déploiement échoue avec
`should NOT have additional property`. D'où cette note ici plutôt que dans le fichier.

- **Enforcés** (aucun risque) : HSTS 1 an + `includeSubDomains`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **CSP en `Report-Only`**, volontairement. DriveAI est le cas le plus délicat de
  l'écosystème : par **ADR-0007**, l'app lit la Sheet d'état **depuis le NAVIGATEUR** avec le
  jeton OAuth de Marc (le serverless n'y a aucun accès). `connect-src` doit donc autoriser
  `sheets.googleapis.com` / `www.googleapis.com` / `accounts.google.com`. Une CSP trop serrée
  couperait l'app de ses propres données — **silencieusement**, sans que le build ni les tests
  ne le voient.
- ➜ **Pour passer en enforcé** : ouvrir l'app, parcourir l'explorateur, la corbeille et
  l'assistant, vérifier qu'aucune violation CSP n'apparaît en console, puis renommer la clé
  `Content-Security-Policy-Report-Only` en `Content-Security-Policy`. Tant que ce n'est pas
  fait, la CSP **observe** — elle ne protège pas.
