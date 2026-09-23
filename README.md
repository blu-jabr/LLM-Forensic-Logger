# LLM-Forensic-Logger

A Manifest V3 Chromium extension that performs forensic logging of LLM chat sessions to the local filesystem. Every round of a conversation — the user's prompt, the model's thinking, and the model's response — is captured as GitHub-flavored Markdown, accompanied by JSON metadata for drift/hallucination analysis, a pristine XHTML snapshot of the DOM, and downloaded media. Nothing leaves the machine: no telemetry, no network calls, no accounts.

```text
~/Downloads/LLM-Forensic-Logger/
└── 2026-09-23/
    ├── flush.5c176eed-....2026-09-23.00-49-52.sugarloaf.00000001.md      # round log (GFM)
    ├── flush.5c176eed-....2026-09-23.00-49-52.sugarloaf.00000001.json    # metrics + provenance
    ├── flush.5c176eed-....2026-09-23.00-49-52.sugarloaf.00000001.xhtml   # pristine DOM snapshot
    ├── flush.5c176eed-....2026-09-23.00-49-52.sugarloaf.00000001.d/      # media for this round
    │   └── media-1.jpg
    ├── state.5c176eed-....json                                           # rolling cumulative state
    ├── handoff.5c176eed-....md                                           # mechanical session summary
    ├── citations.{chatId}.json                                           # citation master index
    └── debug.2026-09-23.00-49-52.sugarloaf.log                           # breadcrumb audit trail
```

## Supported targets

| Target | Module | Notes |
|---|---|---|
| Google Gemini | `modules/gemini.js` | Most complete: citations, media, thinking hooks |
| ChatGPT | `modules/chatgpt.js` | Includes o-series reasoning blocks |
| Claude | `modules/claude.js` | Includes thinking blocks |
| NotebookLM | `modules/notebooklm.js` | |
| Duck.ai | `modules/duckai.js` | |
| Google Search AI Overviews | `modules/google-search-ai-logger.js` | |
| Google Flow (labs.google) | `modules/google_flow.js` | Video generation; prompt + result metadata |

Other LLMs are added by dropping a module file into `modules/` (see [Adding a target](#adding-a-target)).

**Note**: As of this initial release, Gemini is the only complete module. Other modules are just placeholders for now.

## Installation

1. Clone the repo.
2. Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, select the repo directory.
3. Right-click the extension icon → **Options** → enter your hostname (the equivalent of `uname -n | cut -d. -f1`) → Save. It is cached permanently in extension storage.

Requires Chromium ≥ 111 (MAIN-world content script injection).

## Usage

### Live logging (automatic)

Once installed, every round in a supported LLM tab is logged as it completes — no action needed. A 5-second startup grace period and scroll suppression prevent junk rounds from page loads and virtual-scroller churn.

### Bulk session logging

1. **Reload the page**, then scroll through the entire conversation to the top (the virtual scroller only holds ~10 rounds in the DOM at a time; reload → scroll-through is the full-capture ritual).
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

Click **Download Debug Log** to export the extension's breadcrumb audit trail (content-script + service-worker events, timestamped) as a single `.log` file. Export-then-clear: each log covers everything since the previous export.

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
│ modules/inject_main_world.js   wraps window.open, patches a.click(),         │
│   listens click + auxclick (middle-button) via composedPath(), relays         │
│   citation navigations to the isolated world                                  │
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

## Gemini DOM notes

Hard-won facts encoded in the code — do not relearn them:

1. **Citation chips** (`<source-inline-chip>`) are Angular buttons, not anchors. Target URLs are absent from the DOM at rest and injected lazily (~1s after hover, when the preview card renders). Middle-click before injection silently does nothing.
2. **Middle-click fires `auxclick`**, not `click`, and the navigation is browser-native (no `window.open`) — `auxclick` + `composedPath()` is the only interception point.
3. **`p-rc_<hash>-<ordinal>` container ids**: ordinals shift on every re-render; the chunk hash and within-chunk relative order are stable. Keys are stamped onto chips as `data-fl-cid`/`data-fl-skey` attributes **in the live DOM** because paragraph ids do not survive HTML re-parse (block-in-`<p>` re-parenting by `DOMParser`).
4. **Virtual scroller**: only ~10 rounds exist in the DOM at a time. Reload → scroll through → bulk immediately.
5. **`#:~:text=` fragments are generated by Gemini** — they encode the span Gemini used, not page anchors. Variance between sessions is forensic signal.
6. Gemini aggressively calls `console.clear()`; the extension stubs it and routes breadcrumbs to a file-based debug log.
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

> ⚠️ **`manifest.json` is hand-maintained.** The historical `generate_manifest.sh` regenerates the arrays from module headers but will strip icons, `unlimitedStorage`, and the MAIN-world content-script entry. Do not run it against the current manifest.

## Development

- **Syntax check before every reload:** `bash notes/syntax_check.sh` — silence means all `.js` files parse. This catches the brace/merge-error class; the breadcrumbs catch the behavioral class.
- **After reloading the extension, refresh the target tab** — otherwise the old content script throws `Extension context invalidated`.
- **Three consoles:** page DevTools (content scripts + module logs), `chrome://extensions` → *service worker* (background logs, storage API), popup right-click → Inspect (popup logs). Verbose level shows the MAIN-world injector's `[FL:inject]` debug lines.
- **Cache dumps:** service-worker console → `chrome.storage.local.get(null, d => copy(JSON.stringify(d,null,2)))`.
- **Audit greps:** `grep Associated` (capture side) and `grep ChipResolve` (resolution side) in the debug log reconcile every citation capture against its resolution.
- `notes/` contains reusable console snippets (cache purge, chip inventory, storage dump).

## Known limitations

- Round timing (`generation_duration_ms`) is approximate for bulk-logged historical sessions (0 by design).
- Uploaded attachments on Gemini keep their CDN URL in the XHTML but not their original filename — Google strips it from the client-side DOM (recoverable via `myactivity.google.com` cross-reference).
- Sub-citation *labels* within multi-citation chips are approximate (first source's title); URLs are exact. Exact labels require parsing the sources dialog (deferred; the relay hook for it exists).
- Citation capture is manual by design. (Playwright automation is a future possibility; requires Google auth in an automated browser.)
- Extension storage is per-browser-profile; clearing site data or removing the extension erases caches, sessions, and the hostname.

## Repository layout

```
LLM-Forensic-Logger/
├── manifest.json              # v1.28 — HAND-MAINTAINED
├── background.js              # service worker: queue, state, handoff, index, media, debug
├── content.js                 # orchestrator: live/bulk extraction, HTML→MD, citations
├── popup.html / popup.js      # Log Entire Session · Generate Handoff · Download Debug Log
├── options.html / options.js  # hostname configuration (cached)
├── modules/
│   ├── index.js               # window.ForensicModules = {}
│   ├── inject_main_world.js   # MAIN-world navigation interceptor (Gemini)
│   ├── gemini.js              # includes stampChips() + getSessionName()
│   ├── chatgpt.js  claude.js  duckai.js  notebooklm.js
│   ├── google-search-ai-logger.js  google_flow.js
├── generate_manifest.sh       # legacy; see warning above
├── notes/                     # console snippets, storage dumps, syntax_check.sh
└── icons/
```

## Privacy & forensic stance

All processing and storage is local. The extension makes no network requests of its own; media downloads use the browser's download manager against URLs already present in the page. Logs are written under the user's Downloads directory in a `LLM-Forensic-Logger/` namespace. The design principle throughout: **record what the page actually showed, preserve original URLs alongside local copies, flag uncertainty instead of resolving it silently, and never summarize what can be quoted.**
