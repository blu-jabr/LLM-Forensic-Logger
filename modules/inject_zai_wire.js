// @match *://chat.z.ai/*
// @host_permissions *://chat.z.ai/*
// @world MAIN
//
// Z.AI wire injector (D14). Passive: observes POST /api/v1/chats/{id}/messages/batch,
// extracts targeted structures only (never relays raw responses), buffers until the
// isolated world signals FL_WIRE_READY, then flushes. See notes/WIRE_CAPTURE_PLAYBOOK.md.
(function() {
  if (window.__FL_WIRE_ZAI__) return;
  window.__FL_WIRE_ZAI__ = true;

  const buf = [];
  const RELAY = (msg) => { try { window.top.postMessage(msg, '*'); } catch (e) {} };
  const relay = (msg) => { if (buf.length < 30) buf.push(msg); };
  window.addEventListener('message', (e) => {
    if (e && e.data && e.data.type === 'FL_WIRE_READY' && e.data.for === 'zai') {
      console.debug('[FL:wire-zai] ready received, flushing ' + buf.length);
      while (buf.length) RELAY(buf.shift());
    }
  });

  function extractBatch(text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { return null; }
    if (!j || !j.data || typeof j.data !== 'object') return null;
    const messages = {};
    for (const uuid of Object.keys(j.data)) {
      const m = j.data[uuid];
      if (!m || typeof m !== 'object') continue;
      let content = (m.content === undefined || m.content === null) ? null : String(m.content);
      let reasoning = null;
      if (Array.isArray(m.content_blocks)) {
        const parts = [];
        for (const b of m.content_blocks) {
          if (!b || typeof b.content !== 'string') continue;
          if (b.type === 'reasoning') parts.push(b.content);
          else if (b.type === 'text' && content === null) content = b.content;
        }
        if (parts.length) reasoning = parts.join('\n\n');
      }
      const files = Array.isArray(m.files) ? m.files.map((f) => ({
        id: (f && f.id) || (f && f.file && f.file.id) || null,
        filename: (f && (f.filename || (f.file && f.file.filename))) || null,
        cdnUrl: (f && f.file && f.file.meta && f.file.meta.cdn_url) || null,
        contentType: (f && f.file && f.file.meta && f.file.meta.content_type) || null,
        size: (f && f.file && f.file.meta && f.file.meta.size) !== undefined
          ? f.file.meta.size : ((f && f.size) !== undefined ? f.size : null),
        refUserMsgId: (f && f.ref_user_msg_id) || uuid
      })) : [];
      messages[uuid] = {
        role: m.role || null,
        content,
        reasoning,
        usage: m.usage ? {
          promptTokens: m.usage.prompt_tokens !== undefined ? m.usage.prompt_tokens : null,
          completionTokens: m.usage.completion_tokens !== undefined ? m.usage.completion_tokens : null,
          cachedTokens: (m.usage.prompt_tokens_details && m.usage.prompt_tokens_details.cached_tokens) !== undefined
            ? m.usage.prompt_tokens_details.cached_tokens : null
        } : null,
        model: m.model || null,
        files
      };
    }
    return { chatId: j.chat_id || null, messages };
  }

// Watch the wire's own debug line — add nothing, just look for:
// [FL:wire-zai] saw batch            ← NOT in the shipped code yet, so:
  function handleResponseText(text) {
    console.debug('[FL:wire-zai] handleResponseText len=' + (text||'').length);
    if (!text || text.indexOf('"cdn_url"') === -1) return;  // cheap prefilter
    const rec = extractBatch(text);
    if (rec && rec.chatId && Object.keys(rec.messages).length) {
      // relay({ type: 'FL_WIRE_ZAI_CHATDATA', chatId: rec.chatId, payload: rec, at: Date.now() });
      RELAY({ type: 'FL_WIRE_ZAI_CHATDATA', chatId: rec.chatId, payload: rec, at: Date.now() });
    }
  }

  const BATCH_RE = /\/api\/v1\/chats\/[0-9a-f-]+\/messages\/batch/;

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function(input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method === 'POST' && BATCH_RE.test(url)) {
          console.debug('[FL:wire-zai] matched batch request:', url);
          p.then((r) => {
            try { r.clone().text().then(handleResponseText).catch(() => {}); } catch (e) {}
          }).catch(() => {});
        }
      } catch (e) { /* never break the app */ }
      return p;
    };
  }

  const XO = XMLHttpRequest.prototype;
  const origOpen = XO.open, origSend = XO.send;
  XO.open = function(method, url) {
    this.__flWire = { method: String(method || '').toUpperCase(), url: String(url || '') };
    return origOpen.apply(this, arguments);
  };
  XO.send = function() {
    const info = this.__flWire || {};
    if (info.method === 'POST' && BATCH_RE.test(info.url)) {
      this.addEventListener('load', () => {
        try { handleResponseText(this.responseText); } catch (e) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  console.debug('[FL:wire-zai] installed');
})();
