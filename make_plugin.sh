#!/bin/bash
# make_plugin.sh — regenerate plugin.txt from current directory contents.
set -e

FILES=(
  background.js
  content.js
  Directory_Structure.md
  generate_manifest.sh
  HOWTO_add_new_LLM_model.md
  manifest.json
  options.html
  options.js
  popup.html
  popup.js
  modules/chatgpt.js
  modules/claude.js
  modules/duckai.js
  modules/gemini.js
  modules/google_flow.js
  modules/google-search-ai-logger.js
  modules/index.js
  modules/inject_main_world.js
  modules/inject_zai_wire.js
  modules/inject_gemini_wire.js
  modules/notebooklm.js
  modules/zai.js
)

# Canary: the generic content script must contain no service-specific selectors.
if grep -q 'source-inline-chip' content.js; then
  echo "WARNING: service-specific DOM selectors found in content.js — refactor leak?"
fi

# Canary: every module in FILES must be referenced by manifest.json.
for f in "${FILES[@]}"; do
  case "$f" in modules/*.js) grep -q "$(basename "$f")" manifest.json || \
    echo "WARNING: $f not referenced in manifest.json — stale manifest?";; esac
done

# Binary assets cannot survive a text heredoc; they are not archived.
for ic in icons/cfi.16.png icons/cfi.32.png icons/cfi.48.png icons/cfi.128.png; do
  [ -f "$ic" ] || echo "WARNING: $ic missing — manifest.json references it; copy icons/ manually when restoring from this archive."
done

OUT="plugin.txt"
: > "$OUT"
cat >> "$OUT" << 'HEADER'
#!/bin/bash
# Self-extracting archive generated via Bootstrap Protocol
# Execute this script to extract contents to the current directory.
HEADER

for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "WARNING: Missing $f (skipped)"; continue; }
  {
    echo "echo 'Extracting: $f'"
    echo "mkdir -p \"\$(dirname \"$f\")\""
    echo "rm -f \"$f\""
    echo "cat  >> \"$f\" << 'EOF_ARCHIVE_CHUNK'"
    cat "$f"
    if [ -n "$(tail -c 1 "$f")" ]; then echo ""; fi
    echo "EOF_ARCHIVE_CHUNK"
  } >> "$OUT"
done

cat >> "$OUT" << 'FOOTER'
echo 'Payload successfully unpacked.'
exit 0
FOOTER
chmod +x "$OUT"

COUNT=$(grep -c '^EOF_ARCHIVE_CHUNK$' "$OUT")
if [ "$COUNT" -eq "${#FILES[@]}" ]; then
  echo "OK: plugin.txt regenerated: ${#FILES[@]} chunks, $COUNT terminators."
else
  echo "WARNING: Terminator mismatch: expected ${#FILES[@]}, found $COUNT."
fi
