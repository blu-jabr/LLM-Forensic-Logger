# Changelog

## [2.0] — 2026-10-01

Wire capture: MAIN-world injectors now record the services' own chat-dataAPI traffic — the ground-truth record the DOM only renders. Z.AI reaches100% attachment coverage (PDFs included); Gemini gains original filenames,thinking-text backfill, and structured media metadata.

### Added

- modules/inject_zai_wire.js (D14): MAIN-world, document_start. Hooksfetch/XHR for POST /api/v1/chats/{id}/messages/batch; extracts messages,reasoning, usage, and files[] (cdn_url, filename, size, content_type)only — raw responses never cross the boundary. Receiver in zai.js mergesbatches per chatId; exact UUID round-matching.
- modules/inject_gemini_wire.js (D15): MAIN-world, document_start. Parsesbatchexecute length-prefixed framing for the hNvQHb conversation-historyRPC; relays ONLY targeted structures (media entries, thought pairs,c_/r_/rc_ id triples) — safety-classifier telemetry dropped byconstruction.
- zai: PDF harvesting (the last unrecoverable attachment type) via wirefiles[] → existing FETCH_ASSET two-tier fetch; byte-count verifiedagainst the wire record (117963/117963). metadata.wire per round:{captured, modelInternal, usage, reasoningChars, promptCrossCheck,batchesMerged}.
- gemini: original-filename stamping via download attribute (lh3 URL-tokenkeyed — filenames duplicate across generation events, so URL is thejoin key); thinking backfill for citation-bearing rounds (r_→rc_ triplemapping joins wire turns to the existing chip pipeline); metadata.wiremedia inventory with true mime/bytes/dimensions; generated-video recordscaptured with their contribution.download URLs, generation prompt,model id, and shot timeline.
- notes/WIRE_CAPTURE_PLAYBOOK.md: the discovery method (three-artifactdivergence audit, response-body search technique), relay contracts,failure-class table, per-service expectations, and what does NOTtransfer.

### Changed

- Filenames: attachment harvesting now prefers wire-record originals onboth services — Gemini's attachment-N/media-N fallback and z.ai'splaceholder-for-PDF are both retired for wire-covered rounds.
- zai bulkPreExtract branch order: images (thumbnail URL) → safe-text(viewer harvest) → wire (files[] lookup) → honest skip.
- manifest: two new MAIN-world content-script entries (document_start);make_plugin.sh FILES +2 (20→22 chunks); manifest canary added tomake_plugin.sh warning on FILES entries absent from manifest.json.

### Verified (end-to-end)

- z.ai 3-attachment session: 11/11 attachments harvested (2 jpg viathumbnail two-tier, 3 pdf via wire, 6 txt via viewer), 8/8 rounds,thinking captured, wire batches merged (16 messages, 5 files across 2batches), handoff/manifest/debug all green.
- Gemini: wire record confirmed to carry original filenames (incl.duplicates keyed by distinct URLs), full reasoning blocks, videoentries (video.mp4 with download URL, models/omni_pro, shot timeline,1280×720), and internal model ids diverging from UI labels.

### Known gaps (documented, not fixed)

- Gemini thinking backfill covers citation-bearing rounds (r_→rc_ join);citation-less turns need a response-element id sample.
- Gemini wire windowing on very long sessions unverified.
- z.ai live rounds log wire.captured:false until the next batch fetch.
- .md placeholder extension vs on-disk mime-corrected name can diverge(frozen-file ordering; cosmetic).

## [1.32] — 2026-09-29

Z.AI becomes the second complete module; attachment pipeline (text + image);unified filenames; recovery tooling; manifest generation hardened.

### Added

- modules/zai.js: full round capture (prompt / thinking / response), thinkingauto-expand + restore during bulk, text-attachment harvest via the Bits UIdialog contract, image harvest via chip thumbnail URL, per-round statusbridge to the popup (setStatus → bulkStatus polling)
- background.js: FETCH_ASSET handler — SW-side fetch for the asset CDN(D10: content scripts are page-CORS-bound; the SW is not, for hosts inhost_permissions)
- popup: "Export Download Manifest" (all profile downloads, cdnMatch flag)
- notes/rescue_attachments.py: joins CDN-UUID downloads to round .d/ dirs byUUID; refuses 403-page masquerades; UNRESOLVED over guessed

### Changed

- Unified filename BASE: flush/state/handoff all useSESSION_ID.SERVICE.dateStr.timeStr.HOSTNAME (+ seq for flush/state) (D5/D7/D12)
- content.js: errors route through derr (D1); payloads carry the module key (D2/D3)
- text/* blob downloads keep real extensions (D4)

### Tooling

- generate_manifest.sh hardened: dry-run by default; orphan guard refuses towrite if any current manifest entry is unowned by a module header; backupbefore write. Contract: manifest permissions are owned by module headers.

### Known gaps

- PDF attachments: not harvested (no DOM-resident URL; download-on-click only)
- DOM transcript ≠ wire payload on attachment rounds (chat.z.ai server-sidewrapper bug — reported upstream 2026-09-30)

## [1.31] —

Going forward: every bump gets a block, grouped Added/Changed/Fixed/Tooling, with the deviations ledger referenced by D-number rather than restated. The commit message then only needs `bump to 1.32 — see CHANGELOG`.


