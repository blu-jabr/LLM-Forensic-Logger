# LLM-Forensic-Logger

A Manifest V3 Chromium extension that performs forensic logging of LLM chat sessions to the local filesystem. Every round of a conversation — the user's prompt, the model's thinking, and the model's response — is captured as GitHub-flavored Markdown, accompanied by JSON metadata for drift/hallucination analysis, a pristine XHTML snapshot of the DOM, and downloaded media. Nothing leaves the machine: no telemetry, no network calls, no accounts.

```text
~/Downloads/LLM-Forensic-Logger/
└── 2026-09-29/
    ├── flush.72dd89c0-….zai.2026-09-29.10-15-06.sugarloaf.00000001.md      # round log (GFM)
    ├── flush.72dd89c0-….zai.2026-09-29.10-15-06.sugarloaf.00000001.json    # metrics + provenance
    ├── flush.72dd89c0-….zai.2026-09-29.10-15-06.sugarloaf.00000001.xhtml   # pristine DOM snapshot
    ├── flush.72dd89c0-….zai.2026-09-29.10-15-06.sugarloaf.00000001.d/      # media + attachments
    │   ├── nessus.v3.txt
    │   └── alien.prime.jpg
    ├── state.72dd89c0-….zai.2026-09-29.10-15-07.sugarloaf.00000005.json   # rolling cumulative state
    ├── handoff.72dd89c0-….zai.2026-09-29.10-16-00.sugarloaf.md            # mechanical session summary
    ├── download-manifest.2026-09-29.10-16-41.sugarloaf.json               # all profile download records
    ├── citations.{chatId}.json                                            # citation master index (when citations exist)
    └── debug.2026-09-29.10-16-44.sugarloaf.txt                            # breadcrumb audit trail
```

## Supported targets

| Target | Module | Notes |
|---|---|---|
| Google Gemini | `modules/gemini.js` | Most complete: citations, media, thinking hooks |
| Z.AI (chat.z.ai) | modules/zai.js | Complete: rounds, thinking (auto-expand/restore in bulk), text+image attachment harvesting, per-round status |
| ChatGPT | `modules/chatgpt.js` | Includes o-series reasoning blocks |
| Claude | `modules/claude.js` | Includes thinking blocks |
| NotebookLM | `modules/notebooklm.js` | |
| Duck.ai | `modules/duckai.js` | |
| Google Search AI Overviews | `modules/google-search-ai-logger.js` | |
| Google Flow (labs.google) | `modules/google_flow.js` | Video generation; prompt + result metadata |

Other LLMs are added by dropping a module file into `modules/` (see [Adding a target](#adding-a-target)).

**Note**: Gemini and Z.AI are complete modules. The remaining modules are first drafts and likely need extensive rework against live DOM samples (see HOWTO_add_new_LLM_model.md for the process).

## Installation

1. Clone the repo.
2. Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, select the repo directory.
3. Right-click the extension icon → **Options** → enter your hostname (the equivalent of `uname -n | cut -d. -f1`) → Save. It is cached permanently in extension storage.

Requires Chromium ≥ 111 (MAIN-world content script injection).

## Usage

### Live logging (automatic)

Once installed, every round in a supported LLM tab is logged as it completes — no action needed. A 5-second startup grace period and scroll suppression prevent junk rounds from page loads and virtual-scroller churn.

### Bulk session logging

1. **Reload the page**, then scroll through the entire conversation to the top (the Gemini virtual scroller only holds ~10 rounds in the DOM at a time; reload → scroll-through is the full-capture ritual. Z.AI: reload and bulk; virtualization unverified at length).


2. Click the extension icon → **Log Entire Session**.
3. Every round is written with fresh session ID and sequence numbers starting at `00000001`.

### Citation capture pass (Gemini)

Gemini does not expose citation URLs in the DOM at rest — they are injected lazily on hover and navigated via browser-native mechanisms. To capture them:

1. Hover a citation chip until its preview card renders (~1s), then **middle-click** it. A background tab opening is the confirmation of capture.
2. Work through every chip you want URLs for. The URLs persist in extension storage keyed by a render-invariant stable key (`{chunkHash}#{rank}`), surviving re-renders, reloads, and browser restarts.
3. Subsequent Log Entire Session runs resolve chips against this cache automatically. Chips never clicked render honestly as bare `[Label]` — a missing URL is never guessed.

### Handoff documents

Click **Generate Handoff Document** to emit a mechanical summary of the session — objective, flagged rounds (drift indicators), chronological prompt log, latest code artifacts, media manifest, and a round-file index — assembled from the lossless transcript with **no LLM summarization**. Designed to onboard a receiving model or human onto a long session: *the file is a map; the round files are the territory.*

### Debug log

Click **Download Debug Log** to export the extension's breadcrumb audit trail (content-script + service-worker events, timestamped) as a single `.txt` file. Export-then-clear: each log covers everything since the previous export.

## Architecture

```
┌────────────────────────── webpage (isolated world) ──────────────────────────┐
│ modules/index.js        initializes window.ForensicModules registry          │
│ modules/<llm>.js        match(host,path) + extract() + bulkExtract()         │
│ content.js              orchestrator: live observer, bulk handler,           │
│                         HTML→Markdown engine, citation resolution, debug bus │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ chrome.runtime.sendMessage
┌──────────────────────────────────▼───────────────────────────────────────────┐
│ background.js (service worker)                                               │
│   serialized log queue · session state · rolling state · handoff generator   │
│   citation index · media download + MIME verification · debug log store      │
└──────────────────────────────────────────────────────────────────────────────┘
         ▲ postMessage relay (cross-frame)
┌────────┴─────────────────── webpage (MAIN world) ────────────────────────────┐
│ modules/inject_main_world.js — wraps window.open; relays anchor navigations  │
│   (left/middle click) from the page's own context to the isolated world      │
│   via click + auxclick capture listeners and composedPath()                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Why a MAIN-world injector?

Content scripts run in an isolated world: they share the page's DOM but not its JavaScript. Gemini's citation navigation happens in the page's own context (lazy anchor injection, `window.open`, browser-native middle-click handling), so interception requires a script in the MAIN world (`"world": "MAIN"`, `all_frames: true`, `document_start`) relaying events via `postMessage`. See [Gemini DOM notes](#gemini-dom-notes).

### Citation resolution order

Per chip, `content.js` resolves URLs in this order, recording provenance in the round JSON:

1. **`stable-key`** — `{chunkHash}#{rank}` cache (precise per citation instance, render-invariant)
2. **`container-id`** — legacy per-render key (fallback)
3. **Title cache** — hover-card harvest + prefix matching; **only accepted when the chip's title is unique in the round** (shared titles like "Wikipedia" are ambiguous by design and stay bare rather than resolve wrongly)
4. **Nested anchor** — rare; a real `<a>` inside the chip always wins

Every URL carries `url_match_type` provenance. Multi-citation chips (one chip, several sources) store and emit URL arrays.

## JSON metadata (per round)

```jsonc
{
  "session_id": "…", "session_name": "…", "round_number": 3,
  "timestamp_logged_utc": "…", "hostname": "…",
  "gemini_metadata": {
    "testIds": ["uploaded-img", "…"],
    "citation_chips": [{
      "source_title": "UNDP Climate Promise - …",
      "url": "https://climatepromise.undp.org/…#:~:text=…",
      "stable_key": "491db16e7155877b#0",
      "url_match_type": "stable-key",
      "response_id": "r_…", "conversation_id": "c_…", "chunk_id": "rc_…"
    }]
  },
  "metrics": {
    "resource_usage": { "prompt_word_count": 44, "response_word_count": 1061,
                        "generation_duration_ms": 0, "media_files_logged": 2, "…": "…" },
    "drift_and_hallucination_indicators": {
      "hedging_language_count": 1, "self_correction_count": 0, "lexical_diversity": 0.53 }
  },
  "system_info": { "url_origin": "https://gemini.google.com/app/…" }
}
```

Service metadata nests under `gemini_metadata` for all services (frozen-file key, kept for consumer compatibility)."

## Extension storage schema (chrome.storage.local)

|Key|Shape|Semantics|
|---|---|---|
|`sessions`|`{chatId: {SESSION_ID, round_number}}`|SESSION_ID persists for live logging; a fresh UUID is minted at each bulk run (packet reset).|
|`sessionPackets`|`{chatId: {session_id, session_name, rounds[]}}`|Working transcript for state/handoff assembly; reset at bulk start; consecutive-duplicate rounds deduped.|
|`citationIdCache`|`{stable_key: url \| url[]}`|Authoritative Gemini citation capture store (`chunkhash#rank` keys), survives reloads/restarts.|
|`citationUrlCache`|`{normTitle: url}`|Hover-card + click harvest; unique-title prefix matching at resolve time.|
|`citationIndexes`|`{chatId: {stable_key: {source_title, urls[], cited_in[], status, match_type, …}}}`|Cumulative citation master index, emitted as `citations.{chatId}.*.json`.|
|`bulkStatus`|`{service, message, level, at}`|Transient popup progress line (D9).|
|`hostname`|string|Machine label for filenames; set manually via Options.|
|`flDebugLog`|string[]|Breadcrumb buffer backing the debug export (export-then-clear).|

## Gemini DOM notes

Hard-won facts encoded in the code — do not relearn them:

1. **Citation chips** (`<source-inline-chip>`) are Angular buttons, not anchors. Target URLs are absent from the DOM at rest and injected lazily (~1s after hover, when the preview card renders). Middle-click before injection silently does nothing.
2. **Middle-click fires `auxclick`**, not `click`, and the navigation is browser-native (no `window.open`) — `auxclick` + `composedPath()` is the only interception point.
3. **`p-rc_<hash>-<ordinal>` container ids**: ordinals shift on every re-render; the chunk hash and within-chunk relative order are stable. Keys are stamped onto chips as `data-fl-cid`/`data-fl-skey` attributes **in the live DOM** because paragraph ids do not survive HTML re-parse (block-in-`<p>` re-parenting by `DOMParser`).
4. **Virtual scroller**: only ~10 rounds exist in the DOM at a time. Reload → scroll through → bulk immediately.
5. **`#:~:text=` fragments are generated by Gemini** — they encode the span Gemini used, not page anchors. Variance between sessions is forensic signal.
6. Gemini aggressively calls `console.clear()` — the extension stubs it and routes breadcrumbs to a file-based debug log. (Chromium also auto-suppresses repeated `alert()` dialogs, so a runaway page can't wedge the logging flow behind modal popups.)
7. A chip may aggregate multiple citations; a paragraph container may hold multiple chips. Both cases produce URL arrays.

## Adding a target

Create `modules/<name>.js` following the existing pattern:

```javascript
// @match *://example.com/*
// @host_permissions *://example.com/*
(function() {
    const match = (host, path) => host.includes('example.com');
    const extract = () => { /* latest round → {promptHtml, thinkingHtml, responseHtml} */ };
    const bulkExtract = () => { /* all rounds → array of the same */ };
    window.ForensicModules.example = { match, extract, bulkExtract };
})();
```

Then add the file to the `content_scripts.js` array in `manifest.json` and add the match patterns to `content_scripts.matches`.

**manifest.json is header-owned**. `generate_manifest.sh` regenerates `content_scripts[0].js` matches and host_permissions from module header comments (`// @match`, `// @host_permissions`).  It is dry-run by default and refuses to write if any current manifest entry is owned by no module header (orphan guard), backs up before writing. To add a service: declare its patterns in the module header, run `./generate_manifest.sh`, review,then `./generate_manifest.sh --write`.  Non-entry-[0] wiring (e.g. the MAIN-world injector) remains hand-maintained.

## Development

- **Syntax check before every reload:** `bash notes/syntax_check.sh` — silence means all `.js` files parse. This catches the brace/merge-error class; the breadcrumbs catch the behavioral class.
- **After reloading the extension, refresh the target tab** — otherwise the old content script throws `Extension context invalidated`.
- **Three consoles:** page DevTools (content scripts + module logs), `chrome://extensions` → *service worker* (background logs, storage API), popup right-click → Inspect (popup logs). Verbose level shows the MAIN-world injector's `[FL:inject]` debug lines.
- **Cache dumps:** service-worker console → `chrome.storage.local.get(null, d => copy(JSON.stringify(d,null,2)))`.
- **Audit greps:** `grep Associated` (capture side) and `grep ChipResolve` (resolution side) in the debug log reconcile every citation capture against its resolution.
- `notes/` contains reusable console snippets (cache purge, chip inventory, storage dump).
- **Hosts**: development happens on whichever workstation is current (e.g. `sugarloaf`); `seacouver` is the permanent git origin. Filenames embed the _hostname where the round was logged_ (`options` → `hostname` field), so multi-host use produces self-identifying output; it is not a repo identifier.


## Known limitations

- Round timing (`generation_duration_ms`) is approximate for bulk-logged historical sessions (0 by design).
- Uploaded attachments on Gemini keep their CDN URL in the XHTML but not their original filename — Google strips it from the client-side DOM (recoverable via `myactivity.google.com` cross-reference).
- Sub-citation *labels* within multi-citation chips are approximate (first source's title); URLs are exact. Exact labels require parsing the sources dialog (deferred; the relay hook for it exists).
- Citation capture is manual by design. (Playwright automation is a future possibility; requires Google auth in an automated browser.)
- Extension storage is per-browser-profile; clearing site data or removing the extension erases caches, sessions, and the hostname.

**Z.AI specifics**:

- Attachment CDN signatures are short-lived (~minutes, observed ~8): harvesting must happen at render time on a freshly loaded page; stored URLs 403 for every fetcher, including `chrome.downloads`.
- PDF attachments are recorded (filename/kind/size, honest placeholder) but not harvested — the chip triggers a direct download from a URL that never appearsin the DOM.
- The site injects a server-side wrapper (incl. an unconditional "Please help me:" line) around text attachments before model inference; the wrapper is invisible in the transcript, so the DOM capture is faithful to what the page showed but not to what the model received (reported upstream 2026-09-30). A MAIN-world wire-capture hook is the planned remediation.
- Whether the transcript virtualizes at long lengths is unverified (bulk coverage confirmed only at ~39 rounds).

## Repository layout

```
LLM-Forensic-Logger/
├── manifest.json              # v1.32 — header-owned; regenerate via generate_manifest.sh
├── ...
│   ├── gemini.js              # includes stampChips() + getSessionName()
│   ├── zai.js                 # rounds, thinking, attachment harvesting (text + image)
│   ├── chatgpt.js  claude.js  duckai.js  notebooklm.js
│   ├── google-search-ai-logger.js  google_flow.js
├── generate_manifest.sh       # header-driven manifest regeneration (dry-run default)
├── notes/                     # console snippets, syntax_check.sh, rescue_attachments.py
```

## Privacy & forensic stance

All processing and storage is local. The extension makes no third-party network requests; its only outbound fetches are attachment files from the chat service's own asset CDN (scoped by host_permissions), performed during explicit harvesting. Media otherwise downloads via the browser's download manager against URLs already present in the page.

Logs are written under the user's Downloads directory in a `LLM-Forensic-Logger/` namespace. The design principle throughout: **record what the page actually showed, preserve original URLs alongside local copies, flag uncertainty instead of resolving it silently, and never summarize what can be quoted.**
