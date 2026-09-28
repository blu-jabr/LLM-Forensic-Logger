// @match *://gemini.google.com/*
// @match *://*.googleusercontent.com/*
// @host_permissions *://gemini.google.com/*
// @host_permissions *://*.googleusercontent.com/*
//
// Gemini module — owns ALL Gemini-specific logic:
//   live-DOM chip stamping, citation URL caches + passive harvesters
//   (hover dialogs, overlays, window.open/anchor relay), parsed-document
//   chip resolution via the processParsedDoc hook, jslog decoding.
// dlog/derr come from modules/index.js (loaded first).

(function() {
    const match = (host, path) => host.includes('gemini.google.com');

    const ENABLE_KEYBOARD_HARVEST = false;   // experimental bulk harvester, see below

    const glog = (...a) => { if (typeof dlog === 'function') dlog(...a); else console.log('[FL:gemini]', ...a); };
    const gerr = (...a) => { if (typeof derr === 'function') derr(...a); else console.error('[FL:gemini]', ...a); };

    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

    // ─── Stable cross-render chip key ───
    // Chunk prefix + citation ordinal within that chunk. Absolute ordinals
    // shift on re-render; relative order is stable.
    function stableChipKey(chip) {
        try {
            const doc = chip.ownerDocument || document;
            const holder = chip.closest('[id^="p-rc_"]');
            if (!holder) return null;
            const m = holder.id.match(/^p-rc_([0-9a-f]+)-(\d+)$/);
            if (!m) return null;
            const prefix = m[1];
            const holders = [...doc.querySelectorAll(`[id^="p-rc_${prefix}-"]`)]
                .filter(el => /^p-rc_[0-9a-f]+-\d+$/.test(el.id))
                .sort((a, b) => parseInt(a.id.match(/-(\d+)$/)[1], 10) - parseInt(b.id.match(/-(\d+)$/)[1], 10));
            const idx = holders.indexOf(holder);
            return idx < 0 ? null : `${prefix}#${idx}`;
        } catch (e) {
            return null;   // key computation must never break capture
        }
    }

    // Stamp each chip with its stable key + cid so the mapping survives
    // serialization. The p-rc_ paragraph ids do not survive re-parse
    // (block-in-<p> re-parenting), so the mapping must travel ON the chip.
    const stampChips = (scope) => {
        try {
            scope.querySelectorAll('source-inline-chip, .source-inline-chip-container').forEach(chip => {
                const holder = chip.closest('[id^="p-rc_"]');
                if (!holder) return;
                chip.setAttribute('data-fl-cid', holder.id);
                const skey = stableChipKey(chip);
                if (skey) chip.setAttribute('data-fl-skey', skey);
            });
        } catch (e) { gerr('stampChips failed:', e); }
    };

    // ─── Citation URL caches (passive harvesters) ───
    // Chips are Angular buttons; the target URL is absent from the DOM at
    // rest. Title cache: learned from real anchors in dialogs/overlays and
    // window.open interceptions (modules/inject_main_world.js).
    // ID cache: precise, per-chip-instance (stable key first, cid fallback).
    const citationUrlCache = new Map();
    let cacheSaveTimer = null;
    function cachePut(key, url) {
        citationUrlCache.set(key, url);
        clearTimeout(cacheSaveTimer);
        cacheSaveTimer = setTimeout(() => {
            try { chrome.storage.local.set({ citationUrlCache: Object.fromEntries(citationUrlCache) }); } catch (e) {}
        }, 500);
    }
    chrome.storage.local.get(['citationUrlCache'], (d) => {
        const obj = d.citationUrlCache || {};
        for (const [k, v] of Object.entries(obj)) citationUrlCache.set(k, v);
    });

    const citationIdCache = new Map();
    let idCacheSaveTimer = null;
    function cacheIdPut(id, url) {
        citationIdCache.set(id, url);
        clearTimeout(idCacheSaveTimer);
        idCacheSaveTimer = setTimeout(() => {
            try { chrome.storage.local.set({ citationIdCache: Object.fromEntries(citationIdCache) }); } catch (e) {}
        }, 500);
    }
    chrome.storage.local.get(['citationIdCache'], (d) => {
        const obj = d.citationIdCache || {};
        for (const [k, v] of Object.entries(obj)) citationIdCache.set(k, v);
    });

    // Chip titles and hover-card text differ in length; match both directions.
    // Match provenance is recorded so consumers know how the URL was associated.
    function lookupChipUrl(label) {
        const key = norm(label).slice(0, 120);
        if (citationUrlCache.has(key)) return { url: citationUrlCache.get(key), match: 'exact' };
        let best = null;
        for (const [k, v] of citationUrlCache) {
            let m = null;
            if (k.startsWith(key) && key.length >= 3) m = 'chip-title-prefix-of-cached';
            else if (key.startsWith(k) && k.length >= 3) m = 'cached-prefix-of-chip-title';
            if (m && (!best || k.length > best.k.length)) best = { k, v, m }; // most specific wins
        }
        return best || { url: null, match: null };
    }

    // ─── Hover tracking + freshness gate ───
    let lastHoveredChipTitle = null;
    let lastHoveredChipContainerId = null;
    let lastHoveredChipStableKey = null;
    let lastHoveredAt = 0;
    let pendingOpenQueue = [];

    function harvestCitationUrls(root) {
        try {
            if (!root || !root.querySelectorAll) return;
            const scope = root.closest ? (root.closest('[role="dialog"], .cdk-overlay-container') || root) : root;
            const titleEl = scope.querySelector ? scope.querySelector('.source-title, h2, h3') : null;
            const titleText = titleEl ? titleEl.textContent : '';
            scope.querySelectorAll('a[href]').forEach(a => {
                const href = a.href || '';
                if (!/^https?:/i.test(href)) return;
                if (/google\.(com|co)|gstatic\.com|googleusercontent\.com/i.test(href)) return;
                const label = (titleText || a.textContent || '').replace(/\s+/g, ' ').trim();
                const key = norm(label).slice(0, 120);
                if (label && citationUrlCache.get(key) !== href) {
                    cachePut(key, href);
                    glog('Cached citation:', label, '->', href);
                }
            });
        } catch (e) { /* harvesting must never break logging */ }
    }

    document.addEventListener('mouseover', (e) => {
        const el = e.target;
        if (el && el.closest && el.closest('[role="dialog"], .cdk-overlay-container')) {
            harvestCitationUrls(el);
        }
        const chip = el && el.closest ? el.closest('source-inline-chip, .source-inline-chip-container') : null;
        if (chip) {
            const t = chip.querySelector('.source-title');
            if (t) lastHoveredChipTitle = (t.textContent || '').replace(/\s+/g, ' ').trim();
            lastHoveredAt = Date.now();
            const holder = chip.closest('[id^="p-rc_"]');
            lastHoveredChipContainerId = holder ? holder.id : null;
            lastHoveredChipStableKey = stableChipKey(chip);
        }
    }, true);

    new MutationObserver((muts) => {
        muts.forEach(m => m.addedNodes.forEach(n => {
            if (n.nodeType === 1) harvestCitationUrls(n);
        }));
    }).observe(document.body, { childList: true, subtree: true });

    // Receive navigation events intercepted in the MAIN world.
    // Freshness gate: only associate a URL with a chip if the mouse hovered
    // it within the last 5 seconds (prevents stale-pairing / hover-card
    // poisoning).
    window.addEventListener('message', (event) => {
        if (!event.data || event.data.type !== 'FORENSIC_WINDOW_OPEN') return;
        const d = event.data;
        if (!d.url || !/^https?:/i.test(d.url)) return;

        pendingOpenQueue.push(d.url);
        glog('Intercepted citation URL:', d.url);

        if (Date.now() - lastHoveredAt < 5000) {
            if (lastHoveredChipStableKey) {
                const existing = citationIdCache.get(lastHoveredChipStableKey);
                if (!existing) {
                    cacheIdPut(lastHoveredChipStableKey, d.url);
                } else if (Array.isArray(existing)) {
                    if (!existing.includes(d.url)) cacheIdPut(lastHoveredChipStableKey, existing.concat(d.url));
                } else if (existing !== d.url) {
                    cacheIdPut(lastHoveredChipStableKey, [existing, d.url]);
                }
            }
            if (lastHoveredChipTitle) cachePut(norm(lastHoveredChipTitle).slice(0, 120), d.url);
            glog('Associated with chip:', lastHoveredChipTitle,
                 lastHoveredChipContainerId, 'skey=', lastHoveredChipStableKey, 'url=', d.url);
        }
    });

    // ─── Parsed-document chip resolution (content.js hook) ───
    // Runs on each DOMParser-parsed section BEFORE markdown conversion.
    // Resolution order per chip: stable-key cache (exact) -> container-id
    // cache (exact) -> title cache (only when title is unique in the round)
    // -> nested anchor (always wins). Rewrites each chip to markdown link(s).
    const processParsedDoc = (doc, ctx) => {
        try {
            // Count chips sharing each normalized title so title-based
            // matches can be flagged as ambiguous when N > 1.
            const titleCounts = new Map();
            doc.querySelectorAll('source-inline-chip, .source-inline-chip-container').forEach(c => {
                const t = c.querySelector('.source-title');
                const k = norm(t ? t.textContent : '').slice(0, 120);
                if (k) titleCounts.set(k, (titleCounts.get(k) || 0) + 1);
            });

            doc.querySelectorAll('source-inline-chip, .source-inline-chip-container').forEach(chip => {
                if (!chip.parentNode) return;

                // Collect every source title the chip exposes (multi-source
                // chips may list several; the opened dialog may hold more).
                const titleEls = chip.querySelectorAll('.source-title');
                const labels = [...titleEls].map(t => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
                const label = labels[0] || (chip.textContent || '').replace(/\s+/g, ' ').trim();
                if (!label) { chip.remove(); return; }

                const sameTitleCount = titleCounts.get(norm(label).slice(0, 120)) || 0;

                const holder = chip.closest('[id^="p-rc_"]');
                const cid = chip.getAttribute('data-fl-cid') || (holder ? holder.id : null);
                const skey = chip.getAttribute('data-fl-skey') || stableChipKey(chip);

                let urls = skey ? (citationIdCache.get(skey) || null) : null;
                let matchType = urls ? 'stable-key' : null;

                if (!urls) {
                    urls = cid ? (citationIdCache.get(cid) || null) : null;
                    if (urls) matchType = 'container-id';
                }

                if (!urls) {
                    const lookedUp = lookupChipUrl(label);
                    // Title-based fallback only when this title is unique in
                    // the round; shared titles (Wikipedia, DoE...) are ambiguous.
                    if (lookedUp.url && sameTitleCount <= 1) {
                        urls = lookedUp.url;
                        matchType = lookedUp.match;
                    }
                }

                // A real anchor nested inside the chip (rare) always wins
                const innerA = chip.querySelector('a[href]');
                if (innerA && /^https?:/i.test(innerA.href)) {
                    urls = innerA.href;
                    matchType = 'nested-anchor';
                }

                const urlList = Array.isArray(urls) ? urls : (urls ? [urls] : []);

                glog('ChipResolve:', label.slice(0, 40), 'skey=' + skey, 'cid=' + cid, 'hits=' + urlList.length);

                const entry = { source_title: label, url: urlList[0] || null };
                if (cid) entry.container_id = cid;
                if (skey) entry.stable_key = skey;
                if (urlList.length > 1) entry.urls = urlList;

                if (urlList.length && matchType && matchType !== 'exact') {
                    const titleBased = matchType === 'chip-title-prefix-of-cached' ||
                                       matchType === 'cached-prefix-of-chip-title';
                    entry.url_match_type = (titleBased && sameTitleCount > 1)
                        ? matchType + '+title-shared' : matchType;
                }

                if (labels.length > 1) {
                    entry.all_source_titles = labels;
                    entry.source_list_complete = false; // dialog may enumerate more
                }

                // Decode jslog BardVeMetadataKey ->
                // [response_id, conversation_id, null, chunk_id]
                const btn = chip.querySelector('button[jslog*="BardVeMetadataKey"]');
                if (btn) {
                    const m = (btn.getAttribute('jslog') || '').match(/BardVeMetadataKey:([A-Za-z0-9+\/=]+)/);
                    if (m) {
                        try {
                            const arr = JSON.parse(atob(m[1]));
                            if (Array.isArray(arr) && Array.isArray(arr[0])) {
                                entry.response_id = arr[0][0] || null;
                                entry.conversation_id = arr[0][1] || null;
                                entry.chunk_id = arr[0][3] || null;
                            }
                        } catch (e) { /* ignore malformed jslog */ }
                    }
                }

                ctx.chips.push(entry);

                const mdText = urlList.length === 0
                    ? ` [${label}] `
                    : urlList.map(u => ` [${label}](${u}) `).join('');
                chip.replaceWith(doc.createTextNode(mdText));
            });
        } catch (e) { gerr('processParsedDoc failed:', e); }
    };

    // ─── Experimental bulk-time harvester (flag-gated) ───
    // Clicks each unique chip once with tab-opens swallowed, capturing the
    // dialog URL. Runs only when ENABLE_KEYBOARD_HARVEST is true.
    async function harvestChipsViaClicks() {
        const chips = [...document.querySelectorAll('source-inline-chip')];
        const byTitle = new Map();
        chips.forEach(chip => {
            const t = chip.querySelector('.source-title');
            const label = t ? t.textContent.replace(/\s+/g, ' ').trim() : '';
            if (label && !byTitle.has(norm(label).slice(0, 120))) byTitle.set(norm(label).slice(0, 120), chip);
        });
        if (byTitle.size === 0) return;
        glog(`Harvesting ${byTitle.size} unique citation chip(s) via keyboard...`);
        window.postMessage({ type: 'FORENSIC_SET_HARVEST', value: true }, '*');
        await new Promise(r => setTimeout(r, 150));

        try {
            for (const [key, chip] of byTitle) {
                if (citationUrlCache.has(key)) continue; // already known
                const btn = chip.querySelector('button');
                if (!btn) continue;
                const before = pendingOpenQueue.length;
                lastHoveredChipTitle = key;
                btn.focus();
                btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                await new Promise(r => setTimeout(r, 700));

                let url = null;
                const dlg = document.querySelector('[role="dialog"]');
                if (dlg) {
                    const a = [...dlg.querySelectorAll('a[href]')]
                        .find(a => /^https?:/i.test(a.href) && !/google\.(com|co)|gstatic\.com|googleusercontent\.com/i.test(a.href));
                    if (a) url = a.href;
                    if (!url) {  // URL may live in a data-* attribute on the source cards
                        for (const el of dlg.querySelectorAll('*')) {
                            for (const attr of el.attributes) {
                                if (attr.name.startsWith('data-') && /^https?:/i.test(attr.value)) { url = attr.value; break; }
                            }
                            if (url) break;
                        }
                    }
                    if (!url) {  // last resort: click the first card, rely on open-interception
                        const card = dlg.querySelector('button, [role="button"]');
                        if (card) { card.click(); await new Promise(r => setTimeout(r, 500)); }
                        if (pendingOpenQueue.length > before) url = pendingOpenQueue[pendingOpenQueue.length - 1];
                    }
                }
                if (!url && pendingOpenQueue.length > before) url = pendingOpenQueue[pendingOpenQueue.length - 1];

                if (url) { cachePut(key, url); glog('Harvested:', key, '->', url); }
                else glog('No URL captured for:', key);

                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await new Promise(r => setTimeout(r, 200));
                if (document.querySelector('[role="dialog"]')) {  // synthetic Escape ignored?
                    const x = document.querySelector('[role="dialog"] [aria-label*="lose"], [role="dialog"] button[aria-label*="Close"]');
                    if (x) x.click();
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        } finally {
            lastHoveredChipTitle = null;
            window.postMessage({ type: 'FORENSIC_SET_HARVEST', value: false }, '*');
        }
    }

    async function bulkPreExtract() {
        if (ENABLE_KEYBOARD_HARVEST) await harvestChipsViaClicks();
    }

    // ─── Round extraction (unchanged) ───

    const cleanNode = (node) => {
        if (!node) return "";
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button[aria-label="Copy"], button[aria-label="Listen"], button[aria-label="Share"], button[aria-label="Edit"], button[aria-label="Good response"], button[aria-label="Bad response"], button[aria-label="Generate more"]').forEach(el => el.remove());
        return clone.outerHTML || clone.innerHTML;
    };

    const rawClone = (node) => {
        if (!node) return "";
        return node.cloneNode(true).outerHTML;
    };

    const getSessionName = () => {
        const activeItem = document.querySelector('.chat-history-item-selected, [aria-current="page"] .conversation-title, [data-test-id="conversation-title"]');
        if (activeItem && activeItem.innerText.trim() && !activeItem.innerText.includes("Flash")) {
            return activeItem.innerText.trim();
        }
        const firstPrompt = document.querySelector('user-query-content, user-query, .query-text');
        if (firstPrompt && firstPrompt.innerText.trim()) {
            const text = firstPrompt.innerText.trim().replace(/\n/g, ' ');
            return text.length > 50 ? text.substring(0, 50) + "..." : text;
        }
        return "Untitled Gemini Session";
    };

    const extractMetadata = (node) => {
        if (!node) return {};
        const metadata = { messageIds: [], testIds: [], citations: [] };
        const idEls = node.querySelectorAll('[data-message-id], [data-id]:not(script)');
        idEls.forEach(el => {
            const id = el.getAttribute('data-message-id') || el.getAttribute('data-id');
            if (id && !metadata.messageIds.includes(id)) metadata.messageIds.push(id);
        });
        const testEls = node.querySelectorAll('[data-test-id]');
        testEls.forEach(el => {
            const testId = el.getAttribute('data-test-id');
            if (testId && !metadata.testIds.includes(testId)) metadata.testIds.push(testId);
        });
        const citeEls = node.querySelectorAll('[data-provenance], [data-citation]');
        citeEls.forEach(el => {
            const cite = el.getAttribute('data-provenance') || el.getAttribute('data-citation');
            const link = el.href || (el.closest('a') ? el.closest('a').href : null);
            if (cite && !metadata.citations.some(c => c.id === cite)) {
                metadata.citations.push({ id: cite, url: link });
            }
        });
        return metadata;
    };

    // Traverse in strict DOM order, no visual sorting
    const getTurns = () => {
        const allEls = Array.from(document.querySelectorAll('user-query, model-response'));
        const validTurns = [];
        let currentTurn = document.createElement('div');
        for (let el of allEls) {
            const isUser = el.tagName.toLowerCase() === 'user-query';
            if (isUser) {
                if (currentTurn.children.length > 0) {
                    validTurns.push(currentTurn);
                }
                currentTurn = document.createElement('div');
                currentTurn.appendChild(el.cloneNode(true));
            } else {
                currentTurn.appendChild(el.cloneNode(true));
            }
        }
        if (currentTurn.children.length > 0) validTurns.push(currentTurn);
        return validTurns;
    };

    const extract = () => {
        stampChips(document);
        const turns = getTurns();
        const lastTurn = turns[turns.length - 1];
        if (!lastTurn) return null;

        const userEl = lastTurn.querySelector('user-query-content, user-query, .query-text');
        const modelEl = lastTurn.querySelector('message-content, model-response, .response-container');

        return {
            promptHtml: cleanNode(userEl),
            thinkingHtml: "",
            responseHtml: cleanNode(modelEl),
            roundHtml: rawClone(lastTurn),
            metadata: extractMetadata(lastTurn)
        };
    };

    const bulkExtract = () => {
        stampChips(document);
        const turns = getTurns();
        const rounds = [];
        for (let turn of turns) {
            const userEl = turn.querySelector('user-query-content, user-query, .query-text');
            const modelEl = turn.querySelector('message-content, model-response, .response-container');

            const promptHtml = cleanNode(userEl);
            const responseHtml = cleanNode(modelEl);
            const roundHtml = rawClone(turn);

            if (promptHtml || responseHtml || roundHtml) {
                rounds.push({
                    promptHtml,
                    thinkingHtml: "",
                    responseHtml,
                    roundHtml,
                    metadata: extractMetadata(turn)
                });
            }
        }
        return rounds;
    };

    window.ForensicModules.gemini = { match, extract, bulkExtract, getSessionName, processParsedDoc, bulkPreExtract };
})();
