#!/bin/bash

# Ensure jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Please install it first (e.g., sudo apt install jq or brew install jq)."
    exit 1
fi

MANIFEST="manifest.json"
MODULES_DIR="modules"

if [ ! -f "$MANIFEST" ]; then
    echo "Error: $MANIFEST not found!"
    exit 1
fi

# Initialize arrays
JS_FILES=("modules/index.js")
MATCHES=()
HOST_PERMS=()

# Read through all module files (excluding index.js)
for file in "$MODULES_DIR"/*.js; do
    filename=$(basename "$file")
    if [ "$filename" == "index.js" ]; then
        continue
    fi

    # Add to JS array
    JS_FILES+=("$file")

    # Extract @match and @host_permissions comments
    while IFS= read -r line; do
        if [[ "$line" =~ @match\ (.*) ]]; then
            MATCHES+=("${BASH_REMATCH[1]}")
        elif [[ "$line" =~ @host_permissions\ (.*) ]]; then
            HOST_PERMS+=("${BASH_REMATCH[1]}")
        fi
    done < "$file"
done

# Add content.js last
JS_FILES+=("content.js")

# Convert bash arrays to JSON arrays using jq
JS_JSON=$(printf '%s\n' "${JS_FILES[@]}" | jq -R . | jq -s .)
MATCHES_JSON=$(printf '%s\n' "${MATCHES[@]}" | jq -R . | jq -s .)
HOST_PERMS_JSON=$(printf '%s\n' "${HOST_PERMS[@]}" | jq -R . | jq -s .)

# Update manifest.json safely using jq
jq \
  --argjson js "$JS_JSON" \
  --argjson matches "$MATCHES_JSON" \
  --argjson host_perms "$HOST_PERMS_JSON" \
  '.content_scripts[0].js = $js | .content_scripts[0].matches = $matches | .host_permissions = $host_perms' \
  "$MANIFEST" > "manifest.tmp.json"

mv "manifest.tmp.json" "$MANIFEST"

echo "✅ manifest.json successfully updated with modules from $MODULES_DIR/"
