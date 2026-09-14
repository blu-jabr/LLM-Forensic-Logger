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
  modules/notebooklm.js
)

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
