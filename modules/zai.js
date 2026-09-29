// @match *://chat.z.ai/*
// @host_permissions *://chat.z.ai/*
// @host_permissions *://z-cdn-media.chatglm.cn/*
//
// Forensic chat logger — module for Z.AI (https://chat.z.ai).
// Registers as window.ForensicModules.zai.
//
// SELECTOR STATUS:
//   VERIFIED against user-supplied live DOM samples:
//     div#message-<uuid>                per-message root (user and assistant);
//                                       #message-<uuid>-start anchors excluded
//                                       by exact UUID regex
//     .user-message / .chat-user        user turn markers
//     .chat-assistant                   assistant turn marker
//     #response-content-container       assistant body wrapper (id repeats
//                                       per message; query scoped per turn)
//     .markdown-prose (inner div)       assistant answer content (NOTE:
//                                       .chat-assistant itself also carries
//                                       markdown-prose — scope to container)
//     .thinking-chain-container         "Thought Process" header; present
//                                       even while collapsed; its toggle
//                                       button holds TWO svgs (brain icon,
//                                       then chevron) — only the chevron
//                                       carries -rotate-90 when closed
//     .thinking-block > blockquote      reasoning text — UNMOUNTED while
//                                       collapsed (Svelte {#if})
//     user bubble: full text present in DOM even when UI-truncated
//     CodeMirror blocks: .cm-editor / .cm-content[data-language] / .cm-line;
//                                       long blocks virtualize (cm-gap)
//     attachment chip (text files): <button> holding img[src*="/icons/
//                                       <TYPE>.svg"] + filename div (.truncate
//                                       leaf) + KIND + size spans; NO href or
//                                       file id in the DOM. Clicking opens a
//                                       text viewer (whitespace-pre-wrap).
//   PROVISIONAL (no samples yet): sidebar session title, model label,
//     viewer dialog container/close button (Escape assumed), transcript
//     behavior in very long sessions, data-direct meaning, image/PDF chips
//     and their viewers.
//
// ATTACHMENT HARVESTER (bulk only): bulkPreExtract() clicks each text-type
// chip, snapshots .whitespace-pre-wrap nodes, captures the NEW viewer text,
// closes the viewer (Escape, then aria-label close fallback), and stamps the
// chip with a blob: URL. promptHtmlOf rewrites stamped chips to
// <a href="blob:..." download="<filename>">, which content.js's existing
// blob pipeline fetches (<=10 MB) and background.js writes. CAVEAT: without
// the proposed content.js ext addition, text blobs land as <base>.bin.
// Gated by ENABLE_ATTACHMENT_HARVEST; safe-text extensions only; aborts
// remaining harvests if a viewer fails to close. Live logging never clicks
// chips (limitation: live rounds record chips as metadata only).
//
// STATUS BRIDGE: setStatus() writes {bulkStatus} to chrome.storage.local
// for the popup to display (popup.js watches it) and dlogs the same line.
//
// KNOWN LIMITATIONS
//   - Live logging captures reasoning text only if expanded at capture time
//     (collapsed blocks are unmounted). bulkExtract() temporarily expands
//     every collapsed block, harvests, then restores.
//   - Code lines elided by in-editor virtualization (cm-gap) are marked, not
//     recoverable.
//   - SVGs are stripped as icon chrome; img/canvas/video/audio are kept.

(function() {
  'use strict';

  const TAG = '[zai]';
  const log = (...a) => (typeof dlog === 'function' ? dlog(TAG, ...a) : console.log(TAG, ...a));
  const logErr = (...a) => (typeof derr === 'function' ? derr(TAG, ...a) : console.error(TAG, ...a));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => !!(el.getClientRects && el.getClientRects().length);

  const setStatus = (message, level = 'info') => {
    log(message);
    try {
      chrome.storage.local.set({ bulkStatus: { service: 'zai', message, level, at: Date.now() } });
    } catch (e) { /* status is best-effort */ }
  };

  // ------------------------------------------------------------------
  // VERIFIED
  // ------------------------------------------------------------------

  const TURN_ID_RE =
    /^message-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

  const MEDIA_KEEP_SEL = 'img, video, audio, canvas, a[href]';

  const PROMPT_EXTRA_STRIP = '[class*="bg-gradient-to-b"], .pointer-events-none';
  const RESPONSE_EXTRA_STRIP = '[aria-label="Copy"], [aria-label="Edit"]';

  // ------------------------------------------------------------------
  // PROVISIONAL — finalize with sidebar/header/viewer samples
  // ------------------------------------------------------------------

  const SESSION_SELECTORS = [
    'aside [aria-current="true"]',
    'aside [data-active="true"]',
    'nav [aria-current="true"]',
    '[class*="session" i][class*="active" i]',
    'aside [class*="active" i]',
  ];

  const MODEL_RE = /GLM[-\s]?\d[\w.\-]*/i;

  const ENABLE_ATTACHMENT_HARVEST = true;
  // Only these filename extensions are clicked. Everything else is recorded
  // in metadata and left untouched until its viewer shape is sampled.
  const SAFE_TEXT_EXT = new Set([
    'txt', 'md', 'markdown', 'json', 'csv', 'log', 'sh', 'bash', 'py', 'js',
    'ts', 'jsx', 'tsx', 'yaml', 'yml', 'xml', 'html', 'htm', 'ini', 'conf',
    'cfg', 'toml', 'sql', 'css', 'c', 'h', 'cpp', 'hpp', 'java', 'go', 'rs',
    'rb', 'php', 'pl', 'tex', 'env', 'service', 'zone',
  ]);

  // ------------------------------------------------------------------
  // Cleaning helpers
  // ------------------------------------------------------------------

  const stripChrome = (clone, extraSel) => {
    clone.querySelectorAll('svg').forEach((el) => el.remove());
    clone.querySelectorAll('button').forEach((el) => {
      if (el.querySelector(MEDIA_KEEP_SEL)) return; // keep media/attachment chips
      el.remove();
    });
    if (extraSel) clone.querySelectorAll(extraSel).forEach((el) => el.remove());
  };

  // content.js skips anchors lacking both a download attr and a file
  // extension; blob: URLs never have extensions, so stamp them.
  const stampBlobAnchors = (clone) => {
    clone.querySelectorAll('a[href^="blob:"]:not([download])').forEach((a) => {
      const t = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      a.setAttribute('download', t || 'file');
    });
  };

  const pruneEmptyDivs = (root) => {
    const divs = Array.from(root.querySelectorAll('div'));
    for (let i = divs.length - 1; i >= 0; i--) {
      const d = divs[i];
      if ((d.textContent || '').trim() !== '') continue;
      if (d.querySelector('img, canvas, video, audio, iframe, table, pre, code, blockquote, br, a[href]')) continue;
      d.remove();
    }
  };

  const topLevelAncestorIn = (node, root) => {
    let top = node;
    while (top.parentElement && top.parentElement !== root) top = top.parentElement;
    return top.parentElement === root ? top : null;
  };

  // ------------------------------------------------------------------
  // Asset URL absolutization
  // ------------------------------------------------------------------

  const ABSOLUTABLE = /^(https?:|data:|blob:)/i;

  const absolutize = (u) => {
    if (!u) return u;
    if (ABSOLUTABLE.test(u)) return u;
    try { return new URL(u, location.href).href; } catch (e) { return u; }
  };

  const absolutizeSrcset = (val) => {
    return val.split(',').map((part) => {
      const t = part.trim();
      if (!t) return '';
      const sp = t.search(/\s/);
      if (sp === -1) return absolutize(t);
      return absolutize(t.slice(0, sp)) + t.slice(sp);
    }).filter(Boolean).join(', ');
  };

  const absolutizeAssetUrls = (clone) => {
    try {
      clone.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src');
        if (src) {
          const abs = absolutize(src);
          if (abs !== src) img.setAttribute('src', abs);
        } else if (img.getAttribute('data-src')) {
          img.setAttribute('src', absolutize(img.getAttribute('data-src')));
          img.setAttribute('data-fl-src-promoted', 'data-src');
        }
        const ss = img.getAttribute('srcset');
        if (ss) {
          const abs = absolutizeSrcset(ss);
          if (abs !== ss) img.setAttribute('srcset', abs);
        }
      });
      clone.querySelectorAll('video[src], audio[src], source[src]').forEach((el) => {
        const s = el.getAttribute('src');
        const abs = absolutize(s);
        if (abs !== s) el.setAttribute('src', abs);
      });
      clone.querySelectorAll('source[srcset]').forEach((el) => {
        const s = el.getAttribute('srcset');
        const abs = absolutizeSrcset(s);
        if (abs !== s) el.setAttribute('srcset', abs);
      });
    } catch (e) { /* never break extraction over assets */ }
  };

  const collectAssets = (promptEl, respEl) => {
    const images = [];
    const media = [];
    const canvases = [];
    const plotHolders = [];
    const unresolvable = [];
    const seen = new Set();

    const scan = (root, origin) => {
      if (!root) return;
      try {
        root.querySelectorAll('img[src], img[data-src]').forEach((img) => {
          const promoted = !img.getAttribute('src') && !!img.getAttribute('data-src');
          const raw = img.getAttribute('src') || img.getAttribute('data-src') || '';
          const src = absolutize(raw);
          const key = origin + '|' + src;
          if (seen.has(key)) return;
          seen.add(key);
          const rec = { origin, src };
          const alt = img.getAttribute('alt');
          if (alt) rec.alt = alt.slice(0, 200);
          if (promoted) rec.lazyPromoted = true;
          if (/^blob:/i.test(src)) {
            rec.kind = 'blob-url';
            unresolvable.push(rec);
          } else if (/^data:/i.test(src)) {
            rec.kind = 'inline-data';
            images.push(rec);
          } else {
            images.push(rec);
          }
        });
        root.querySelectorAll('video, audio').forEach((el) => {
          const srcEl = el.querySelector('source');
          const raw = el.getAttribute('src') || (srcEl ? srcEl.getAttribute('src') : '');
          if (!raw) return;
          media.push({ origin, tag: el.tagName.toLowerCase(), src: absolutize(raw) });
        });
        root.querySelectorAll('canvas').forEach((c) => {
          canvases.push({ origin, id: c.id || null, width: c.width, height: c.height });
        });
        root.querySelectorAll('[id^="plt-canvas-"]').forEach((d) => {
          if (plotHolders.indexOf(d.id) === -1) plotHolders.push(d.id);
        });
      } catch (e) { /* inventory must never break capture */ }
    };

    scan(promptEl, 'prompt');
    scan(respEl, 'response');

    return { status: 'inventory-only — asset markup unsampled', images, media, canvases, plotHolders, unresolvable };
  };

  // ------------------------------------------------------------------
  // Turn enumeration
  // ------------------------------------------------------------------

  const findTurns = () => {
    const turns = [];
    document.querySelectorAll('div[id^="message-"]').forEach((el) => {
      const m = el.id.match(TURN_ID_RE);
      if (!m) return;
      let role = null;
      if (el.classList.contains('user-message') || el.querySelector('.chat-user')) {
        role = 'user';
      } else if (el.querySelector('.chat-assistant')) {
        role = 'assistant';
      }
      if (!role) return;
      turns.push({ el, role, id: m[1] });
    });
    return turns;
  };

  // ------------------------------------------------------------------
  // Attachment chips (chip markup VERIFIED; viewer handling PROVISIONAL)
  // ------------------------------------------------------------------

  const extOf = (filename) => {
    const m = (filename || '').match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : '';
  };

  // A chip = button with an /icons/ img + a leaf .truncate div (filename).
  // Copy/edit action buttons carry only svg, so they never match.

  // A chip = outer button (w-60) with: a kind/size span row, a leaf
  // .truncate filename div, and EITHER an /icons/<TYPE>.svg img (doc types)
  // OR a real media img (image chips nest a disabled button holding an
  // <img> whose src is the signed CDN URL — VERIFIED shape).
  const findAttachmentChips = (turnEl) => {
    const chips = [];
    turnEl.querySelectorAll('button').forEach((btn) => {
      const icon = btn.querySelector('img[src*="/icons/"]');
      const media = btn.querySelector('img[src*="z-cdn-media.chatglm.cn"]');
      if (!icon && !media) return;
      let nameEl = null;
      btn.querySelectorAll('div.truncate').forEach((d) => {
        if (!nameEl && d.childElementCount === 0) nameEl = d;
      });
      if (!nameEl) return;
      let kind = '', size = '';
      btn.querySelectorAll('span').forEach((s) => {
        const t = (s.textContent || '').trim();
        if (/^\d+(?:\.\d+)?\s*(?:B|KB|MB|GB)$/i.test(t)) size = t;
        else if (/^[A-Z0-9]{1,6}$/.test(t)) kind = t;
      });
      chips.push({
        el: btn,
        filename: (nameEl.textContent || '').trim(),
        kind, size,
        icon: icon ? icon.getAttribute('src') : '',
        mediaSrc: media ? media.getAttribute('src') : '',  // signed CDN URL (image chips)
      });
    });
    return chips;
  };

  // Bits UI dialog contract (VERIFIED from live sample):
  //   root: div[role="dialog"][data-dialog-content][data-state="open"]
  //   X:    button[data-dialog-close]   inside the root
  //   title: [data-dialog-title] — the attachment filename
  const findDialogRoot = () => {
    const roots = Array.from(document.querySelectorAll(
      'div[role="dialog"][data-dialog-content][data-state="open"]'))
      .filter((el) => isVisible(el) && (el.textContent || '').trim().length > 0);
    roots.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length);
    return roots[0] || null;
  };

  // The dialog shell (title included) mounts immediately; the file payload
  // arrives via an async fetch. Wait for the pre-wrap BODY to fill, not just
  // the dialog to appear. Returns the root even if the payload never fills
  // (timeout) so the caller can log an honest "empty" failure.
  const waitForViewer = async (timeoutMs) => {
    const t0 = Date.now();
    let root = null;
    for (;;) {
      root = findDialogRoot();
      if (root) {
        const pre = root.querySelector('.whitespace-pre-wrap');
        if (pre && (pre.textContent || '').trim().length > 0) return root;
      }
      if (Date.now() - t0 > timeoutMs) return root; // may be shell-only
      await sleep(150);
    }
  };

  const extractViewerText = (root) => {
    const pre = root.querySelector('.whitespace-pre-wrap');
    if (pre) return pre.textContent || '';
    const title = root.querySelector('[data-dialog-title]');
    const clone = root.cloneNode(true);
    if (title) {
      const tc = clone.querySelector('[data-dialog-title]');
      if (tc) tc.remove();
    }
    clone.querySelectorAll('button, svg').forEach((el) => el.remove());
    return clone.textContent || '';
  };

  const closeViewer = async (root) => {
    const esc = (t) => t && t.dispatchEvent && t.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
    const stillOpen = () => root.isConnected &&
      root.getAttribute('data-state') === 'open' && isVisible(root);

    // 1. The dialog's own X button (verified contract)
    const closer = root.querySelector('button[data-dialog-close]');
    if (closer) { try { closer.click(); } catch (e) { /* noop */ } await sleep(250); }
    if (!stillOpen()) return true;

    // 2. Escape bubbling from inside the dialog (wrapper-level handler)
    esc(root.querySelector('button, [tabindex]') || root);
    esc(document.activeElement);
    await sleep(250);
    if (!stillOpen()) return true;

    // 3. Last resort: backdrop-ish click on the dialog root corner
    try {
      const r = root.getBoundingClientRect();
      root.dispatchEvent(new MouseEvent('click',
        { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
    } catch (e) { /* noop */ }
    await sleep(250);
    return !stillOpen();
  };

  const bulkPreExtract = async () => {
    if (!ENABLE_ATTACHMENT_HARVEST) return;
    const userTurns = findTurns().filter((t) => t.role === 'user');
    const chipLists = userTurns.map((t) => findAttachmentChips(t.el));
    const total = chipLists.reduce((n, l) => n + l.length, 0);
    if (!total) return;
    log('bulkPreExtract: ' + total + ' attachment chip(s) detected');
    let done = 0, harvested = 0, failed = 0;
    for (const chips of chipLists) {
      for (const chip of chips) {
        done++;
        setStatus('Attachment ' + done + '/' + total + ': ' + chip.filename);
        const ext = extOf(chip.filename);
        if (chip.mediaSrc || ['jpg','jpeg','png','gif','webp'].includes(ext)) {
          setStatus('Attachment ' + done + '/' + total + ' (image): ' + chip.filename);
          try {
            let blob = null;
            try {
              const r = await fetch(chip.mediaSrc);            // tier 1: in-page
              if (!r.ok) throw new Error('HTTP ' + r.status);
              blob = await r.blob();
            } catch (pageErr) {
              // tier 2: SW fetch ignores CORS for hosts in host_permissions.
              // A stale signature surfaces here as 'HTTP 403' — distinct
              // from the CORS failure that lands us in this catch.
              log('in-page fetch failed (' + String(pageErr).slice(0, 80) + ') — trying background');
              const resp = await chrome.runtime.sendMessage({ type: 'FETCH_ASSET', url: chip.mediaSrc });
              if (!resp || !resp.ok) throw new Error(resp ? resp.error : 'no background response');
              blob = await (await fetch(resp.dataUrl)).blob();
            }
            if (blob.size > 10 * 1024 * 1024) throw new Error('over 10MB content.js blob limit');
            const blobUrl = URL.createObjectURL(blob);
            chip.el.setAttribute('data-fl-attachment-blob', blobUrl);
            chip.el.setAttribute('data-fl-attachment-name', chip.filename);
            chip.el.setAttribute('data-fl-attachment-mime', blob.type || 'application/octet-stream');
            chip.el.removeAttribute('data-fl-attachment-skip');
            harvested++;
            log('harvested image ' + chip.filename + ' (' + blob.size + ' B)');
          } catch (e) {
            logErr('image harvest failed for ' + chip.filename + ':', String(e));
            chip.el.setAttribute('data-fl-attachment-skip', 'fetch-failed');
            failed++;
          }
          continue;
        }

        if (!SAFE_TEXT_EXT.has(ext)) {
          // PDF/video/etc: viewer shape unsampled. PDFs render via stale
          // signed URL (403s); no in-page fetch URL is known yet. Record.
          log('skip (type .' + ext + ' not yet harvestable): ' + chip.filename);
          chip.el.setAttribute('data-fl-attachment-skip', 'type-' + (ext || 'none'));
          continue;
        }

        if (!SAFE_TEXT_EXT.has(ext)) {
          log('skip (type .' + ext + ' not yet sampled): ' + chip.filename);
          chip.el.setAttribute('data-fl-attachment-skip', 'type-' + (ext || 'none'));
          continue;
        }
        chip.el.click();
        const viewer = await waitForViewer(6000);
        if (!viewer) {
          logErr('no viewer appeared for ' + chip.filename);
          chip.el.setAttribute('data-fl-attachment-skip', 'no-viewer');
          failed++;
          continue;
        }
        const text = extractViewerText(viewer);
        const closed = await closeViewer(viewer);
        if (!text.trim()) {
          logErr('viewer payload stayed empty for ' + chip.filename +
            (closed ? '' : ' (viewer left open)'));
          chip.el.setAttribute('data-fl-attachment-skip', 'empty');
          failed++;
          continue;
        }
        const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        chip.el.setAttribute('data-fl-attachment-blob', blobUrl);
        chip.el.setAttribute('data-fl-attachment-name', chip.filename);
        if (chip.kind) chip.el.setAttribute('data-fl-attachment-kind', chip.kind);
        if (chip.size) chip.el.setAttribute('data-fl-attachment-size', chip.size);
        chip.el.removeAttribute('data-fl-attachment-skip');
        harvested++;
        log('harvested ' + chip.filename + ' (' + text.length + ' chars)' +
            (closed ? '' : ' [viewer left open — close failed]'));
      }
    }
    setStatus('Attachments captured: ' + harvested + '/' + total +
      (failed ? ' (' + failed + ' failed — see debug log)' : ''),
      failed > 0 ? 'error' : 'info');
  };

  // Stamped chips -> download anchors (content.js's existing blob pipeline).
  // Unstamped chips -> honest placeholders: records the miss in the
  // transcript AND stops the /icons/*.svg img from being downloaded as
  // media. Live logging never harvests (bulkPreExtract is bulk-only), so
  // live rounds will always show the placeholder form.
  const rewriteAttachmentChips = (clone) => {
    clone.querySelectorAll('button').forEach((chip) => {
      const blobUrl = chip.getAttribute('data-fl-attachment-blob');
      let nameEl = null;
      chip.querySelectorAll('div.truncate').forEach((d) => {
        if (!nameEl && d.childElementCount === 0) nameEl = d; // leaf = filename
      });
      const name = ((blobUrl ? chip.getAttribute('data-fl-attachment-name') : null) ||
                    (nameEl ? nameEl.textContent : '') || '').trim();
      if (!blobUrl && !name) return; // ordinary action button — leave alone
      if (blobUrl) {
        const kind = chip.getAttribute('data-fl-attachment-kind');
        const size = chip.getAttribute('data-fl-attachment-size');
        const a = document.createElement('a');
        a.setAttribute('href', blobUrl);
        a.setAttribute('download', name || 'attachment');
        const mime = chip.getAttribute('data-fl-attachment-mime');
        if (mime) a.setAttribute('type', mime);
        a.textContent = '[attachment: ' + name +
          (kind ? ', ' + kind.toLowerCase() : '') + (size ? ', ' + size : '') + ']';
        chip.replaceWith(a);
      } else {
        const reason = chip.getAttribute('data-fl-attachment-skip') || 'not-captured';
        const span = document.createElement('span');
        span.setAttribute('data-fl-attachment', reason);
        span.textContent = '[attachment: ' + name + ' — not captured: ' + reason + ']';
        chip.replaceWith(span);
      }
    });
  };

  const collectAttachmentRecords = (turnEl) => {
    return findAttachmentChips(turnEl).map((chip) => ({
      filename: chip.filename,
      kind: chip.kind || null,
      sizeLabel: chip.size || null,
      icon: chip.icon || null,
      ext: extOf(chip.filename) || null,
      harvested: chip.el.hasAttribute('data-fl-attachment-blob'),
      skipped: chip.el.getAttribute('data-fl-attachment-skip') || null,
    }));
  };

  // ------------------------------------------------------------------
  // Part extractors
  // ------------------------------------------------------------------

  const promptHtmlOf = (turn) => {
    const user = turn.querySelector('.chat-user');
    if (!user) return '';
    const clone = user.cloneNode(true);
    stampBlobAnchors(clone);
    stripChrome(clone, PROMPT_EXTRA_STRIP);
    rewriteAttachmentChips(clone);
    absolutizeAssetUrls(clone);
    pruneEmptyDivs(clone);
    return clone.innerHTML.trim();
  };

  const thinkingInfoOf = (turn) => {
    const header = turn.querySelector('.thinking-chain-container');
    const body = turn.querySelector('.thinking-block');
    let html = '';
    if (body) {
      const quote = body.querySelector('blockquote');
      const clone = (quote || body).cloneNode(true);
      clone.querySelectorAll('button, svg').forEach((el) => el.remove());
      absolutizeAssetUrls(clone);
      html = (quote ? clone.outerHTML : clone.innerHTML).trim();
    }
    return {
      html,
      headerPresent: !!header,
      contentCaptured: !!body,
      collapsedAtRest: !!header && !body,
      direct: header ? header.getAttribute('data-direct') : null,
    };
  };

  const cmToPre = (cm) => {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const content = cm.querySelector('.cm-content');
    const lang = content ? content.getAttribute('data-language') : null;
    if (lang) code.setAttribute('data-language', lang);
    if (content) {
      content.querySelectorAll('.cm-gap').forEach((g) => {
        const marker = document.createElement('div');
        marker.setAttribute('data-forensic-cm-gap', g.getAttribute('style') || '');
        marker.textContent = '[… lines elided by in-app code-editor virtualization …]';
        g.replaceWith(marker);
      });
      const lines = [];
      Array.from(content.children).forEach((child) => {
        if (child.hasAttribute('data-forensic-cm-gap') ||
            child.classList.contains('cm-line')) {
          lines.push(child.textContent || '');
        }
      });
      code.textContent = lines.join('\n');
    }
    pre.appendChild(code);
    return pre;
  };

  const responseHtmlOf = (turn) => {
    const container = turn.querySelector('#response-content-container');
    const prose = container
      ? container.querySelector('.markdown-prose')
      : turn.querySelector('.chat-assistant .markdown-prose');
    if (!prose) return '';

    const clone = prose.cloneNode(true);
    stampBlobAnchors(clone);

    clone.querySelectorAll('.thinking-chain-container').forEach((el) => el.remove());
    clone.querySelectorAll('.thinking-block').forEach((tb) => {
      const top = topLevelAncestorIn(tb, clone);
      (top || tb).remove();
    });

    Array.from(clone.querySelectorAll('.cm-editor')).forEach((cm) => {
      const pre = cmToPre(cm);
      const top = topLevelAncestorIn(cm, clone);
      if (top) top.replaceWith(pre); else cm.replaceWith(pre);
    });

    stripChrome(clone, RESPONSE_EXTRA_STRIP);
    absolutizeAssetUrls(clone);
    return clone.innerHTML.trim();
  };

  const userBubbleExpanded = (turn) => {
    const el = turn.querySelector('[data-expanded]');
    return el ? el.getAttribute('data-expanded') !== 'false' : null;
  };

  const roundHtmlOf = (promptHtml, think, responseHtml, ids) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-forensic-round', 'zai');
    if (ids.promptId) wrap.setAttribute('data-prompt-message-id', ids.promptId);
    if (ids.responseId) wrap.setAttribute('data-response-message-id', ids.responseId);
    if (promptHtml) {
      const p = document.createElement('div');
      p.setAttribute('data-role', 'prompt');
      p.innerHTML = promptHtml;
      wrap.appendChild(p);
    }
    if (think.html) {
      const t = document.createElement('div');
      t.setAttribute('data-role', 'thinking');
      t.setAttribute('data-collapsed-at-rest', String(think.collapsedAtRest));
      t.innerHTML = think.html;
      wrap.appendChild(t);
    } else if (think.headerPresent) {
      wrap.setAttribute('data-thinking-collapsed-at-rest', 'true');
    }
    if (responseHtml) {
      const r = document.createElement('div');
      r.setAttribute('data-role', 'response');
      r.innerHTML = responseHtml;
      wrap.appendChild(r);
    }
    return wrap.outerHTML;
  };

  // ------------------------------------------------------------------
  // Metadata (session/model/sessionId are PROVISIONAL heuristics)
  // ------------------------------------------------------------------

  const sessionGuess = () => {
    try {
      const segs = location.pathname.split('/').filter(Boolean);
      const last = segs[segs.length - 1] || '';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(last)) return last;
      if (/^[A-Za-z0-9_-]{10,}$/.test(last) && !/^(chat|c|session)$/i.test(last)) return last;
      return '';
    } catch (e) { return ''; }
  };

  const modelGuess = () => {
    try {
      const nodes = document.querySelectorAll('header button, [class*="model" i]');
      for (const n of nodes) {
        const m = (n.textContent || '').match(MODEL_RE);
        if (m) return m[0];
      }
    } catch (e) { /* noop */ }
    return '';
  };

  const buildRound = (turns, uIdx, aIdx, roundIndex, extra) => {
    const u = turns[uIdx];
    const a = aIdx >= 0 ? turns[aIdx] : null;
    const think = a ? thinkingInfoOf(a.el)
      : { html: '', headerPresent: false, contentCaptured: false, collapsedAtRest: false, direct: null };
    const promptHtml = promptHtmlOf(u.el);
    const responseHtml = a ? responseHtmlOf(a.el) : '';
    const assets = collectAssets(u.el, a ? a.el : null);

    const meta = {
      service: 'zai',
      roundIndex,
      capturedAt: new Date().toISOString(),
      url: location.href,
      sessionId: sessionGuess(),
      model: modelGuess(),
      promptMessageId: u.id,
      responseMessageId: a ? a.id : null,
      turnsInDom: turns.length,
      userBubbleExpanded: userBubbleExpanded(u.el),
      thinking: {
        headerPresent: think.headerPresent,
        contentCaptured: think.contentCaptured,
        collapsedAtRest: think.collapsedAtRest,
        direct: think.direct,
      },
      assets,
      attachments: collectAttachmentRecords(u.el),
      codeGapCount: a ? a.el.querySelectorAll('.cm-gap').length : 0,
      selectorsVerified: {
        turns: true, prompt: true, response: true, thinking: true,
        attachmentChip: true, attachmentViewer: true,
        sessionName: false, model: false, sessionId: false,
      },
    };
    if (extra) Object.assign(meta, extra);

    return {
      promptHtml,
      thinkingHtml: think.html,
      responseHtml,
      roundHtml: roundHtmlOf(promptHtml, think, responseHtml, {
        promptId: u.id,
        responseId: a ? a.id : null,
      }),
      metadata: meta,
    };
  };

  // ------------------------------------------------------------------
  // Contract functions
  // ------------------------------------------------------------------

  const extract = () => {
    const turns = findTurns();
    if (!turns.length) { logErr('extract: no #message-<uuid> turns in DOM'); return null; }
    let u = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === 'user') { u = i; break; }
    }
    if (u === -1) { logErr('extract: no user turn found'); return null; }
    let a = -1;
    for (let i = u + 1; i < turns.length; i++) {
      if (turns[i].role === 'assistant') { a = i; break; }
    }
    // The site mounts an empty assistant shell at send time; the body
    // streams in later. content.js's 1.5s debounce can land in that gap,
    // and its duplicate-prompt guard would freeze the round empty forever.
    // Defer: returning null leaves the dedup state unset, so the next
    // mutation after the response streams triggers a full capture.
    if (a === -1) { log('extract: deferring — assistant turn not mounted yet'); return null; }
    if (!responseHtmlOf(turns[a].el)) {
      log('extract: deferring — assistant shell present, response body still empty');
      return null;
    }
    return buildRound(turns, u, a, -1, null);
  };

  // The toggle button holds TWO svgs (brain icon, then chevron); only the
  // chevron carries -rotate-90 when closed, so test all of them.
  const expandCollapsedThinking = async () => {
    const buttons = Array.from(document.querySelectorAll('.thinking-chain-container button'))
      .filter((btn) => Array.from(btn.querySelectorAll('svg')).some((s) =>
        /(^|\s)-rotate-90(\s|$)/.test(s.getAttribute('class') || '')));
    const opened = [];
    for (let i = 0; i < buttons.length; i++) {
      setStatus('Opening thinking block ' + (i + 1) + '/' + buttons.length);
      try { buttons[i].click(); opened.push(buttons[i]); } catch (e) { logErr('expand click failed', e); }
      await sleep(120);
    }
    return opened;
  };

  const waitThinkingMounted = async (opened, timeoutMs) => {
    const t0 = Date.now();
    for (;;) {
      const allIn = opened.every((btn) => {
        const msg = btn.closest('div[id^="message-"]');
        return msg ? !!msg.querySelector('.thinking-block') : true;
      });
      if (allIn) return true;
      if (Date.now() - t0 > timeoutMs) return false;
      await sleep(120);
    }
  };

  const bulkExtract = async () => {
    const opened = await expandCollapsedThinking();
    let expandOk = true;
    if (opened.length) {
      expandOk = await waitThinkingMounted(opened, 2500);
      if (!expandOk) logErr('bulkExtract: some thinking blocks did not mount in time');
    }
    try {
      const turns = findTurns();
      const rounds = [];
      const extra = opened.length ? { bulkExpand: { expanded: opened.length, mounted: expandOk } } : null;
      for (let i = 0; i < turns.length; i++) {
        if (turns[i].role !== 'user') continue;
        let a = -1;
        for (let j = i + 1; j < turns.length; j++) {
          if (turns[j].role === 'assistant') { a = j; break; }
        }
        let round = null;
        try {
          round = buildRound(turns, i, a, rounds.length, extra);
        } catch (e) {
          logErr('buildRound failed for roundIndex ' + rounds.length + ' (turn #' + i + '):',
                 e && (e.stack || e.message || e));
        }
        if (round && (round.promptHtml || round.responseHtml || round.roundHtml)) rounds.push(round);
        if (a > i) i = a;
      }
      if (!rounds.length) {
        logErr('bulkExtract: ' + turns.length + ' turn(s) found but no user→assistant pairs');
      }
      setStatus('Extraction complete: ' + rounds.length + ' rounds');
      return rounds;
    } finally {
      if (opened.length) {
        await sleep(150);
        try {
          opened.forEach((b) => { if (b.isConnected) b.click(); });
        } catch (e) {
          logErr('bulkExtract: restore of thinking toggles failed (UI left expanded)', e);
        }
      }
    }
  };

  const getSessionName = () => {
    for (const sel of SESSION_SELECTORS) {
      let n = null;
      try { n = document.querySelector(sel); } catch (e) { continue; }
      const t = n ? (n.textContent || '').trim() : '';
      if (t) return t.slice(0, 200);
    }
    const first = document.querySelector('.chat-user');
    if (first) {
      const t = (first.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t.length > 50 ? t.slice(0, 50) + '…' : t;
    }
    return '';
  };

  const guarded = (name, fn) => (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') {
        return r.catch((e) => {
          logErr(name + ' rejected:', e && (e.stack || e.message || e));
          throw e;
        });
      }
      return r;
    } catch (e) {
      logErr(name + ' threw:', e && (e.stack || e.message || e));
      throw e;
    }
  };

  window.ForensicModules.zai = {
    match: (host) => host === 'chat.z.ai' || host.endsWith('.chat.z.ai'),
    extract: guarded('extract', extract),
    bulkExtract: guarded('bulkExtract', bulkExtract),
    getSessionName: guarded('getSessionName', getSessionName),
    bulkPreExtract: guarded('bulkPreExtract', bulkPreExtract),
  };
})();
