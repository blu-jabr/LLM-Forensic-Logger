# Directory Structure

    LLM-Forensic-Logger/
    ├── manifest.json               # v2.0 — header-owned; regenerate via generate_manifest.sh
    ├── background.js               # service worker: queue, state, handoff, citation index,
    │                               #   media + FETCH_ASSET, manifest export, debug store
    ├── content.js                  # orchestrator: live/bulk extraction, HTML->MD engine,
    │                               #   media pipeline, debug bus (frozen; see ledger)
    ├── popup.html / popup.js       # Log Entire Session - Generate Handoff -
    │                               #   Export Download Manifest - Download Debug Log
    ├── options.html / options.js   # hostname configuration (cached in storage)
    ├── generate_manifest.sh        # header-driven manifest regeneration (dry-run default)
    ├── make_plugin.sh              # self-extracting plugin.txt builder (22 chunks)
    ├── plugin.txt                  # generated archive (bootstrap protocol)
    ├── HOWTO_add_new_LLM_model.md  # new-service process + deviation ledger (D1-D15)
    ├── CHANGELOG.md                # per-version blocks
    ├── Directory_Structure.md      # (older layout doc; see this section first)
    ├── make_howto_prompt.py        # regenerates the HOWTO prompt template
    ├── icons/                      # cfi.{16,32,48,128}.png, cfi.svg
    ├── modules/
    │   ├── index.js                # window.ForensicModules = {} + dlog/derr
    │   ├── chatgpt.js              # first draft
    │   ├── claude.js               # first draft
    │   ├── duckai.js               # first draft
    │   ├── gemini.js               # COMPLETE: citations (chip pipeline), media,
    │   │                           #   thinking (wire-backfilled), wire filenames
    │   ├── google_flow.js          # first draft
    │   ├── google-search-ai-logger.js  # first draft
    │   ├── notebooklm.js           # first draft
    │   ├── zai.js                  # COMPLETE: rounds, thinking (DOM+wire), 100%
    │   │                           #   attachment coverage (text/image/PDF via wire)
    │   ├── inject_main_world.js    # MAIN world (Gemini): window.open + anchor nav relay
    │   ├── inject_zai_wire.js      # MAIN world (z.ai): chat-data batch observer   [v2.0]
    │   └── inject_gemini_wire.js   # MAIN world (Gemini): batchexecute hNvQHb parser [v2.0]
    └── notes/
        ├── WIRE_CAPTURE_PLAYBOOK.md    # wire discovery method + contracts    [v2.0]
        ├── assemble_session.py         # flush.*.md -> session(.complete).md
        ├── rescue_attachments.py       # download-manifest -> .d/ recovery joins
        ├── syntax_check.sh             # parse-check all .js (run before every reload)
        ├── chip_inventory.js           # citation chip inventory (gemini)
        ├── purge_snippet.js            # storage cache purge
        ├── test_battery.txt            # manual test checklist
        └── (scratch: *.json, drafts)   # session artifacts, not documentation
