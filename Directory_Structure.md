# Directory Structure

    LLM-Forensic-Logger/
    ├── manifest.json            v1.28 — incl. MAIN-world content script entry
    ├── background.js            generic: packet, state, handoff, citation index, debug log
    ├── content.js               generic: dispatch, media engine, module hooks (FROZEN)
    ├── popup.html / popup.js    incl. debug-log download
    ├── options.html / options.js
    ├── make_plugin.sh           regenerates plugin.txt (19 chunks)
    ├── generate_manifest.sh     optional; skips @world MAIN files
    ├── HOWTO_add_new_LLM_model.md
    ├── plugin.txt               generated — never hand-edit, never transport via chat
    ├── icons/                   binary — NOT archived; copy manually
    ├── modules/
    │   ├── index.js             namespace + shared dlog/derr
    │   ├── gemini.js            ALL Gemini logic incl. citation-chip pipeline
    │   ├── inject_main_world.js MAIN world: window.open / anchor interception
    │   └── chatgpt.js, claude.js, duckai.js, google_flow.js,
    │       google-search-ai-logger.js, notebooklm.js
    ├── notes/                   dev snippets + cache dumps — NOT archived
    └── README.md                repo docs — NOT archived
