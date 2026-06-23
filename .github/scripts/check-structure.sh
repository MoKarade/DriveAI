#!/usr/bin/env bash
# Vérifie la présence des fichiers de référence du projet.
set -uo pipefail

ROOT="${1:-.}"

required=(
  CLAUDE.md README.md PLAN.md BACKLOG.md HANDOVER.md
  docs/ARCHITECTURE.md docs/TAXONOMY.md docs/NAMING.md docs/WORKFLOW.md docs/LESSONS.md docs/DEPLOIEMENT.md
  .claude/settings.json
  .claude/hooks/session-start.sh
  .claude/hooks/mark-code-changed.sh
  .claude/hooks/lesson-check.sh
  .claude/agents/product-manager.md
  .github/workflows/ci.yml
  .github/workflows/auto-merge.yml
)

missing=0
for f in "${required[@]}"; do
  if [ ! -f "$ROOT/$f" ]; then
    echo "❌ Fichier requis manquant : $f"
    missing=1
  fi
done

[ "$missing" -eq 0 ] && echo "✅ Structure complète."
exit "$missing"
