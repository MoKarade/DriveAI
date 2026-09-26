# Coûts CI — DriveAI

**Dépôt PUBLIC** (`gh repo view MoKarade/DriveAI` : isPrivate false), branche par défaut réelle **main** (le checkout local `C:\dev\DriveAI` est sur une branche `claude/`, à ignorer), **sans protection de branche** (`gh api .../branches/main/protection` : 404). Mesuré le 26/09/2026.
GitHub Actions est **GRATUIT** sur un dépôt public : aucune minute n'est comptée, l'objectif de coût des autres dépôts n'a pas d'objet ici. Modèle : `modeles/couts/couts.md` de l'Atelier. Les coûts LLM de l'app sont dans `docs/COUTS.md`.

## Runs GitHub Actions (information)
Mesure : `node modeles/couts/compter-runs.mjs MoKarade/DriveAI 2026-09` (lecture seule ; liste limitée à 1 000 runs : le mois peut être incomplet ; la durée de calendrier compte l'attente et n'est pas une facturation) :

| Workflow | Déclencheurs | Runs en 09/2026 (mesuré) | Échoués | Rôle |
|---|---|---|---|---|
| Auto-merge | workflow_run 238 | 238 | 0 | Fusion automatique (propre au dépôt, NON modifié par cette PR ; garde de chemins : #422). |
| CI | pull_request 182, push 47 | 229 | 11 | Validation, tests moteur, app, captures, qualité, sécurité. |
| Deploy | push 47, dispatch 54 | 101 | 6 | `clasp push` du moteur. NON touché. |
| Sync Drive (miroir NotebookLM) | push 47, dispatch 52 | 99 | 15 | Miroir Drive. NON touché. |
| Dependabot Updates | dynamique 19 | 19 | 0 | Mises à jour. |

## Crons
- Aucun cron GitHub Actions dans `ci.yml` ni `auto-merge.yml` (événementiel).

## Exceptions au gabarit
| Quoi | Raison | Condition de retour |
|---|---|---|
| Dépôt PUBLIC : pas de kit d'auto-merge (profil `prive` interdit), pas de profil complet, auto-merge propre au dépôt conservé | Choix du chef (option A) ; le profil `prive` est réservé aux dépôts privés (`verifier-copies` l'échoue) ; le profil complet demanderait protection de branche + relecture de sécurité des PR de forks | Après décision de Marc sur un ruleset et le profil complet |
| Pas de voie rapide « docs seules » dans la CI | Actions gratuit (aucune minute à économiser) ; la CI valide déjà des documents (`check-structure.sh`, tests qui lisent CLAUDE.md et docs/claude/) | Si le dépôt devient privé |
| Actions non épinglées par SHA (`@v7`) | Hors périmètre du lot allégé | PR dédiée (comme Hubperso#87) |
| `docs/COUTS.md` existe déjà (coûts LLM) : le modèle s'appelle ici `docs/couts-ci.md` | Deux noms qui ne diffèrent que par la casse se percutent sous Windows | aucune |
| `ignoreCommand` Vercel ajouté (`.github/ci/ignore-command.mjs`) | Absent avant ; pas de préversion pour PR de docs seules ni dependabot, production jamais sautée, build en cas de doute ; les branches `claude/*` n'ont déjà pas de préversion | aucune |
| 4 passages personnels de l'ancien CLAUDE.md sortis du dépôt (lignes 1150, 1335 à 1338, 1433, 1454 de l'ancien fichier) | Dépôt public : mentions de documents d'identité de Marc ; remplacés par une ligne neutre, texte gardé dans une liste privée hors git | Décision de Marc sur l'historique git (les passages y restent) |
