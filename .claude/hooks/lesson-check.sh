#!/usr/bin/env bash
# Stop — si du code a changé sans qu'une leçon soit consignée, invite à le faire (une fois).
# Borné : pose un marqueur "lesson-prompted" pour ne jamais boucler.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE="$ROOT/.claude/.state"
mkdir -p "$STATE"

# Si on est déjà dans une continuation déclenchée par ce hook, ne pas re-bloquer.
input="$(cat 2>/dev/null || true)"
case "$input" in
  *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;;
esac

# Déjà invité dans cette session → laisser terminer.
[ -f "$STATE/lesson-prompted" ] && exit 0

if [ -f "$STATE/code-changed" ]; then
  touch "$STATE/lesson-prompted"
  rm -f "$STATE/code-changed"
  echo "Du code a changé cette session. Avant de conclure : si tu as appris une règle réutilisable (convention, piège de quota Apps Script, format de prompt, garde-fou), consigne-la avec /lesson \"…\" pour mettre docs/LESSONS.md (et CLAUDE.md si durable) à jour. Sinon, indique brièvement « rien à consigner » puis termine." >&2
  exit 2
fi

exit 0
