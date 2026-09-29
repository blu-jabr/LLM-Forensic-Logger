# How to add a new LLM service (v1.32 architecture)

I am building a Chromium MV3 extension that logs LLM chats round-by-round to
local files. You will generate ONE new module file for a service. Do not
modify content.js or background.js — they are service-agnostic and frozen.
All service-specific logic belongs in the new module.

Service: [INSERT LLM NAME]
URL: [INSERT LLM URL]
Module key: window.ForensicModules.[insert_module_name]   (valid JS identifier)
Module file: modules/[insert_module_name].js

## Architecture

- modules/index.js loads first: defines window.ForensicModules = {} and the
  shared debug helpers dlog(...)/derr(...), callable from any module.
- Each module is an IIFE that registers itself on window.ForensicModules.
- content.js loads last: finds the first module whose match() succeeds,
  awaits extract() for live logging (MutationObserver + debounce upstream),
  or awaits bulkExtract() for the manual "Log Entire Session" button.
- Media download, HTML->markdown conversion, and file writing all happen in
  content.js/background.js. The module only extracts DOM fragments.

## Required module contract

Header comments (parsed by tooling; keep them):

    // @match <match pattern for the service>
    // @host_permissions <same pattern>

Exported functions:

1. match(host, path) -> boolean. Host/path test for the service.
2. extract() -> object or Promise of object. Finds the LATEST user prompt
   and latest model response in the live DOM. Returns:

       { promptHtml, thinkingHtml, responseHtml, roundHtml, metadata }

   - promptHtml / thinkingHtml / responseHtml: SERIALIZED HTML STRINGS
     (innerHTML/outerHTML of clones), not innerText. thinkingHtml may be "".
   - roundHtml (optional): outerHTML of the whole turn as shown; used for
     the .xhtml forensic dump.
   - metadata (optional): service-specific structured data (ids, citations).
   - May be async; content.js awaits it.
   - Clean UI chrome out of the clones (buttons, icons, action bars).

3. bulkExtract() -> array of the same objects (one per round, oldest first),
   or a Promise of it. May be async. Must handle virtualized scrolling:
   if the DOM only renders recent rounds, say so in your reply and ask the
   user how the service paginates history.

Optional hooks (all call sites are guarded — omit if unneeded):

4. getSessionName() -> string. Sidebar/session title, else content.js falls
   back to document.title.
5. processParsedDoc(doc, ctx) — called by content.js on each DOMParser-parsed
   section BEFORE markdown conversion. May rewrite the parsed doc (e.g.
   convert custom elements to markdown links) and push structured records
   into ctx.chips (an array). ctx = { isPromptSection, chips }. See
   modules/gemini.js (citation-chip pipeline) for the reference
   implementation.
6. bulkPreExtract() — async, called once before bulkExtract() (e.g. to run
   an active harvester).

## Also required (not optional)

- manifest.json, version [CURRENT_VERSION] -> bump version:
    a. add the service's match patterns to "host_permissions"
    b. add them to "content_scripts"[0]."matches"
    c. add "modules/[insert_module_name].js" to "content_scripts"[0]."js",
       AFTER "modules/index.js" and BEFORE "content.js"
- make_plugin.sh: add the new file to the FILES list.
- Run node --check on the new file; then ./make_plugin.sh and confirm the
  chunk count matches.
- Declare the service's patterns in the module header (@match / @host_permissions).
- Run `./generate_manifest.sh` (dry run) — review — then `--write`. Do not hand-edit
  `manifest.json``; the orphan guard is the drift detector.
- `make_plugin.sh`: add the new file to the FILES list.
- popup.js: add the host to the SUPPORTED regex (D8).
- Run node --check on the new file; then ./make_plugin.sh and confirm the chunk count.

(This also updates D8's "4th touchpoint" framing: the per-service checklist is now **module file with headers → make_plugin FILES → popup SUPPORTED**, with manifest generation automated.)

## Example skeleton (isolated world, sync extract)

    // @match *://example-chat.example/*
    // @host_permissions *://example-chat.example/*
    (function() {
        const match = (host, path) => host.includes('example-chat.example');

        const cleanNode = (node) => {
            if (!node) return "";
            const clone = node.cloneNode(true);
            clone.querySelectorAll('button, svg, [class*="icon"]').forEach(el => el.remove());
            return clone.outerHTML || clone.innerHTML;
        };

        const findTurns = () => { /* return [{promptEl, responseEl}, ...] oldest first */ };

        const extract = () => {
            const turns = findTurns();
            const last = turns[turns.length - 1];
            if (!last) return null;
            return {
                promptHtml: cleanNode(last.promptEl),
                thinkingHtml: "",
                responseHtml: cleanNode(last.responseEl),
                roundHtml: last.turnEl ? last.turnEl.outerHTML : "",
                metadata: {}
            };
        };

        const bulkExtract = () => findTurns().map(t => ({
            promptHtml: cleanNode(t.promptEl),
            thinkingHtml: "",
            responseHtml: cleanNode(t.responseEl),
            metadata: {}
        }));

        window.ForensicModules.[insert_module_name] = { match, extract, bulkExtract };
    })();

## Process notes for this session

- The service's DOM structure may postdate your training data. Do not guess
  selectors from memory alone: ask the user to paste DOM samples (outerHTML
  of one user turn and one response turn from DevTools) before writing the
  final selectors, and state which selectors are verified vs. provisional.
- If the service renders "thinking"/reasoning blocks, capture their HTML in
  thinkingHtml; note whether they are collapsible/hidden at rest.
- Keep all logic in this one module file. If something seems to require
  touching content.js or background.js, stop and say so — there is probably
  an existing hook, or one can be added deliberately.

## Deviation ledger — deliberate frozen-file modifications (current through v1.32)

The architecture froze content.js and background.js. The following aredeliberate, reviewed deviations. New service modules must assume they exist.

|#|File|Change|Why|
|---|---|---|---|
|D1|content.js|3× `console.error` → `derr`|bare console.error bypassed the debug-log pipeline; bulk failures were invisible in exported logs|
|D2|content.js|live payload gains `module: matchedModuleName`|propagates matched module key to background for filenames/packet|
|D3|content.js|bulk payload gains `module: moduleName`|same, bulk path|
|D4|content.js|blob mime→ext map gains `text/*` subtypes + `application/json`|text attachments landed as `.bin`|
|D5|background.js|BASE scheme: `flush.SESSION_ID.SERVICE.dateStr.timeStr.HOSTNAME.seq`; SERVICE sanitized from `payload.module`, derived inside logRound|per-service file identification|
|D6|background.js|packetEntry gains `service: payload.module`; BULK_LOG_SESSION destructures `module` → per-round payloads|handoff reads service from the packet (survives SW restarts)|
|D7|background.js|handoff BASE = `handoff.SESSION_ID.<last.service>.<export date/time>.HOSTNAME`|unified naming; export-time stamp is correct for a file generated later|
|D8|popup.js|SUPPORTED regex must list every service host — a 4th per-service touchpoint (manifest matches, module file, make_plugin FILES, this regex)|popup gates routing BEFORE content scripts are consulted; a missing host silently bulk-logs the wrong tab (observed)|
|D9|popup.js|bulkStatus polling (chrome.storage.local `{bulkStatus:{service,message,level}}`), level-colored: red = errors only|progress visibility during long bulk runs|

Module conventions to copy into new services (see modules/zai.js as reference):

- `setStatus(msg, level)` writing `{bulkStatus}` — optional; labels the popup line
- `guarded(name, fn)` wrapper on exported contract functions — full stacks via derr before rethrowing
- header comment block tracking VERIFIED vs PROVISIONAL selectors, updated as DOM samples arrive
- per-round try/catch inside bulkExtract so one bad round can't kill the run
- active-harvester hooks (`bulkPreExtract`) for UI-only data (chips, viewers)
- Module headers own ALL manifest permissions, including fetch-only ones that 
  never appear in content_scripts.matches (e.g. zai.js declares// @host_permissions  
  *://z-cdn-media.chatglm.cn/* for its asset CDN).generate_manifest.sh enforces this: any manifest entry without a header 
  owner blocks --write.


Process notes learned the hard way:

- After ANY edit: make_plugin.sh → full test-dir repopulation → delete/re-add or reloadextension → refresh target tab. Stale builds masquerade as code bugs (three times).
- Verify what Chrome actually loaded before debugging logic:`chrome.runtime.getManifest()` from the correct extension's SW console.
- One popup click per bulk run; each run resets the packet and mints a new SESSION_ID.
- Get module function stacks via the extension-context console:`await window.ForensicModules.<key>.extract()` / `.bulkExtract()`.

---

## Ledger addendum — v1.30, post asset pipeline + wire investigation (2026-09-30)

Appends to the ledger above. Numbering continues at D10.

| #  | File | Change | Why |
|----|------|--------|-----|
| D10 | manifest.json + background.js + module pattern | `*://z-cdn-media.chatglm.cn/*` added to host_permissions **only** (NOT content_scripts.matches — fetch privilege, not injection). background.js gains `FETCH_ASSET` handler: SW-side fetch → blob → ≤25 MB cap → FileReader data: URL → `{ok, dataUrl, mime}` / `{ok:false, error}`. Module pattern: two-tier fetch — tier 1 in-page `fetch()`, tier 2 `chrome.runtime.sendMessage({type:'FETCH_ASSET'})` → data: URL → blob. | Content scripts are subject to PAGE CORS; the asset CDN sends no ACAO headers (`TypeError: Failed to fetch`). The service worker's fetch ignores page CORS for hosts in host_permissions — the only bypass. Verified end-to-end: 2.6 MB JPEG harvested → `.d/` with original filename. |
| D11 | popup.html + popup.js + background.js | "Export Download Manifest" button + `EXPORT_DOWNLOAD_MANIFEST` handler: `chrome.downloads.search({limit: 100000})` (ALL profile downloads), filter excludes our own `data:`/`blob:`/`chrome-extension:` products, each record carries `cdnMatch` flag + `byExtensionId`. | Recovery tooling for attachments the module could not harvest (user's manual chip clicks land in the download DB). Over-include and let the join decide — a rescue filter that pre-narrows silently loses records (observed: CDN-only filter hid the stray PDF download; default 1000-record cap hid everything older). |
| D12 | background.js | Filename scheme finalization: `state.*` gained the SERVICE token (unified BASE with flush per spec); debug export filename reverted to no-SERVICE, extension `.log`→`.txt`; handoff reads SERVICE from packet (`last.service`, fallback `unknown`). `SERVICE` remains derived inside `logRound` only — scope rule: module-scope `lastService` if ever needed elsewhere. | Unified `flush/state/handoff` BASE = `SESSION_ID.SERVICE.dateStr.timeStr.HOSTNAME`. Two crashes taught the scope rule (`SERVICE is not defined` at debug-export and handoff). |

### Recovery tooling (pairs with D11)

- `notes/rescue_attachments.py <download-manifest.json> [tree-dir]`: joins CDN UUIDs
  (`/files/<uuid>` in manifest `finalUrl`) to round `.json` `assets.images[].src`,
  moves good downloads into the matching `.d/` with original filenames.
  Refuses `text/html` < 4 KB records (expired-signature 403 pages masquerading as
  downloads — observed twice). Prints `UNRESOLVED` rather than guessing; semi-manual
  by design (re-attribution is operator-confirmed).

### Module conventions to copy (zai.js as reference — additions)

- **Attachment chip stamping**: harvested chips get `data-fl-attachment-blob/-name/-mime`;
  failed/skipped chips get `data-fl-attachment-skip=<reason>`. `rewriteAttachmentChips`:
  stamped → `<a href="blob:…" download type>`; unstamped → honest placeholder
  `<span data-fl-attachment=reason>[attachment: name — not captured: reason]</span>`.
  The placeholder also kills the icon-`<img>`-as-media noise in content.js.
- **Chip detection**: text/doc chips carry `img[src*="/icons/<TYPE>.svg"]`; IMAGE chips
  nest a disabled button holding the real thumbnail `<img src="z-cdn-media.chatglm.cn/…">`
  — that thumbnail src is the CURRENT signed URL and is the harvest source. Leaf
  `div.truncate` = filename; uppercase span = KIND; `NN KB` span = size.
- **Bits UI dialog contract** (text-attachment viewer): root
  `div[role="dialog"][data-dialog-content][data-state="open"]`; close via
  `button[data-dialog-close]` (deterministic; Escape as fallback only); title at
  `[data-dialog-title]`; payload at `.whitespace-pre-wrap`. **wait for PAYLOAD fill,
  not dialog mount** — the shell (title included) mounts immediately, content arrives
  via async fetch (~0.5–9 s observed).
- **extract() deferral**: the site mounts an EMPTY assistant shell at send time;
  content.js's 1.5 s debounce can land inside that gap and its C6 duplicate-prompt
  guard would freeze the round empty forever. extract() must return null when the
  paired assistant body is empty/absent — dedup state stays unset, next mutation
  re-captures. Trade-off: prompts stopped before first token don't live-log.
- **expandCollapsedThinking**: test ALL descendant svgs for `-rotate-90` — toggle
  buttons hold TWO svgs (icon + chevron); first-svg querySelector silently matches
  nothing.
- **Asset constraints**: content.js blob cap 10 MB; SW FETCH_ASSET cap 25 MB; signed 
  CDN URLs (`auth_key` epoch) are **short-lived (~minutes; observed ~8 min remaining 
  at click on a fresh page)** — harvest at render time on a freshly loaded page only; 
  stored URLs 403 for every fetcher including chrome.downloads. Signed URLs have been 
  observed captured incidentally in the site's own RUM beacons (aliyuncs) — a useful 
  forensic source; stored URLs 403 for every fetcher including chrome.downloads.
- **setStatus(msg, level)**: level `'error'` reserved for real failures; popup colors
  red only on error, green otherwise, amber for warnings.

### Process notes (additions)

- Patch by replacing WHOLE functions, and derive grep expectations from the delivered
  text, not memory — three half-application incidents (missed rsync; skipped patch
  region; patch region ending before a consumer). After any edit:
  make_plugin.sh → full test-dir repopulation → delete/re-add or reload extension →
  refresh target tab. Stale builds masquerade as code bugs.
- The page console shows what the debug log cannot: Error objects JSON-stringify to
  `{}` through derr. Module contract functions are wrapped in `guarded(name, fn)` so
  `e.stack` travels as a string into the debug log.
- `chrome.downloads.search`: `{limit: N}` is the query property (`maxResults` throws);
  `{query: ['term']}` takes an ARRAY; default result cap is 1000 records — silent
  truncation; records persist after files are deleted from disk.
- DevTools POST capture: the Payload pane's copy drops collapsed nodes — use
  **View source / View decoded + Ctrl+A**, or Export HAR. Copy-as-cURL/fetch embeds
  the auth token — redact before sharing anything.
- Deleting/re-adding the extension wipes chrome.storage.local (hostname, sessions,
  packets, caches) — re-enter the hostname in options BEFORE clicking the test page,
  or the run stamps `unknown-host`.
- Each bulk run resets the packet and mints a new SESSION_ID; one popup click per run.

### Known external site bug (bounds DOM-based capture — reported 2026-09-30)

chat.z.ai injects, server-side, a wrapper around text attachments:
`The document content is:` + `{<filename>：<content>}` blocks + an unconditional
`Please help me:` terminator at the text-attachment section boundary. Invisible in
composer and history; verified on the wire (outgoing POST lacks it; model receives
and reproduces it verbatim). Consequence: **the DOM transcript ≠ the wire payload on
attachment rounds** — every DOM-based logger under-captures. Full report filed with
repro, ordering/two-file probes, and wire evidence. Planned remediation = Track 2:
MAIN-world fetch hook (pattern: modules/inject_main_world.js) capturing completion
POSTs → per-round true submitted payload, plus per-attachment signed file URLs
(retiring the short-signature-lifetime problem).
