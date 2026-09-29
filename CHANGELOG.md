Changelog
[1.32] — 2026-09-30
Z.AI becomes the second complete module; attachment pipeline (text + image);unified filenames; recovery tooling; manifest generation hardened.

Added
modules/zai.js: full round capture (prompt / thinking / response), thinkingauto-expand + restore during bulk, text-attachment harvest via the Bits UIdialog contract, image harvest via chip thumbnail URL, per-round statusbridge to the popup (setStatus → bulkStatus polling)
background.js: FETCH_ASSET handler — SW-side fetch for the asset CDN(D10: content scripts are page-CORS-bound; the SW is not, for hosts inhost_permissions)
popup: "Export Download Manifest" (all profile downloads, cdnMatch flag)
notes/rescue_attachments.py: joins CDN-UUID downloads to round .d/ dirs byUUID; refuses 403-page masquerades; UNRESOLVED over guessed
Changed
Unified filename BASE: flush/state/handoff all useSESSION_ID.SERVICE.dateStr.timeStr.HOSTNAME (+ seq for flush/state) (D5/D7/D12)
content.js: errors route through derr (D1); payloads carry the module key (D2/D3)
text/* blob downloads keep real extensions (D4)
Tooling
generate_manifest.sh hardened: dry-run by default; orphan guard refuses towrite if any current manifest entry is unowned by a module header; backupbefore write. Contract: manifest permissions are owned by module headers.
Known gaps
PDF attachments: not harvested (no DOM-resident URL; download-on-click only)
DOM transcript ≠ wire payload on attachment rounds (chat.z.ai server-sidewrapper bug — reported upstream 2026-09-30)
[1.31] —
Going forward: every bump gets a block, grouped Added/Changed/Fixed/Tooling, with the deviations ledger referenced by D-number rather than restated. The commit message then only needs bump to 1.32 — see CHANGELOG.


