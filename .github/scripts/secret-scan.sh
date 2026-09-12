#!/usr/bin/env bash
# Échoue si un secret en clair est détecté dans le dépôt.
set -uo pipefail

ROOT="${1:-.}"

patterns=(
  'sk-ant-[A-Za-z0-9_-]{20,}'        # clé API Anthropic
  'AKIA[0-9A-Z]{16}'                  # clé AWS
  'AIza[0-9A-Za-z_-]{35}'            # clé Google API
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  # OAuth Google — DriveAI manipule un client OAuth (api/callback.ts), un refresh token hubperso
  # (src/JetonHubperso.gs) et des jetons MCP : ces trois formats passaient le scan sans un bruit
  # (vérifié empiriquement, audit sécurité 2026-09-10).
  'GOCSPX-[A-Za-z0-9_-]{20,}'        # secret client OAuth Google
  'ya29\.[A-Za-z0-9_-]{50,}'         # jeton d'accès Google
  '1//[0-9][A-Za-z0-9_-]{30,}'       # refresh token Google
)

args=()
for p in "${patterns[@]}"; do args+=(-e "$p"); done

hits="$(grep -rIEn --binary-files=without-match \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude='secret-scan.sh' \
  "${args[@]}" "$ROOT" || true)"

if [ -n "$hits" ]; then
  echo "❌ Secret potentiel détecté :"
  echo "$hits"
  exit 1
fi

echo "✅ Aucun secret détecté."
exit 0
