#!/bin/bash
# generate_manifest.sh — regenerate content_scripts[0].js/matches and
# host_permissions from modules/*.js header comments.
#
# Sources of truth:
#   modules/*.js headers:  // @match <pattern>
#                          // @host_permissions <pattern>
#   Files containing '@world MAIN' are excluded from entry [0] (their
#   manifest wiring lives in hand-maintained entries like [1]).
#
# Safety: DRY RUN by default. Writes only with --write, and only if the
# derived sets lose NOTHING currently present (orphan guard). Backs up
# manifest.json before writing.

set -euo pipefail

MANIFEST="manifest.json"
MODULES_DIR="modules"
WRITE=0
[ "${1:-}" = "--write" ] && WRITE=1

command -v jq >/dev/null || { echo "Error: jq not installed"; exit 1; }
[ -f "$MANIFEST" ] || { echo "Error: $MANIFEST not found"; exit 1; }

JS_FILES=("modules/index.js")
MATCHES=()
HOST_PERMS=()
MAIN_FILES=()

for file in "$MODULES_DIR"/*.js; do
    filename=$(basename "$file")
    [ "$filename" = "index.js" ] && continue

    if grep -q '@world MAIN' "$file"; then
        MAIN_FILES+=("$file")
        continue   # MAIN-world: wired in separate manifest entries, not [0]
    fi

    JS_FILES+=("$file")

    while IFS= read -r line; do
        if [[ "$line" =~ @match\ (.*) ]]; then
            MATCHES+=("${BASH_REMATCH[1]}")
        elif [[ "$line" =~ @host_permissions\ (.*) ]]; then
            HOST_PERMS+=("${BASH_REMATCH[1]}")
        fi
    done < "$file"
done

JS_FILES+=("content.js")

# Normalize: sort + dedup (stable diffs, duplicate-header detection)
norm() { printf '%s\n' "$@" | sort -u; }
DERIVED_MATCHES=$(norm "${MATCHES[@]}")
DERIVED_PERMS=$(norm "${HOST_PERMS[@]}")

# Current manifest sets
CUR_MATCHES=$(jq -r '.content_scripts[0].matches[]' "$MANIFEST" | sort -u)
CUR_PERMS=$(jq -r '.host_permissions[]' "$MANIFEST" | sort -u)

# ── Orphan guard: derived set must not LOSE anything current ──
LOST_MATCHES=$(comm -23 <(echo "$CUR_MATCHES") <(echo "$DERIVED_MATCHES"))
LOST_PERMS=$(comm -23 <(echo "$CUR_PERMS") <(echo "$DERIVED_PERMS"))

fail=0
if [ -n "$LOST_MATCHES" ]; then
    echo "⚠ ORPHANED matches (in manifest, owned by no module header):"
    echo "$LOST_MATCHES"; fail=1
fi
if [ -n "$LOST_PERMS" ]; then
    echo "⚠ ORPHANED host_permissions (in manifest, owned by no module header):"
    echo "$LOST_PERMS"; fail=1
fi
if [ $fail -eq 1 ]; then
    echo ""
    echo "Fix: add the missing '// @match' or '// @host_permissions' line(s)"
    echo "to the owning module's header — or accept the loss deliberately by"
    echo "removing them from manifest.json first."
    [ $WRITE -eq 1 ] && echo "REFUSING to write (--write given, orphans present)."
    exit 2
fi

# ── Report additions + MAIN-world check ──
NEW_MATCHES=$(comm -13 <(echo "$CUR_MATCHES") <(echo "$DERIVED_MATCHES"))
NEW_PERMS=$(comm -13 <(echo "$CUR_PERMS") <(echo "$DERIVED_PERMS"))
[ -n "$NEW_MATCHES$NEW_PERMS" ] && { echo "New from headers:"; [ -n "$NEW_MATCHES" ] && echo "$NEW_MATCHES"; [ -n "$NEW_PERMS" ] && echo "$NEW_PERMS"; }

for f in "${MAIN_FILES[@]:-}"; do
    [ -z "$f" ] && continue
    host=$(grep -oP '@match \K.*' "$f" | head -1)
    grep -qF "\"$host\"" <(jq -r '.content_scripts[1].matches[]' "$MANIFEST") \
        || echo "⚠ MAIN-world file $f host '$host' not found in content_scripts[1].matches (hand-maintained entry)"
done

# ── Build and (maybe) write ──
JS_JSON=$(printf '%s\n' "${JS_FILES[@]}" | jq -R . | jq -s .)
M_JSON=$(echo "$DERIVED_MATCHES" | jq -R . | jq -s .)
H_JSON=$(echo "$DERIVED_PERMS" | jq -R . | jq -s .)

if [ $WRITE -eq 0 ]; then
    echo "DRY RUN — no changes. Derived js order:"
    printf '  %s\n' "${JS_FILES[@]}"
    echo "Run with --write to apply."
    exit 0
fi

cp "$MANIFEST" "manifest.json.bak.$(date +%s.%T)"
jq --argjson js "$JS_JSON" --argjson matches "$M_JSON" --argjson host_perms "$H_JSON" \
  '.content_scripts[0].js = $js | .content_scripts[0].matches = $matches | .host_permissions = $host_perms' \
  "$MANIFEST" > manifest.tmp.json
mv manifest.tmp.json "$MANIFEST"
echo "✅ manifest.json updated (backup: manifest.json.bak.*)"
