#!/usr/bin/env bash
# Vérifie que chaque agent a un frontmatter avec name: et description:.
set -uo pipefail

ROOT="${1:-.}"
fail=0
found=0

for f in "$ROOT"/.claude/agents/*.md; do
  [ -e "$f" ] || continue
  found=1

  if [ "$(head -n 1 "$f")" != "---" ]; then
    echo "❌ $f : frontmatter manquant (--- attendu en première ligne)"
    fail=1
    continue
  fi

  # Bloc de frontmatter : entre la 1re ligne --- et le --- suivant.
  fm="$(awk 'NR==1 { next } /^---[[:space:]]*$/ { exit } { print }' "$f")"

  echo "$fm" | grep -qE '^name:' || { echo "❌ $f : champ 'name:' manquant"; fail=1; }
  echo "$fm" | grep -qE '^description:' || { echo "❌ $f : champ 'description:' manquant"; fail=1; }
done

if [ "$found" -eq 0 ]; then
  echo "❌ Aucun agent trouvé dans .claude/agents/"
  exit 1
fi

[ "$fail" -eq 0 ] && echo "✅ Agents valides."
exit "$fail"
