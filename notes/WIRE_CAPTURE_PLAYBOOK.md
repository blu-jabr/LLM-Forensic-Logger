# WIRE_CAPTURE_PLAYBOOK.md

----

# `notes/WIRE_CAPTURE_PLAYBOOK.md` — paste-ready

Saved where the other durable notes live (`rescue_attachments.py`, `syntax_check.sh`). It's written to outlive the zai build: a future session for *any* target should be able to execute the discovery method and build from the contracts without re-deriving any of it.

````markdown
# Wire-Capture Playbook — ground truth beyond the DOM

Applies to every LLM target module. Distills the z.ai discovery (2026-09-29/30,
sessions f369c1e3/70e298ec) into a repeatable method plus the architecture and
contracts for capturing it. Cross-references: HOWTO_add_new_LLM_model.md
(deviation ledger, module conventions), modules/zai.js (reference
implementation), modules/inject_main_world.js (MAIN-world precedent).

---

## 1. Core principle

**The DOM is the rendering; the chat-data API response is the record.**

The z.ai case proved the DOM alone under-captures in ways no amount of
selector work fixes:

```jsonc
// z.ai: POST /api/v1/chats/{chatId}/messages/batch  →  200 OK
// (fired per batch as the SPA paginates; merge responses per chat)
{
  "chat_id": "f369c1e3-…",
  "data": {
    "<message-uuid>": {
      "role": "user" | "assistant",
      "content": "typed text of user message",          // ← cross-check vs DOM
      "content_blocks": [                                // assistant messages:
        { "type": "reasoning", "content": "…",           //   FULL thinking text —
          "started_at": 1790666285 },                    //   no expand/restore needed
        { "type": "text", "content": "…" }               //   full response text
      ],
      "files": [                                          // user messages with
        {                                                 //   attachments:
          "id": "b368c26d-…",                             //   CDN UUID
          "filename": "Poster.2026-02-21.v2.InstallFest.pdf",  // original name
          "meta": {
            "content_type": "application/pdf",
            "size": 117963,
            "cdn_url": "https://z-cdn-media.chatglm.cn/files/<uuid>.pdf?auth_key=…"
          }                                               //   ← FRESH signed URL
        }
      ],
      "usage": {                                          // REAL token metrics
        "prompt_tokens": 18763, "completion_tokens": 1574,
        "prompt_tokens_details": { "cached_tokens": 13824 }
      },
      "model": "x-preview-l",       // INTERNAL id — differs from UI label
      "created_at": 1790666271, "updated_at": 1790666324,
      "done": true
    }
  },
  "message_version": 1
}
```

Facts the wire gave us that the DOM could not:
- thinking text for every historical round (DOM unmounts collapsed blocks)
- fresh signed attachment URLs incl. PDFs (DOM shows no URL for doc chips)
- exact UUID→original-filename mapping (downloads arrive UUID-named)
- true token usage (vs our word-count estimates), cached-token counts
- internal model id vs display label — the divergence is forensic signal
- server-side timestamps incl. reasoning duration

## 2. The three-artifact divergence proof (transparency audit)

For any prompt-capture question, THREE artifacts exist and must be compared:

1. **Wire request** — the completion POST body (DevTools → Network → Payload →
   View source; never Copy-as-cURL — it embeds the auth token).
2. **Wire record** — the chat-data response (this playbook's subject).
3. **DOM transcript** — the rendered bubble our logger already captures.

z.ai result: request and record both LACK the wrapper the model receives →
the wrapper is composed transiently at inference, client-invisible, and the
model's own verbatim reproduction is the only possible evidence. Any service
where these three disagree has a transparency bug; document it the same way
(bug report filed 2026-09-30 — see ledger addendum, "Known external site bug").

## 3. Discovery method (per service, ~1 hour, zero code)

1. Reload the target page with DevTools → Network open, **Preserve log** on,
   filter cleared. The chat-data request fires during load — record from t0.
2. **Response-body search**: Network panel magnifier (Ctrl-F in panel) →
   search a distinctive string: an attachment filename, a URL signature param
   (`auth_key`, `X-Amz`, `SAS`), or known message text. (URL-filter misses
   response bodies; the magnifier searches them.)
3. Identify the endpoint: request path, method (GET or POST — z.ai's is a
   paginated POST …/messages/batch; others may be one-shot GETs).
4. Characterize the response shape (save a sample; note per-message keys,
   file arrays, reasoning fields, usage blocks, model ids).
5. Determine minting behavior: are signed URLs in the SSR document?
   (`document.documentElement.outerHTML` probe) or only in API responses?
   How fast do they expire? (z.ai: ~8 minutes — measured from auth_key epoch
   vs click time. Do NOT assume a lifetime; measure it.)
6. Note pagination: does the endpoint return everything once, or batches on
   scroll? (Receiver must MERGE batches; merge by message UUID is idempotent.)

## 4. Capture architecture (generalizes inject_main_world.js)

```
MAIN world (per-service injector, document_start — must precede app code):
  hook fetch AND XMLHttpRequest (site-dependent; check Network initiator)
  filter: response of the chat-data endpoint
  relay:  window.postMessage({type:'FL_WIRE_CHATDATA', chatId, text}, '*')
          (relay responseText as a STRING; parse in the isolated world)

isolated world (module):
  window.addEventListener('message', …) → parse → MERGE per chatId
  → wireData = { messagesByUuid, filesByUuid: {uuid → {cdn_url, filename,
    content_type, size}}, usageByUuid, modelIds }
  buildRound attaches metadata.wire (below); bulkPreExtract resolves
  attachment URLs via filesByUuid → existing FETCH_ASSET two-tier fetch
```

Relay contract: JSON-serializable data only, strings preferred (survive the
boundary trivially); hooks are PASSIVE (observe + relay; never modify app
traffic); every hook body wrapped in try/catch that ALWAYS returns the
original call's result. Filter on response SHAPE, not just path — z.ai:
`text.includes('"content_blocks"') && text.includes('"cdn_url"')` — robust to
endpoint renames; log the URL path when it fires so the shape filter can be
tightened later.

## 5. Round metadata contract (what buildRound gains)

```jsonc
"wire": {
  "captured": true,
  "modelInternal": "x-preview-l",          // vs metadata.model (UI label)
  "usage": { "prompt_tokens": 18763, "completion_tokens": 1574 },
  "reasoningChars": 2411,                  // from content_blocks[type=reasoning]
  "promptCrossCheck": "match" | "mismatch" // DOM prompt vs wire content
                                            // (whitespace-normalized prefix
                                            //  compare; mismatch = site rewrote
                                            //  the message — its own finding)
}
```

DOM stays PRIMARY (forensic principle: record what the page showed); wire
fills gaps and corroborates. Where DOM thinking is missing/collapsed, wire
reasoning may backfill — prefer marking provenance
(`thinkingSource: "wire"`) over silent substitution.

## 6. Named failure classes (solved on zai — check every new target)

| Failure class | zai solution | Likely on |
|---|---|---|
| Optimistic empty assistant mount → frozen-empty round via dedupe | extract() deferral (return null; dedupe stays unset) | ChatGPT, Claude, Gemini |
| Collapsed thinking unmounts | expand/restore harvester; retired by wire reasoning | Claude, ChatGPT o-series, Gemini 2.5 |
| Asset fetch CORS-blocked | FETCH_ASSET: SW fetch ignores page CORS for hosts in host_permissions; module declares its CDN in header | all |
| Attachment URL never in DOM | wire files[] → fetch → stamp chip (anchor-shaped token) | ChatGPT (SAS), Claude (S3), Gemini (LH3) |
| UI truncation of long content | verify full text in DOM before trusting capture | all |
| Signed-URL expiry | measure lifetime; harvest at render time on fresh page; never store-and-refetch | all (lifetimes VARY — z.ai ~8 min) |
| Virtualization unknown | B2 bulk count vs true session length | all bulk paths |
| Transcript ≠ wire payload | three-artifact audit (§2) | unknown until probed |

## 7. Sequencing for the next module (wire-first)

OLD order (DOM samples first) left the richest source last. NEW order:

1. **Wire discovery** (§3, ~1 h, no code) — find the chat-data endpoint,
   save a sample, measure URL lifetimes, note pagination.
2. **DOM samples** (per HOWTO process notes) — map the rendering.
3. **Build** with both maps: module skeleton from zai.js conventions
   (guarded, setStatus, per-round isolation, anchor-shaped tokens,
   header-owned permissions) + injector from §4 + metadata from §5.

Per-service expectations (verify by §3, don't assume):

| Service | Expected endpoint class | Special notes |
|---|---|---|
| ChatGPT | `/backend-api/conversation/{uuid}` | Azure SAS attachment URLs (expiring); o-series reasoning in message map |
| Claude | `/api/organizations/…/chat_conversations/{uuid}` | thinking blocks in history; S3-signed files; artifacts |
| Gemini | `batchexecute` RPCs | hybrid-encoded responses — parse carefully; existing MAIN-world injector is the hook host; biggest win = thinkingHtml (currently "") |
| NotebookLM | notebook/data RPCs | source metadata, citations |
| Google Flow | generation RPCs | generated-media URLs likely exist ONLY here — same method answers the media-capture question |

## 8. What does NOT transfer

- Selectors, endpoint paths, auth mechanics (per-service, always re-derive).
- The Bits UI dialog contract — EXCEPT other Open WebUI forks (fingerprint:
  `/api/v1/auths/`, `.chat-user`/`.chat-assistant`, `data-dialog-close`,
  shadcn-svelte tokens). Check fingerprints before assuming.
- The z.ai wrapper bug itself (site-specific) — but the CLASS (server-side
  prompt mutation invisible to client) is now a standing probe (§2).

## 9. Open z.ai items riding on this build (state at time of writing)

- Phase 2′ build: injector + receiver + PDF branch + metadata.wire (spec'd,
  endpoint confirmed: POST /api/v1/chats/{id}/messages/batch).
- Rescue script upgrade: exact filename join from filesByUuid.
- expand/restore thinking harvester demotes to FALLBACK once wire thinking
  flows.
````

# Day complete

The document closes the loop: this session produced one working module, one filed bug report, a unified naming scheme, recovery tooling, a hardened manifest generator — and now the playbook that makes the seventh module as cheap as the second. It's the difference between having solved z.ai and knowing how to solve the next six.

Board for next session, unchanged: **Track 2 Phase 2′ build** (inject_zai_wire.js + receiver + PDF branch + metadata.wire — endpoint confirmed, spec final), generate_manifest verification pair (after the zai.js CDN header line), reload-dedupe, `selectorsVerified` flips, both long-session B2 checks. Plus the D14 ledger entry when the build lands.

Good night — solid day's work.
