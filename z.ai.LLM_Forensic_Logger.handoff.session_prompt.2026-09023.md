# Session Handoff — LLM-Forensic-Logger

**Hosts:** `sugarloaf` (dev, `~/m/extensions/LLM-Forensic-Logger`) · `seacouver` (git origin, NFS) · **Status:** citation subsystem COMPLETE, 51/51 verified · **⚠ Uncommitted:** everything since the pre-`session_name` commit, incl. the branched state/handoff features and the new citation index. **Commit before further refactoring.**

## Objective

Manifest V3 Chromium extension performing forensic logging of LLM chat rounds to `~/Downloads/LLM-Forensic-Logger/YYYY-MM-DD/`: per round `flush.{SESSION_ID}.{date}.{time}.{HOST}.{SEQ8}.md|json|xhtml` + `.d/` media dir; plus `state.*.json` (rolling cumulative state), `handoff.*.md` (mechanical summary for a receiving model — no LLM summarization), `citations.{chatId}.*.json` (citation index), `debug.*.log` (breadcrumb audit, export-then-clear).

## Architecture (files → responsibilities)

- **`manifest.json`** — v1.28, **hand-maintained. DO NOT run `generate_manifest.sh`** (it strips icons, `unlimitedStorage`, popup icons, and the MAIN-world `content_scripts` entry).
- **`content.js`** — generic orchestrator: MutationObserver live-logging (5s startup grace, scroll suppression, text-based dedupe), bulk-log handler, HTML→Markdown engine (`processHtmlAndMedia`: media fetch/blob→base64, attachment/media naming, citation-chip resolution, DOM-based anchor conversion), debug-log plumbing (`dlog`/`derr` → buffer → `FL_DEBUG_LOG` to background).
- **`background.js`** — serialized log queue, chatId-keyed persistent session state, session packet, rolling state, handoff generator, citation index (`mergeCitationIndex`/`emitCitationIndexFile` + `pendingIndexEmit` drain hook), media download w/ MIME verification + auto-rename, debug log store/export.
- **`modules/*.js`** — per-LLM DOM extractors with `@match`/`@host_permissions` headers; register on `window.ForensicModules` (`modules/index.js` initializes). Loaded before `content.js` per manifest `js` array order. **`gemini.js`** additionally: `stampChips()` (stamps `data-fl-cid`/`data-fl-skey` on live chips before cloning — _required_ because `p-rc_` paragraph ids don't survive re-parse) and `getSessionName()`.
- **`modules/inject_main_world.js`** — MAIN-world injector (`"world": "MAIN"`, `all_frames: true`, `document_start`): wraps `window.open`, patches `HTMLAnchorElement.prototype.click`, listens for `click`+**`auxclick`** (middle-button) using `composedPath()`, relays via `window.top.postMessage({type:'FORENSIC_WINDOW_OPEN'})`. content.js's listener reads `event.data` only (no `event.source === window` check — cross-frame relay).
- **`popup.html/js`** — Log Entire Session (with supported-tab fallback), Generate Handoff (Gemini-tab fallback for chatId), Download Debug Log (export-then-clear). `options.html/js` — hostname (cached in storage).
- **`notes/`** — console snippets: `purge_snippet.js`, `chip_inventory.js` (cid+jslog inventory for stability tests), `syntax_check.sh` (**run before every extension reload; silence = parse-clean**).

## Verified capabilities (test matrix, all green)

Live round logging; bulk extraction (17 rounds, correct order, serialized queue); media download with byte-verified extension auto-rename (`B6✓`); XHTML pristine snapshots (original `blob:`/CDN URLs preserved); rolling state; handoff (with doubled-prompt collapse); debug log; multi-URL chips emitting arrays (Envirotec ×3, OAE ×2, Drexler pair with distinct `#:~:text=` fragments); **citation resolution 51/51** with provenance (`stable-key` dominant; `exact` title matches; `sameTitleCount` gate keeps shared-title fallbacks honest).

## Hard-won Gemini DOM facts (do not relearn these)

1. Chips (`<source-inline-chip>`) are Angular **buttons**, not anchors. Target URLs are **absent from the DOM at rest** — injected lazily on hover (~1s, when the preview card renders). Middle-click before injection = silent nothing (no tab, no capture). Capture discipline: hover-until-card → click → **a tab opens iff captured**.
2. Middle-click fires **`auxclick`**, not `click`; the open is browser-native (no `window.open`), so `auxclick` + `composedPath()` is the only interception point. Left-click path goes through `window.open`.
3. `p-rc_<chunkhash>-<ordinal>` container ids: ordinals are **per-render** (shift on reload/re-render); chunk prefix + within-chunk relative order are **stable**. `stableChipKey` = `chunkhash#rank`. **Paragraph ids do not survive HTML re-parse** (block-in-`<p>` re-parenting by DOMParser) — hence `stampChips` in the module, keys carried as `data-fl-*` attributes on the chip itself.
4. Virtual scroller: only ~10 rounds render at page bottom; **reload → scroll through to top → bulk immediately** is the full-capture ritual. Scrolling without reloading slides the window.
5. One chip may carry **multiple citations** (URLs merge into arrays under one key). One paragraph container may hold multiple chips. Chip visible label = first source's title; sub-citation labels are approximate (`all_source_titles`, `source_list_complete: false` flag it).
6. `#:~:text=` fragments are **generated by Gemini** (the span it used), not page anchors — they may differ between sessions for the same claim; that variance is forensic signal.
7. Gemini aggressively `console.clear()`s — the extension stubs it and routes breadcrumbs through `dlog` to the file-based debug log. `alert()`s get suppressed by Chromium after repeated dialogs.
8. Content scripts run in an isolated world: no `chrome.*` from the page console, no shared JS with the page (hence MAIN-world injector + `postMessage` relay).

## Data formats (chrome.storage.local)

- `sessions{chatId: {SESSION_ID, round_number}}` — new UUID per bulk (reset flag), persistent for live.
- `sessionPackets{chatId: {session_id, session_name, rounds[]}}` — reset at bulk start; consecutive-dedupe.
- `citationIdCache{stable_key: url | url[]}` — the authoritative capture store (`chunkhash#rank` keys).
- `citationUrlCache{normTitle: url}` — hover-card harvest + click writes; unique titles resolve via `lookupChipUrl` prefix matching; shared titles gated by `sameTitleCount`.
- `citationIndexes{chatId: {stable_key: {source_title, urls[], cited_in[{session_id,round}], status, match_type, response_id, chunk_id}}}` — cumulative master index.
- `hostname`, `flDebugLog`.

## Rituals

1. Edit → `bash notes/syntax_check.sh` (silence) → reload at `chrome://extensions` → **refresh target tab** (else "Extension context invalidated").
2. Capture pass: hover-until-card → middle-click → tab opens = captured. Debug log `Associated with chip:` count must equal tabs opened.
3. Full log: reload → scroll through → **one** click Log Entire Session → handoff → debug export.
4. Never attach-and-forget: `diff` files against attachments; grep only the current run's session-id files.

## Pending queue (priority order)

1. **`git commit` on seacouver** — include `modules/inject_main_world.js`, popup trio, manifest MAIN-world entry, `notes/`. Bump to 1.28. (Branch divergence previously destroyed the state/handoff features for a week of debugging.)
2. **Refactor Gemini-specific code out of `content.js`/`background.js`** — proposed interface: module hooks (`gemini.processCitationChips(doc)`, `gemini.initPageHooks()`, `gemini.onExternalMessage(ev)`) dispatched by `content.js` to the _matched_ module only; move `stableChipKey`, chip loop, citation caches, mouseover/relay listeners into `gemini.js`. `background.js` is ~95% generic (only `gemini_metadata` naming is Gemini-flavored). Motivation: `make_plugin.sh` shar regeneration should package a generic core + modules; alternatively just update `make_plugin.sh`'s file list to include the new files. Decide approach before starting; the module-registry pattern (`ForensicModules`) already exists.
3. **Live-reload junk round** — storage-backed prompt dedupe (sketched earlier); note genuine new rounds must still log.
4. **Open question:** tested session was also saved to NotebookLM; unsaved-session DOM assumed identical (save is account-side, not DOM-side) — verify once on a fresh unsaved chat. NotebookLM-native sessions are a separate module's problem.
5. **Deferred:** sub-citation exact labels (dialog parse; `anchorHtml` relay hook already in place); `media-1.bin`/licensed-image cleanup is done via skip rule; active-content export (user request, unspecified); Playwright automation of the capture pass (needs Google auth in automated browser).

## Debugging toolkit

`node --check` (structure) + VSCodium Problems (unmatched braces / TDZ) + breadcrumbs (behavior). `grep ChipResolve` = resolve-side audit; `grep Associated` = capture-side audit. Cache dumps: service-worker console `chrome.storage.local.get(null, d => copy(JSON.stringify(d,null,2)))`. Never trust memory over `diff` — four merge casualties this session were all found by full-file audits.

