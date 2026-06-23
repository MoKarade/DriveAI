#!/usr/bin/env bash
# PostToolUse (Write|Edit|MultiEdit) — note que du code a changé pendant la session.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE="$ROOT/.claude/.state"
mkdir -p "$STATE"
touch "$STATE/code-changed"

exit 0
