# Filet de tests du moteur DriveAI

> Fondation testable — **ADR-0006** (chantier #1 de `docs/ROADMAP.md`). Verrouille la **logique de
> décision** du moteur Apps Script pour qu'on puisse l'améliorer sans casser la prod.

## Lancer

```bash
node --test test/*.test.js      # ou : npm test
```

**Zéro dépendance** : uniquement le lanceur intégré `node --test` (Node ≥ 18). Aucun `npm install`.
Tourne aussi en CI (job « Tests unitaires (logique pure) » de `.github/workflows/ci.yml`, Node 20).

## Comment ça marche (`harness.js`)

Les fichiers `src/*.gs` sont du JavaScript, mais tournent normalement dans Apps Script avec des globals
Google (`DriveApp`, `SpreadsheetApp`, `Utilities`, `Session`…). Le *harness* les charge dans un contexte
`vm` isolé où ces globals sont **mockés de façon déterministe**, puis expose leurs fonctions.

- **Aucune modification du code source** : le comportement testé est exactement celui déployé.
- Au chargement, un `.gs` n'exécute que des déclarations ; les appels Google sont tous dans des fonctions
  → non déclenchés au *load*. On ne fournit donc que le strict nécessaire (`Utilities.formatDate`,
  `Session`, `Date`) et on stube le reste.
- `fakeFolder` / `fakeFile` / `iter` simulent une arborescence Drive (y compris un `getParents()` qui
  **lève** — le cas racine/Drive partagé de P1-17) pour tester le garde-fou §1.

## Couverture (37 tests)

| Fichier | Cible | Ce qui est verrouillé |
|---------|-------|-----------------------|
| `naming.test.js` | `champ_`, `nomNormalise_`, `extension_`, `cheminLisible_` | Convention `AAAA-MM-JJ_Type_Émetteur.ext`, nettoyage des champs, accents préservés |
| `dates.test.js` | `dateNormalisee_` | Date valide passe telle quelle ; sinon fallback réception (jamais une date bancale) |
| `entites.test.js` | `normaliserCle_`, `cleEntite_`, `sousDossierPourType_` | Matching insensible casse/accents ; **pas de sous-dossier hors schéma** |
| `guardrail.test.js` | `aParentProtege_`, `chaineMonteVersProtege_` | **Garde-fou §1** : jamais détacher de `04·Immigration` (multi-parents, chaîne d'ancêtres, échoue-fermé en mutation / ouvert en collecte, borne anti-cycle) |
| `predicates.test.js` | `estAReclasserLeger_`, `estAReclasser_` | Convergence du rangement (déjà renommé → non re-collecté) + garde §1 à la collecte |
| `privacy.test.js` | `indexAjouter_` | **Invariant vie privée (ADR-0007)** : l'Index n'écrit QUE des métadonnées, jamais le corps d'un document |

## Ajouter un test

1. Créer `test/<sujet>.test.js` (`const { test } = require('node:test')`).
2. `const ctx = load(['Config.gs', 'Fichier.gs'], overrides?)` puis appeler `ctx.maFonction_(…)`.
3. Si la fonction touche un global Google non fourni, ajouter un mock déterministe dans `harness.js`
   (ou le passer en `overrides`).
