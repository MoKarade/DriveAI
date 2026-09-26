<!-- Extrait de l'ancien CLAUDE.md (§ 5. Vérifications avant commit), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Vérifications avant commit

## 5. Vérifications avant commit

```bash
node --test test/*.test.js            # moteur : logique pure, zéro dépendance
cd app && npm test && npm run build   # app web : vitest + tsc --noEmit + vite build
```

Plus, si un `.gs` a bougé — **un `.gs` à la syntaxe cassée fige le déploiement `clasp`**, et ça ne
se voit ni dans les tests du moteur (qui ne chargent pas tous les fichiers) ni dans le build de
l'app :

```bash
tmp=$(mktemp -d); for f in src/*.gs; do cp "$f" "$tmp/$(basename "$f" .gs).js"; done
for j in "$tmp"/*.js; do node --check "$j" || echo "❌ $(basename "$j" .js).gs"; done
```

La **CI** (`.github/workflows/ci.yml`) rejoue exactement ce gate, plus les tripwires de surface
(scan de secrets, `surface-gmail-ecriture`, `trashed: true` confiné à `app/src/corbeille.ts`) et
les captures E2E en mode mock. Chaque job est borné par `timeout-minutes` : sans lui, le défaut
GitHub est de **six heures** — vécu 2× le 19/08, `playwright install` figé > 20 min retenant le
merge sans rien afficher.

**SonarCloud** tourne en analyse AUTOMATIQUE (aucun workflow) : sa config est
`.sonarcloud.properties` à la racine. `app/src/i18n.ts` y est exclu de la seule détection de
duplication (arbitrage de Marc, 23/09) — ses tables FR/EN se répètent par construction et
faisaient rougir chaque PR qui ajoute du texte. ⚠️ Ne jamais y exclure du CODE : une
duplication réelle se factorise.
