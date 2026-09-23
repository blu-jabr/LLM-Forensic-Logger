console.log("[Forensic Logger] New background.js loaded successfully.");

// ─── Debug tracing (module-scope, available to every breadcrumb) ───
const FL_DEBUG = true;

const flLog = [];
const FL_LOG_MAX = 4000;
let flPersistTimer = null;
function bgLog(line) {
  flLog.push(line);
  if (flLog.length > FL_LOG_MAX) flLog.splice(0, flLog.length - FL_LOG_MAX);
  clearTimeout(flPersistTimer);
  flPersistTimer = setTimeout(() => chrome.storage.local.set({ flDebugLog: flLog }), 5000);
}
chrome.storage.local.get(['flDebugLog'], d => { if (d.flDebugLog) flLog.push(...d.flDebugLog); });
const dlog = (...a) => {
  const line = new Date().toISOString() + ' [BG] ' +
    a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  if (FL_DEBUG) console.log('%c[FL:BG]', 'color:#008;font-weight:bold', ...a);
  bgLog(line);
};
const derr = (...a) => {
  const line = new Date().toISOString() + ' [BG✗] ' +
    a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  if (FL_DEBUG) console.error('%c[FL:BG✗]', 'color:#c06;font-weight:bold', ...a);
  bgLog(line);
};

// ─── Configuration ───
const EMIT_ROLLING_STATE = true;    // write a state snapshot JSON after every round
const HEDGING_FLAG_THRESHOLD = 3;   // hedging_language_count >= this flags a round for priority review
const MAX_STORED_ROUNDS = 500;      // safety valve for the in-extension transcript packet
const MAX_CODE_BLOCKS_IN_STATE = 8;
const CODE_BLOCK_EXCERPT_CHARS = 1600;
const PROMPT_EXCERPT_CHARS = 200;
const HANDOFF_SCHEMA_VERSION = 1;

let isProcessing = false;
const logQueue = [];
const pendingIndexEmit = new Set();   // chatIds awaiting index emission at queue drain

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  dlog('B1 message:', message.type);

  if (message.type === 'LOG_LLM_ROUND') {
    logQueue.push({ payload: message.payload, isBulk: false });
    processQueue();
    sendResponse({ status: 'success' });

  } else if (message.type === 'BULK_LOG_SESSION') {
    const { rounds, sessionName, chatId } = message.payload;
    dlog('B2 bulk:', rounds.length, 'rounds; chatId=', chatId);

    if (chatId) {
      // Reset the packet first, so the bulk replay rebuilds it cleanly
      pendingIndexEmit.add(chatId);
      resetSessionPacket(chatId)
        .then(() => getSessionState(chatId, true))
        .then(() => {
          rounds.forEach((roundData) => {
            const payload = {
              prompt: roundData.prompt,
              thinking: roundData.thinking || "",
              response: roundData.response,
              mediaFiles: roundData.mediaFiles || [],
              roundHtml: roundData.roundHtml || "",
              sessionName: sessionName || "Untitled Session",
              metadata: roundData.metadata || {},
              citationChips: roundData.citationChips || [],
              chatId: chatId,
              generationDurationMs: 0,
              domNodeCount: 0,
              origin: sender.tab ? sender.tab.url : 'unknown'
            };
            logQueue.push({ payload, isBulk: true });
          });
          processQueue();
        });
    }
    sendResponse({ status: 'success' });

  } else if (message.type === 'GENERATE_HANDOFF') {
    dlog('H1 handoff requested:', message.chatId);
    generateHandoff(message.chatId)
      .then(res => sendResponse(res))
      .catch(e => sendResponse({ status: 'error', error: e.message }));
    // begin addition
  } else if (message.type === 'FL_DEBUG_LOG') {
    (message.lines || []).forEach(l => bgLog(l));
    sendResponse({ status: 'ok' });
  } else if (message.type === 'DOWNLOAD_DEBUG_LOG') {
    (async () => {
      const { hostname } = await chrome.storage.local.get(['hostname']);
      const HOST = hostname || 'unknown-host';
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

      const n = flLog.length;
      const text = `# LLM-Forensic-Logger debug log\n# host: ${HOST}\n# exported: ${now.toISOString()}\n# entries: ${n}\n\n` + flLog.join('\n') + '\n';
      const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
      chrome.downloads.download({ url, filename: `LLM-Forensic-Logger/${dateStr}/debug.${dateStr}.${timeStr}.${HOST}.log`, saveAs: false });

      // Export-then-clear: each exported .log covers everything since the last export
      flLog.length = 0;
      chrome.storage.local.set({ flDebugLog: [] });
      sendResponse({ status: 'success', entries: n });
    })();
    return true;
  }
  return true;
});

async function processQueue() {
  if (isProcessing || logQueue.length === 0) return;
  isProcessing = true;

  const { payload } = logQueue.shift();
  dlog('B3 processing; queue remaining:', logQueue.length);
  try {
    await logRound(payload, payload.chatId);
  } catch (e) {
    derr('B3✗ logRound threw — continuing:', e);
  }

  isProcessing = false;
  // Drain hook: when a bulk run's last round lands, emit the citation index.
  if (logQueue.length === 0 && pendingIndexEmit.has(payload.chatId)) {
    pendingIndexEmit.delete(payload.chatId);
    try {
      await emitCitationIndexFile(payload.chatId);
    } catch (e) {
      derr('B9✗ citation index emission failed:', e);
    }
  }
  if (logQueue.length > 0) setTimeout(processQueue, 100);
}

// UPDATED: Added shouldReset parameter
async function getSessionState(chatId, shouldReset = false) {
  const data = await chrome.storage.local.get(['sessions']);
  const sessions = data.sessions || {};

  if (!sessions[chatId] || shouldReset) {
    sessions[chatId] = { SESSION_ID: crypto.randomUUID(), round_number: 0 };
    await chrome.storage.local.set({ sessions });
  }

  return sessions[chatId];
}

async function saveSessionState(chatId, state) {
  const data = await chrome.storage.local.get(['sessions']);
  const sessions = data.sessions || {};
  sessions[chatId] = state;
  await chrome.storage.local.set({ sessions });
}

// ─── Session Packet (normalized transcript retained for state/handoff engine) ───
// The authoritative transcript remains the downloaded round files. This packet
// is a working copy so the handoff can be assembled without re-reading the DOM.

async function resetSessionPacket(chatId) {
  const data = await chrome.storage.local.get(['sessionPackets']);
  const packets = data.sessionPackets || {};
  packets[chatId] = { session_id: null, session_name: null, rounds: [] };
  await chrome.storage.local.set({ sessionPackets: packets });
}

async function appendToPacket(chatId, entry) {
  const data = await chrome.storage.local.get(['sessionPackets']);
  const packets = data.sessionPackets || {};
  if (!packets[chatId]) {
    packets[chatId] = { session_id: null, session_name: null, rounds: [] };
  }
  const packet = packets[chatId];
  if (entry.session_id && !packet.session_id) packet.session_id = entry.session_id;
  if (entry.session_name) packet.session_name = entry.session_name;

  // Dedupe consecutive identical rounds (live logging can double-fire)
  const last = packet.rounds[packet.rounds.length - 1];
  if (!(last && last.prompt === entry.prompt && last.response === entry.response)) {
    packet.rounds.push(entry);
  }

  if (packet.rounds.length > MAX_STORED_ROUNDS) {
    packet.rounds = packet.rounds.slice(-MAX_STORED_ROUNDS);
  }
  await chrome.storage.local.set({ sessionPackets: packets });
  return packet;
}

async function getPacket(chatId) {
  const data = await chrome.storage.local.get(['sessionPackets']);
  return (data.sessionPackets || {})[chatId] || null;
}

// ─── Citation index (per-chat master reference, cumulative across sessions) ───
// Keyed by stable_key (chunk-hash#rank — render-invariant). Raw-cid and title
// keys are fallbacks for chips whose stable key couldn't be computed.

async function mergeCitationIndex(chatId, chips, roundNum, sessionId) {
    if (!chatId || !chips || chips.length === 0) return;
    const data = await chrome.storage.local.get(['citationIndexes']);
    const indexes = data.citationIndexes || {};
    if (!indexes[chatId]) indexes[chatId] = {};
    const idx = indexes[chatId];

    for (const chip of chips) {
        const key = chip.stable_key
            || (chip.container_id ? 'cid:' + chip.container_id : null)
            || ('title:' + (chip.source_title || 'unknown').toLowerCase().replace(/\s+/g, ' ').slice(0, 120));

        if (!idx[key]) {
            idx[key] = { source_title: chip.source_title || null, urls: [], cited_in: [],
                         status: 'pending-capture', match_type: null };
        }
        const e = idx[key];
        if (chip.source_title && !e.source_title) e.source_title = chip.source_title;

        const urls = Array.isArray(chip.urls) ? chip.urls : (chip.url ? [chip.url] : []);
        for (const u of urls) {
            if (!e.urls.includes(u)) e.urls.push(u);
        }
        e.status = e.urls.length > 0 ? 'resolved' : 'pending-capture';

        if (chip.url_match_type) e.match_type = chip.url_match_type;
        if (chip.response_id) e.response_id = chip.response_id;
        if (chip.chunk_id) e.chunk_id = chip.chunk_id;
        if (chip.container_id) e.container_id_last = chip.container_id;

        if (!e.cited_in.some(c => c.session_id === sessionId && c.round === roundNum)) {
            e.cited_in.push({ session_id: sessionId, round: roundNum });
        }
    }
    await chrome.storage.local.set({ citationIndexes: indexes });
}

async function emitCitationIndexFile(chatId) {
    const data = await chrome.storage.local.get(['citationIndexes', 'hostname']);
    const idx = (data.citationIndexes || {})[chatId];
    if (!idx || Object.keys(idx).length === 0) { dlog('B9 citation index empty for', chatId); return; }

    const HOSTNAME = data.hostname || 'unknown-host';
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const folderPath = `LLM-Forensic-Logger/${dateStr}/`;

    const entries = Object.entries(idx)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    const resolved = entries.filter(([, e]) => e.urls.length > 0).length;

    const indexJson = {
        type: 'citation_index',
        schema_version: 1,
        chat_id: chatId,
        hostname: HOSTNAME,
        generated_at_utc: now.toISOString(),
        totals: { citations: entries.length, resolved, pending_capture: entries.length - resolved },
        citations: entries.map(([key, e]) => ({
            stable_key: key.startsWith('cid:') || key.startsWith('title:') ? null : key,
            key: key,
            source_title: e.source_title,
            urls: e.urls,
            status: e.status,
            rounds_cited: e.cited_in || [],
            match_type: e.match_type || null,
            response_id: e.response_id || null,
            chunk_id: e.chunk_id || null,
            container_id_last: e.container_id_last || null
        }))
    };

    const baseFilename = `citations.${chatId}.${dateStr}.${timeStr}.${HOSTNAME}`;
    const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(indexJson, null, 2));
    chrome.downloads.download({ url, filename: `${folderPath}${baseFilename}.json`, saveAs: false });
    dlog('B9 citation index written:', baseFilename + '.json', `(${entries.length} citations, ${resolved} resolved, ${entries.length - resolved} pending)`);
}

async function logRound(payload, chatId) {
  const state = await getSessionState(chatId);
  state.round_number += 1;
  await saveSessionState(chatId, state);

  const roundNum = state.round_number;
  const seqNum = String(roundNum).padStart(8, '0');
  dlog('B4 round', roundNum, 'session', state.SESSION_ID);

  const { hostname } = await chrome.storage.local.get(['hostname']);
  const HOSTNAME = hostname || 'unknown-host';

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

  const baseFilename = `flush.${state.SESSION_ID}.${dateStr}.${timeStr}.${HOSTNAME}.${seqNum}`;
  const folderPath = `LLM-Forensic-Logger/${dateStr}/`;
  const mediaDirName = `${baseFilename}.d`;

  const mdContentRaw = createMarkdown(payload, state.SESSION_ID, roundNum);
  const mdContent = mdContentRaw.replace(/flush\.MEDIA_PLACEHOLDER/g, mediaDirName);
  const mdUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(mdContent);

  const jsonContent = createJsonMetadata(payload, state.SESSION_ID, roundNum, dateStr, timeStr, HOSTNAME);
  const jsonUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(jsonContent, null, 2));

  const xhtmlContent = `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"/><title>Round ${roundNum}</title></head><body>${payload.roundHtml || ""}</body></html>`;
  const finalXhtmlContent = xhtmlContent.replace(/flush\.MEDIA_PLACEHOLDER/g, mediaDirName);
  const xhtmlUrl = 'data:application/xhtml+xml;charset=utf-8,' + encodeURIComponent(finalXhtmlContent);

  dlog('B5 writing md/json/xhtml:', baseFilename);
  chrome.downloads.download({ url: mdUrl, filename: `${folderPath}${baseFilename}.md`, saveAs: false });
  chrome.downloads.download({ url: jsonUrl, filename: `${folderPath}${baseFilename}.json`, saveAs: false });
  chrome.downloads.download({ url: xhtmlUrl, filename: `${folderPath}${baseFilename}.xhtml`, saveAs: false });

  if (payload.mediaFiles && payload.mediaFiles.length > 0) {
    payload.mediaFiles.forEach((media, idx) => {
      setTimeout(() => {
        const downloadUrl = media.directUrl || media.dataUrl;
        if (!downloadUrl) return;
        chrome.downloads.download({
          url: downloadUrl,
          filename: `${folderPath}${mediaDirName}/${media.filename}`,
          saveAs: false
        }, (id) => {
          if (id === undefined || chrome.runtime.lastError) {
            derr('B6✗ failed:', media.filename, chrome.runtime.lastError && chrome.runtime.lastError.message);
            return;
          }

          setTimeout(() => {
            chrome.downloads.search({ id }, (items) => {
              const it = items && items[0];
              if (!it || it.state !== 'complete') { derr('B6✗ interrupted:', media.filename, it && it.state, it && it.error); return; }
              dlog('B6✓ complete:', media.filename, it.mime, it.bytesReceived + 'B');
              // Verify: rename to the extension the actual bytes imply
              const mimeExt = {
                'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
                'image/gif': 'gif', 'application/pdf': 'pdf',
                'video/mp4': 'mp4', 'video/webm': 'webm'
              }[it.mime];
              if (mimeExt && !media.filename.endsWith('.' + mimeExt)) {
                const corrected = media.filename.replace(/\.[a-z0-9]+$/i, '.' + mimeExt);
                chrome.downloads.remove(id, () => {         // remove the wrong-named copy
                  chrome.downloads.download({
                    url: downloadUrl,
                    filename: `${folderPath}${mediaDirName}/${corrected}`,
                    saveAs: false
                  }, (id2) => {
                    if (id2 !== undefined && !chrome.runtime.lastError) dlog('B6✓ renamed →', corrected);
                    else derr('B6✗ rename failed for', corrected);
                  });
                });
              }
            });
          }, 3000);

        });
      }, idx * 200);
    });
  }

  // ── Retain normalized copy + emit rolling state snapshot ──
  const packetEntry = {
    round: roundNum,
    timestamp_utc: jsonContent.timestamp_logged_utc,
    session_id: state.SESSION_ID,
    session_name: payload.sessionName || null,
    prompt: payload.prompt || "",
    thinking: payload.thinking || "",
    response: payload.response || "",
    metrics: jsonContent.metrics,
    media: (payload.mediaFiles || []).map(m => ({ filename: m.filename, dir: mediaDirName })),
    citation_chips: payload.citationChips || [],
    files: {
      md: `${folderPath}${baseFilename}.md`,
      json: `${folderPath}${baseFilename}.json`,
      xhtml: `${folderPath}${baseFilename}.xhtml`,
      media_dir: (payload.mediaFiles && payload.mediaFiles.length > 0) ? `${folderPath}${mediaDirName}` : null
    }
  };
  const packet = await appendToPacket(chatId, packetEntry);
  await mergeCitationIndex(chatId, payload.citationChips || [], roundNum, state.SESSION_ID);
  dlog('B7 packet rounds:', packet.rounds.length);

  if (EMIT_ROLLING_STATE) {
    const stateJson = buildRollingStateJson(state, packet, payload, chatId, HOSTNAME);
    const stateUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(stateJson, null, 2));
    const stateFilename = `${folderPath}state.${state.SESSION_ID}.${dateStr}.${timeStr}.${HOSTNAME}.${seqNum}.json`;
    chrome.downloads.download({ url: stateUrl, filename: stateFilename, saveAs: false });
    dlog('B8 state snapshot written');
  }
}

// ─── Mechanical extraction helpers (no interpretation, regex/counters only) ───

function extractCodeBlocks(md) {
  const out = [];
  if (!md) return out;
  const re = /```([A-Za-z0-9_+#.-]*)[^\S\n]*\n([\s\S]*?)(?:```|$)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    if (m[2].trim().length === 0) continue;
    out.push({ language: m[1] || 'text', content: m[2].replace(/\n$/, '') });
  }
  return out;
}

function trailingQuestion(text) {
  if (!text) return null;
  const tail = text.trim().slice(-400);
  const m = tail.match(/([^\n]*\?)\s*$/);
  return m ? m[1].trim().slice(0, 300) : null;
}

function computeFlags(metrics) {
  const d = (metrics && metrics.drift_and_hallucination_indicators) || {};
  return {
    self_correction: (d.self_correction_count || 0) > 0,
    hedging_spike: (d.hedging_language_count || 0) >= HEDGING_FLAG_THRESHOLD
  };
}

function excerpt(s, n = PROMPT_EXCERPT_CHARS) {
  if (!s) return '';
  let t = s.replace(/\s+/g, ' ').trim();
  // Collapse Gemini's doubled prompt rendering for handoff/state views.
  // The raw .md files remain untouched and faithful to the DOM.
  if (/^you said\s+/i.test(t)) t = t.replace(/^you said\s+/i, '');
  const total = t.length;
  for (let L = Math.floor(total / 2); L >= Math.floor(total / 2) - 2 && L > 10; L--) {
    const sep = total - 2 * L;
    if (sep < 0 || sep > 2) continue;
    if (t.slice(0, L) === t.slice(L + sep)) { t = t.slice(0, L); break; }
  }
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function buildRollingStateJson(sessionState, packet, payload, chatId, HOSTNAME) {
  const rounds = packet.rounds;
  const last = rounds[rounds.length - 1] || null;
  const codeBlocks = last ? extractCodeBlocks(last.response).slice(0, MAX_CODE_BLOCKS_IN_STATE) : [];

  return {
    type: 'rolling_state',
    schema_version: HANDOFF_SCHEMA_VERSION,
    session_id: sessionState.SESSION_ID,
    chat_id: chatId,
    session_name: payload.sessionName || packet.session_name || null,
    hostname: HOSTNAME,
    generated_at_utc: new Date().toISOString(),
    rounds_recorded: rounds.length,
    highest_round: sessionState.round_number,
    objective: {
      session_name: payload.sessionName || packet.session_name || null,
      first_prompt_excerpt: rounds.length ? excerpt(rounds[0].prompt, 400) : ''
    },
    prompt_index: rounds.map(r => ({ round: r.round, excerpt: excerpt(r.prompt) })),
    latest_code_blocks: codeBlocks.map(b => ({
      language: b.language,
      char_count: b.content.length,
      source_round: last.round,
      excerpt: b.content.slice(0, CODE_BLOCK_EXCERPT_CHARS),
      truncated: b.content.length > CODE_BLOCK_EXCERPT_CHARS
    })),
    media_manifest: rounds.flatMap(r => (r.media || []).map(m => ({ round: r.round, filename: m.filename, dir: m.dir }))),
    flagged_rounds: rounds
      .map(r => ({ round: r.round, ...computeFlags(r.metrics) }))
      .filter(x => x.self_correction || x.hedging_spike),
    question_pending_at_round_end: (last && trailingQuestion(last.response))
      ? { round: last.round, text: trailingQuestion(last.response) }
      : null,
    latest_files: last ? last.files : null
  };
}

// ─── On-demand handoff (assembly only — never summarization) ───

async function generateHandoff(chatId) {
  const packet = await getPacket(chatId);
  dlog('H2 packet:', packet && packet.rounds ? packet.rounds.length + ' rounds' : 'EMPTY');
  if (!packet || packet.rounds.length === 0) {
    return {
      status: 'empty',
      message: 'No recorded rounds for this chat in extension storage. Scroll to top and click "Log Entire Session" to rebuild the packet, then try again.'
    };
  }

  const { hostname } = await chrome.storage.local.get(['hostname']);
  const HOSTNAME = hostname || 'unknown-host';

  const rounds = packet.rounds;
  const last = rounds[rounds.length - 1];
  const sessionId = packet.session_id || 'no-session-id';

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const seqNum = String(last.round).padStart(8, '0');
  const folderPath = `LLM-Forensic-Logger/${dateStr}/`;
  const baseName = `handoff.${sessionId}.${dateStr}.${timeStr}.${HOSTNAME}.${seqNum}`;

  const md = buildHandoffMarkdown({
    sessionId,
    sessionName: packet.session_name,
    chatId,
    hostname: HOSTNAME,
    packet
  });

  const url = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
  dlog('H4 writing', baseName + '.md');
  chrome.downloads.download({ url, filename: `${folderPath}${baseName}.md`, saveAs: false });

  return { status: 'success', rounds: rounds.length };
}

function buildHandoffMarkdown({ sessionId, sessionName, chatId, hostname, packet }) {
  const rounds = packet.rounds;
  const last = rounds[rounds.length - 1];
  const first = rounds[0];

  const flagged = [];
  for (const r of rounds) {
    const f = computeFlags(r.metrics);
    if (f.self_correction || f.hedging_spike) flagged.push({ round: r.round, ...f });
  }

  const gaps = [];
  for (let i = 1; i < rounds.length; i++) {
    if (rounds[i].round !== rounds[i - 1].round + 1) gaps.push(`${rounds[i - 1].round}→${rounds[i].round}`);
  }

  const L = [];
  L.push(`# Session Handoff — ${sessionName || sessionId}`);
  L.push('');
  L.push(`**Session ID:** \`${sessionId}\`  ·  **Chat:** \`${chatId}\`  ·  **Host:** \`${hostname}\``);
  L.push(`**Generated:** ${new Date().toISOString()}  ·  **Rounds recorded:** ${rounds.length} (highest round #${last.round})`);
  L.push('');
  L.push('> **HOW TO USE (receiving model):** This file was generated mechanically from a lossless transcript — no LLM summarized it.');
  L.push('> 1. Read this file, then **restate your understanding and ask clarifying questions before doing any work**.');
  L.push('> 2. This file is a map; the round files it points to are the territory. Pull them when detail matters.');
  L.push('> 3. Flag apparent inconsistencies instead of silently resolving them.');
  L.push('');

  L.push('## Objective');
  L.push('');
  L.push(`**First prompt (excerpt):** ${excerpt(first.prompt, 400)}`);
  L.push('');

  if (gaps.length) {
    L.push('## ⚠ Data gaps');
    L.push('');
    L.push(`Round numbers are not contiguous (gaps: ${gaps.join(', ')}). The extension was likely reloaded mid-session. For a complete transcript, scroll to the top of the chat, run "Log Entire Session", and regenerate this handoff.`);
    L.push('');
  }

  L.push('## Priority reading');
  L.push('');
  if (flagged.length === 0) {
    L.push('No rounds flagged (no self-corrections, no hedging spikes). Read the prompt log below; pull round files as needed.');
  } else {
    L.push('Rounds where drift indicators fired — these usually contain decisions, reversals, and dead ends:');
    L.push('');
    for (const f of flagged) {
      const reasons = [];
      if (f.self_correction) reasons.push('self-correction');
      if (f.hedging_spike) reasons.push(`hedging spike (≥${HEDGING_FLAG_THRESHOLD})`);
      L.push(`- **Round ${f.round}** — ${reasons.join(', ')}`);
    }
  }
  L.push('');

  L.push('## Chronological prompt log (decision proxy)');
  L.push('');
  L.push('User prompts are where directives and course-corrections enter a session. Full text lives in each round file.');
  L.push('');
  for (const r of rounds) L.push(`- **r${r.round}:** ${excerpt(r.prompt)}`);
  L.push('');

  const blocks = extractCodeBlocks(last.response).slice(0, MAX_CODE_BLOCKS_IN_STATE);
  L.push(`## Latest code artifacts (as of round ${last.round})`);
  L.push('');
  if (blocks.length === 0) {
    L.push('No fenced code blocks in the latest response.');
  } else {
    L.push(`Excerpts below; full versions live in the round-${last.round} files.`);
    L.push('');
    blocks.forEach((b, i) => {
      L.push(`### Block ${i + 1} — \`${b.language}\` (${b.content.length} chars)`);
      L.push('');
      L.push('```' + b.language);
      L.push(b.content.length > CODE_BLOCK_EXCERPT_CHARS
        ? b.content.slice(0, CODE_BLOCK_EXCERPT_CHARS) + '\n// …truncated — see round file'
        : b.content);
      L.push('```');
      L.push('');
    });
  }

  L.push('## Media / artifact manifest');
  L.push('');
  let mediaCount = 0;
  for (const r of rounds) {
    for (const m of (r.media || [])) {
      L.push(`- r${r.round}: \`${m.filename}\` → \`${m.dir}/\``);
      mediaCount++;
    }
  }
  if (mediaCount === 0) L.push('_No media logged this session._');
  L.push('');

  L.push('## Open threads (heuristic)');
  L.push('');
  const q = trailingQuestion(last.response);
  if (q) {
    L.push(`The round-${last.round} response ends with a question, possibly unanswered:`);
    L.push('');
    L.push(`> ${q}`);
  } else {
    L.push('No trailing question detected in the final response.');
  }
  L.push('');

  L.push('## Round file index');
  L.push('');
  for (const r of rounds) {
    L.push(`- **r${r.round}** (${r.timestamp_utc}) — \`${r.files.md}\``);
  }

  return L.join('\n');
}

// ─── Existing round serialization ───

function createMarkdown(payload, sessionId, roundNum) {
  let md = `# AI Forensic Log\n\n`;
  md += `**Session ID:** ${sessionId}\n`;
  if (payload.sessionName) md += `**Session Name:** ${payload.sessionName}\n`;
  md += `**Round:** ${roundNum}\n`;
  md += `\n## User Prompt\n\n${payload.prompt}\n\n`;

  if (payload.thinking && payload.thinking.trim().length > 0) {
    md += `## AI Thinking\n\n\`\`\`\n${payload.thinking}\n\`\`\`\n\n`;
  }
  md += `## AI Response\n\n${payload.response}\n`;
  return md;
}

function createJsonMetadata(payload, sessionId, roundNum, dateStr, timeStr, hostname) {
  const responseWords = payload.response.split(/\s+/).length;
  const promptWords = payload.prompt.split(/\s+/).length;
  const hedgingWords = (payload.response.match(/\b(might be|could be|possibly|perhaps|assuming|I think|likely)\b/gi) || []).length;
  const selfCorrections = (payload.response.match(/\b(Actually|Wait|Correction|I apologize|I made a mistake)\b/gi) || []).length;

  return {
    session_id: sessionId,
    session_name: payload.sessionName || null,
    round_number: roundNum,
    timestamp_logged_utc: new Date().toISOString(),
    hostname: hostname,
    gemini_metadata: {
      ...(payload.metadata || {}),
      citation_chips: payload.citationChips || []
    },
    metrics: {
      resource_usage: {
        prompt_char_length: payload.prompt.length,
        response_char_length: payload.response.length,
        thinking_char_length: payload.thinking ? payload.thinking.length : 0,
        prompt_word_count: promptWords,
        response_word_count: responseWords,
        generation_duration_ms: payload.generationDurationMs,
        dom_node_count_at_log: payload.domNodeCount,
        media_files_logged: payload.mediaFiles ? payload.mediaFiles.length : 0
      },
      drift_and_hallucination_indicators: {
        hedging_language_count: hedgingWords,
        self_correction_count: selfCorrections,
        lexical_diversity: calculateLexicalDiversity(payload.response)
      }
    },
    system_info: { url_origin: payload.origin }
  };
}

function calculateLexicalDiversity(text) {
  const words = text.toLowerCase().match(/\b(\w+)\b/g) || [];
  if (words.length === 0) return 0;
  return new Set(words).size / words.length;
}
