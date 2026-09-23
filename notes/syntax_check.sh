#! /bin/bash

# notes/syntax_check.sh — run from the extension root; silence = all clear
for f in *.js modules/*.js; do node --check "$f" || echo "FAIL: $f"; done
