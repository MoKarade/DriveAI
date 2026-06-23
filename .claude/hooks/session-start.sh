#!/usr/bin/env bash
# SessionStart — réinitialise l'état de session et injecte les dernières leçons en contexte.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE="$ROOT/.claude/.state"
mkdir -p "$STATE"

# Repartir propre : aucun marqueur de la session précédente.
rm -f "$STATE/lesson-prompted" "$STATE/code-changed"

LESSONS="$ROOT/docs/LESSONS.md"
if [ -f "$LESSONS" ]; then
  echo "### Leçons récentes (extrait de docs/LESSONS.md) — garde-les en tête"
  tail -n 40 "$LESSONS"
fi

exit 0
