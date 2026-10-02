// @match *://gemini.google.com/*
// @host_permissions *://gemini.google.com/*
// @world MAIN
//
// Gemini wire injector (D15). Passive: observes batchexecute responses for the
// hNvQHb conversation-history RPC, parses the length-prefixed framing here, and
// relays ONLY targeted structures (media entries, thought pairs, id triples).
// Classifier/telemetry blocks are dropped by construction — they never cross
// the boundary. See notes/WIRE_CAPTURE_PLAYBOOK.md.
(function() {
  if (window.__FL_WIRE_GEMINI__) return;
  window.__FL_WIRE_GEMINI__ = true;

  const buf = [];
  const RELAY = (msg) => { try { window.top.postMessage(msg, '*'); } catch (e) {} };
  const relay = (msg) => { try { window.top.postMessage(msg, '*'); } catch (e) {} };
  window.addEventListener('message', (e) => {
    if (e && e.data && e.data.type === 'FL_WIRE_READY' && e.data.for === 'gemini') {
      while (buf.length) RELAY(buf.shift());
    }
  });

  const URLKEY = (u) => { try { return String(u).split('=')[0]; } catch (e) { return String(u); } };
  const FILENAME_RE = /\.(png|jpe?g|gif|webp|heic|bmp|tiff?|mp4|webm|mov|avi|mkv|mp3|wav|pdf|txt|md|csv|docx?|xlsx?|pptx?|zip|json)$/i;
  const ID_RE = /^(c_|r_|rc_)[0-9a-f]{8,}$/i;
  const RC_RE = /^rc_[0-9a-f]{8,}$/i;

  // batchexecute framing: )]}' then repeated <len>\n<segment> segments.
  function parseSegments(text) {
    const segs = [];
    let pos = text.indexOf('\n');
    const n = text.length;
    while (pos !== -1 && pos < n) {
      while (pos < n && text[pos] === '\n') pos++;
      if (pos >= n) break;
      let eol = text.indexOf('\n', pos);
      if (eol === -1) eol = n;
      const lenStr = text.slice(pos, eol).trim();
      if (!/^\d+$/.test(lenStr)) { pos = eol + 1; continue; }
      const len = parseInt(lenStr, 10);
      const start = eol + 1;
      if (start + len > n) break;
      segs.push(text.substr(start, len));
      pos = start + len;
    }
    return segs;
  }

  const HEAD_RE = /^\[\["wrb\.fr","([A-Za-z0-9_]+)","/;

  // Locate the inner JSON string positionally: [["wrb.fr","<rpcid>","<inner>"…
  // The inner string is JSON-escaped; its closing quote is the first
  // unescaped '"'. No assumptions about the trailing cells (null counts,
  // whitespace, and newlines all vary between responses).
  function extractInnerString(seg) {
    const head = seg.match(HEAD_RE);
    if (!head) return null;
    let i = head[0].length;                 // first char of the inner string
    while (i < seg.length) {
      if (seg[i] === '\\') { i += 2; continue; }   // skip escaped char (\", \\, \n…)
      if (seg[i] === '"') return { rpcid: head[1], raw: seg.slice(head[0].length, i) };
      i++;
    }
    return null;
  }

  function extractHistory(inner) {
    const media = new Map();      // urlKey → record
    const turns = new Map();      // rc_ id → {thoughts, videos}
    const triples = [];
    const seenRoots = new Set();

    function scan(node, turnId) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        if (typeof node[0] === 'string' && RC_RE.test(node[0]) && !seenRoots.has(node)) {
          seenRoots.add(node);
          turnId = node[0];
          if (!turns.has(turnId)) turns.set(turnId, { thoughts: [], videos: [] });
        }
        if (node.length >= 8 &&
            typeof node[2] === 'string' && FILENAME_RE.test(node[2]) &&
            ((typeof node[3] === 'string' && node[3].indexOf('googleusercontent') !== -1) ||
             (Array.isArray(node[6]) && node[6].some((u) => typeof u === 'string' && u.indexOf('googleusercontent') !== -1)))) {
          const urls = Array.isArray(node[6])
            ? node[6].filter((u) => typeof u === 'string')
            : [node[3]];
          let downloadUrl = null;
          for (const u of urls) {
            if (/usercontent\.google\.com\/download/.test(u)) downloadUrl = u;
          }
          const rec = {
            filename: node[2],
            urls,
            downloadUrl,
            mime: typeof node[11] === 'string' ? node[11] : null,
            ts: Array.isArray(node[9]) && typeof node[9][0] === 'number' ? node[9][0] : null,
            w: null, h: null, bytes: null
          };
          const dims = Array.isArray(node[15]) ? node[15] : null;
          if (dims) {
            if (typeof dims[0] === 'number') { rec.w = dims[0]; rec.h = dims[1]; rec.bytes = dims[2]; }
            else if (Array.isArray(dims[0])) { rec.w = dims[1]; rec.h = dims[2]; }
          }
          for (const u of urls) {
            const k = URLKEY(u);
            if (k && !media.has(k)) media.set(k, rec);
          }
          if (turnId && rec.mime === 'video/mp4' && turns.has(turnId)) {
            turns.get(turnId).videos.push(rec);
          }
        }
        // Thought pair — LENIENT/PROVISIONAL: array whose last two elements are
        // [short title, long text]. May over-collect; flagged in metadata.
        if (turnId && node.length >= 2) {
          const a = node[node.length - 2], b = node[node.length - 1];
          if (typeof a === 'string' && typeof b === 'string' &&
              a.length > 0 && a.length <= 80 && a.indexOf('\n') === -1 &&
              !FILENAME_RE.test(a) && b.length > 80) {
            const t = turns.get(turnId);
            if (t && !t.thoughts.some((x) => x.text === b)) {
              t.thoughts.push({ title: a, text: b });
            }
          }
        }
        if ((node.length === 2 || node.length === 3) &&
            node.every((x) => typeof x === 'string' && ID_RE.test(x))) {
          const key = node.join('|');
          if (!triples.some((t) => t.key === key)) triples.push({ key, ids: node.slice() });
        }
        for (const x of node) scan(x, turnId);
      } else {
        for (const k of Object.keys(node)) scan(node[k], turnId);
      }
    }
    scan(inner, null);

    let conversationId = null;
    for (const t of triples) {
      const c = (t.ids || []).find((x) => x.charAt(0) === 'c' && x.charAt(1) === '_');
      if (c) { conversationId = c; break; }
    }
    return {
      conversationId,
      media: Array.from(media.values()).map((m) => ({
        key: URLKEY(m.urls[0] || ''), filename: m.filename, urls: m.urls,
        downloadUrl: m.downloadUrl, mime: m.mime, bytes: m.bytes,
        w: m.w, h: m.h, ts: m.ts
      })).filter((m) => m.key),
      turns: Array.from(turns.entries()).map(([rcId, t]) => ({
        rcId, thoughts: t.thoughts, videos: t.videos.map((v) => ({
          filename: v.filename, downloadUrl: v.downloadUrl, mime: v.mime,
          w: v.w, h: v.h, ts: v.ts
        }))
      })),
      triples
    };
  }

  function handleResponseText(text) {
    if (typeof text !== 'string' || text.indexOf('hNvQHb') === -1) return;
    try {
      const segs = parseSegments(text);
      console.debug('[FL:wire-gemini] hNvQHb: segs=' + (segs ? segs.length : 'null'));
      for (const seg of segs) {
        const ext = extractInnerString(seg);
        if (!ext) {
          console.debug('[FL:wire-gemini] seg not wrb.fr-shaped, len=' + seg.length);
          continue;
        }
        // Single-pass unescape (order-safe: \\n survives as \n when preceded by \\)
        const inner = ext.raw.replace(/\\\\|\\u003d|\\"|\\n|\\t|\\r/g,
          (s) => ({ '\\\\':'\\', '\\u003d':'=', '\\"':'"', '\\n':'\n', '\\t':'\t', '\\r':'\r' }[s]));
        // S1: strict parse. S2: escape any raw control chars (Google quirk).
        let hist = null, how = null;
        try {
          hist = JSON.parse(inner); how = 'S1 strict';
        } catch (e1) {
          try {
            hist = JSON.parse(inner.replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t'));
            how = 'S2 control-escaped';
          } catch (e2) {
            console.debug('[FL:wire-gemini] inner parse fail: ' + String(e2).slice(0,100));
            continue;
          }
        }
        if (ext.rpcid === 'hNvQHb') {
          const rec = extractHistory(hist);          // object-based signature
          console.debug('[FL:wire-gemini] extract → media=' + rec.media.length +
                        ' turns=' + rec.turns.length + ' triples=' + rec.triples.length);
          if (rec.media.length || rec.turns.length) {
            relay({ type: 'FL_WIRE_GEMINI_HISTORY', payload: rec, at: Date.now() });
          }
        }
      }                                                  // ← closes `for`
    } catch (e) {
      console.debug('[FL:wire-gemini] handleResponseText threw: ' + String(e));
    }
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function(input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (String(url).indexOf('batchexecute') !== -1) {
          p.then((r) => {
            try { r.clone().text().then(handleResponseText).catch(() => {}); } catch (e) {}
          }).catch(() => {});
        }
      } catch (e) {}
      return p;
    };
  }

  const XO = XMLHttpRequest.prototype;
  const origOpen = XO.open, origSend = XO.send;
  XO.open = function(method, url) {
    this.__flWire = String(url || '');
    return origOpen.apply(this, arguments);
  };
  XO.send = function() {
    if ((this.__flWire || '').indexOf('batchexecute') !== -1) {
      this.addEventListener('load', () => {
        try {
          console.debug('[FL:wire-gemini] XHR done:', (this.__flWire||'').slice(0,80), 'rt=', this.responseType);
          handleResponseText(this.responseType ? '' : this.responseText);
        } catch (e) { console.debug('[FL:wire-gemini] XHR read failed:', String(e)); }
      });
    }
    return origSend.apply(this, arguments);
  };

  console.debug('[FL:wire-gemini] installed');
})();
