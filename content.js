// HACK: Prevent aggressive SPAs from clearing our debug logs
window.console.clear = () => { dlog('[Forensic Logger] Prevented console.clear()'); };
// ─── Debug tracing (set FL_DEBUG=false to silence) ───
const ENABLE_KEYBOARD_HARVEST = false;
const FL_DEBUG = true;
let flBuffer = [], flFlushTimer = null;
function flSend() {
    if (!flBuffer.length) return;
    const lines = flBuffer; flBuffer = [];
    try { chrome.runtime.sendMessage({ type: 'FL_DEBUG_LOG', lines }).catch(() => {}); } catch (e) {}
}
function dlog(...a) {
    const line = new Date().toISOString() + ' [CS] ' + a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
    if (FL_DEBUG) console.log('%c[FL]', 'color:#080;font-weight:bold', ...a);
    flBuffer.push(line);
    clearTimeout(flFlushTimer); flFlushTimer = setTimeout(flSend, 2000);
}
function derr(...a) {
    const line = new Date().toISOString() + ' [CS✗] ' + a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
    if (FL_DEBUG) console.error('%c[FL✗]', 'color:#c00;font-weight:bold', ...a);
    flBuffer.push(line);
    clearTimeout(flFlushTimer); flFlushTimer = setTimeout(flSend, 2000);
}

dlog('C0 content.js loaded; modules:', Object.keys(window.ForensicModules || {}));

let isLogging = false;
let isBulkLogging = false;
let lastLoggedPromptText = "";
let debounceTimer = null;
let streamStartTime = 0;
let isScrolling = false;
let scrollTimeout = null;
const pageLoadTime = Date.now();

// Stable cross-session/cross-render key: chunk prefix + citation index within
// that chunk. Absolute ordinals shift on re-render; relative order is stable.

function stableChipKey(chip) {
    try {
        const doc = chip.ownerDocument || document;   // extraction chips live in a DOMParser doc
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

// --- Citation URL cache (passive harvester) ---
// Gemini citation chips are Angular buttons; the target URL is not in the DOM
// at rest. We cache URLs learned from real anchors in dialogs/overlays and
// from window.open interceptions (see modules/inject_main_world.js).
const citationUrlCache = new Map(); // normalized source title -> url
// after: const citationUrlCache = new Map(...);
let cacheSaveTimer = null;
function cachePut(key, url) {
    citationUrlCache.set(key, url);
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = setTimeout(() => {
        try { chrome.storage.local.set({ citationUrlCache: Object.fromEntries(citationUrlCache) }); } catch (e) {}
    }, 500);
}

const citationIdCache = new Map();   // container_id (p-rc_...) -> url — precise, per-chip
let idCacheSaveTimer = null;
function cacheIdPut(id, url) {
    citationIdCache.set(id, url);
    clearTimeout(idCacheSaveTimer);
    idCacheSaveTimer = setTimeout(() => {
        try { chrome.storage.local.set({ citationIdCache: Object.fromEntries(citationIdCache) }); } catch (e) {}
    }, 500);
}
// load alongside the title cache
chrome.storage.local.get(['citationIdCache'], (d) => {
    const obj = d.citationIdCache || {};
    for (const [k, v] of Object.entries(obj)) citationIdCache.set(k, v);
});


// Chip titles and hover-card text differ in length; match both directions.
// Provenance of the match is recorded so forensic consumers know how the URL
// was associated.
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

chrome.storage.local.get(['citationUrlCache'], (d) => {
    const obj = d.citationUrlCache || {};
    for (const [k, v] of Object.entries(obj)) citationUrlCache.set(k, v);
});

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
let lastHoveredChipTitle = null;
let lastHoveredChipContainerId = null;
let lastHoveredChipStableKey = null;
let lastHoveredAt = 0;   // timestamp of the last chip hover — freshness gate for URL association
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
                dlog('[Forensic Logger] Cached citation:', label, '->', href);
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
        lastHoveredAt = Date.now();                                  // ← ADD
        const holder = chip.closest('[id^="p-rc_"]');
        lastHoveredChipContainerId = holder ? holder.id : null;   // add this (declare the var with the others)
        lastHoveredChipStableKey = stableChipKey(chip);   // declare with the other lets
    }
}, true);

new MutationObserver((muts) => {
    muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType === 1) harvestCitationUrls(n);
    }));
}).observe(document.body, { childList: true, subtree: true });

// Receive navigation events intercepted in the MAIN world
window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'FORENSIC_WINDOW_OPEN') return;
    const d = event.data;
    if (!d.url || !/^https?:/i.test(d.url)) return;

    pendingOpenQueue.push(d.url);
    dlog('[Forensic Logger] Intercepted citation URL:', d.url);

    // Freshness gate: only associate the URL with a chip if the mouse was
    // hovering that chip within the last 5 seconds. Prevents stale-pairing
    // (the hover-card poisoning failure mode).
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
        dlog('[Forensic Logger] Associated with chip:', lastHoveredChipTitle,
                    lastHoveredChipContainerId, 'skey=', lastHoveredChipStableKey, 'url=', d.url);
    }
});

// Pause live logging while the user scrolls (virtual-scroller churn)
window.addEventListener('scroll', () => {
    isScrolling = true;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => { isScrolling = false; }, 1000);
}, true);

const observer = new MutationObserver((mutations) => {
    if (Date.now() - pageLoadTime < 5000) return; // startup grace period
    if (isScrolling) return;                      // ignore scroll-induced mutations
    if (isLogging || isBulkLogging) return;
    if (streamStartTime === 0) streamStartTime = Date.now();

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const duration = Date.now() - streamStartTime;
        streamStartTime = 0;
        processLatestRound(duration);
    }, 1500);
});

if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
} else {
    window.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

async function processLatestRound(durationMs) {
    if (isLogging) return;
    isLogging = true;

    try {
        const host = window.location.hostname;
        const path = window.location.pathname;
        let extractedData = null;
        let matchedModuleName = "";

        for (const moduleName in window.ForensicModules) {
            const mod = window.ForensicModules[moduleName];
            if (mod.match(host, path)) {
                extractedData = await mod.extract();
                matchedModuleName = moduleName;
                dlog('C4 matched module:', moduleName);
                break;
            }
        }

        if (!extractedData) dlog('C5 extract() → null (no rounds in DOM?)');

        if (extractedData && extractedData.promptHtml) {
            const currentPromptText = extractedData.promptHtml.replace(/<[^>]+>/g, '').trim();
            if (currentPromptText === lastLoggedPromptText) {
                dlog('C6 duplicate prompt — skipped');
                isLogging = false;
                return;
            }
            lastLoggedPromptText = currentPromptText;

            const { markdown, mediaFiles, roundHtml, citationChips } = await processHtmlAndMedia(extractedData);
            dlog('C7 media processed:', { media: mediaFiles.length, chips: (citationChips||[]).length, roundHtml: roundHtml.length });

            const mod = window.ForensicModules[matchedModuleName];
            const sessionName = mod.getSessionName ? mod.getSessionName() : document.title;

            const payload = {
                prompt: markdown.prompt,
                thinking: markdown.thinking,
                response: markdown.response,
                mediaFiles: mediaFiles,
                roundHtml: roundHtml,
                sessionName: sessionName,
                metadata: extractedData.metadata || {},
                citationChips: citationChips || [],
                chatId: window.location.pathname.split('/').pop(),
                generationDurationMs: durationMs,
                domNodeCount: document.getElementsByTagName('*').length,
                origin: window.location.origin
            };

            if (chrome.runtime && chrome.runtime.id) {
                dlog('C9 sending LOG_LLM_ROUND');
                chrome.runtime.sendMessage({ type: 'LOG_LLM_ROUND', payload: payload })
                    .catch(e => {
                        dlog("[Forensic Logger] Extension context invalidated. Please refresh the page.");
                        observer.disconnect();
                    });
            }
        }
    } catch (error) {
        console.error('[Forensic Logger] Error processing round:', error);
    } finally {
        isLogging = false;
    }
}

// Listen for manual bulk extraction
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'BULK_LOG_REQUEST') {
        dlog('B1 bulk request received');
        clearTimeout(debounceTimer);   // stop any pending live log
        observer.disconnect();         // stop observing DOM changes
        isBulkLogging = true;
        dlog("[Forensic Logger] Received bulk log request. Live logging paused.");
        const host = window.location.hostname;
        const path = window.location.pathname;

        for (const moduleName in window.ForensicModules) {
            const mod = window.ForensicModules[moduleName];
            if (mod.match(host, path) && mod.bulkExtract) {
                dlog('C4 matched module:', moduleName);
                (async () => {
                    try {
                        if (ENABLE_KEYBOARD_HARVEST) await harvestChipsViaClicks();

                        const allRounds = await mod.bulkExtract();
                        dlog('B3 rounds extracted:', allRounds.length);
                        dlog(`[Forensic Logger] Found ${allRounds.length} rounds. Processing media...`);

                        const sessionName = mod.getSessionName ? mod.getSessionName() : document.title;

                        const processedRounds = [];
                        for (const round of allRounds) {
                            const { markdown, mediaFiles, roundHtml, citationChips } = await processHtmlAndMedia(round);
                            processedRounds.push({
                                prompt: markdown.prompt,
                                thinking: markdown.thinking,
                                response: markdown.response,
                                mediaFiles: mediaFiles,
                                roundHtml: roundHtml,
                                metadata: round.metadata || {},
                                citationChips: citationChips || []
                            });
                            dlog('B4 round ' + processedRounds.length + '/' + allRounds.length + ' ok');
                        }

                        await chrome.runtime.sendMessage({
                            type: 'BULK_LOG_SESSION',
                            payload: {
                                rounds: processedRounds,
                                sessionName: sessionName,
                                chatId: window.location.pathname.split('/').pop()
                            }
                        });
                        dlog('B5 delivered to background');
                        sendResponse({ status: 'success' });
                    } catch (e) {
                        console.error("[Forensic Logger] Bulk log failed:", e);
                        sendResponse({ status: 'error', error: e.message });
                    } finally {
                        isBulkLogging = false;
                    }
                })();
                return true;
            }
        }
        sendResponse({ status: 'no_module_matched' });
        isBulkLogging = false;
    }
    return true;
});

// --- HTML to Markdown & Media Extraction Engine ---

async function processHtmlAndMedia(data) {
    let mediaFiles = [];
    let citationChips = [];
    let mediaIndex = 0;
    let attachmentIndex = 0;

    const processHtml = async (htmlString, isPromptSection) => {
        if (!htmlString) return { md: "", html: "" };
        const doc = new DOMParser().parseFromString(htmlString, 'text/html');

        const mediaElements = Array.from(doc.querySelectorAll('img, video, a[href][download], a[href], [style*="background-image"]'));
        dlog('C7a section(' + (isPromptSection ? 'prompt' : 'response') + '):', mediaElements.length, 'media element(s)');

        for (let el of mediaElements) {
            if (!el.closest('body')) continue;

            let url = el.src || el.href || el.dataset.src;

            if ((!url || url.startsWith('data:')) && el.srcset) {
                url = el.srcset.split(',')[0].split(' ')[0];
            }

            if (!url && el.style && el.style.backgroundImage) {
                const bgUrlMatch = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
                if (bgUrlMatch) url = bgUrlMatch[1];
            }

            if (!url || url.startsWith('data:') || url.startsWith('javascript:')) continue;
            let fetchUrl = url;
            const fsu = el.closest('[data-image-full-size-uri]');
            if (/licensed-image/i.test(url)) { el.remove(); continue; }  // these 404

            // Skip plain hyperlinks in BOTH prompts and responses — they are
            // converted to [label](url) markdown below, not downloaded.
            if (el.tagName === 'A' && !el.hasAttribute('download') && !el.querySelector('img, video') && !url.match(/\.(png|jpe?g|gif|pdf|mp4|webm|csv|webp|svg|docx?|xlsx?|pptx?|txt|zip)$/i)) {
                continue;
            }

            let isBlob = url.startsWith('blob:');
            let dataUrl = null;
            let ext = 'bin';

            try {
                if (isBlob) {
                    const response = await fetch(url);
                    const blob = await response.blob();

                    if (blob.size > 10 * 1024 * 1024) {
                        el.outerHTML = `\n[Media file too large to log automatically: ${url}]\n`;
                        continue;
                    }

                    dataUrl = await new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });

                    if (blob.type.includes('png')) ext = 'png';
                    else if (blob.type.includes('jpeg') || blob.type.includes('jpg')) ext = 'jpg';
                    else if (blob.type.includes('webp')) ext = 'webp';
                    else if (blob.type.includes('mp4')) ext = 'mp4';
                    else if (blob.type.includes('webm')) ext = 'webm';
                    else if (blob.type.includes('pdf')) ext = 'pdf';
                    else if (blob.type.includes('svg')) ext = 'svg';
                } else {
                    if (url.match(/\.([a-z0-9]{2,4})(\?|$)/i)) {
                        const extMatch = url.match(/\.([a-z0-9]{2,4})(\?|$)/i);
                        if (extMatch) ext = extMatch[1].toLowerCase();
                    }
                    else if (/gstatic\.com\/images|q=tbn:/i.test(url)) {
                        ext = 'jpg'; // Google thumbnail CDN; B6✓ mime verifies
                    }
                }

                let isAttachment = false;
                if (isPromptSection) {
                    isAttachment = true;
                } else {
                    if (el.tagName === 'A' && el.hasAttribute('download')) isAttachment = true;
                }

                let filename = "";
                let originalFilename = el.getAttribute('download') ? el.getAttribute('download').split('/').pop().split('?')[0] : null;

                if (!originalFilename && url.match(/\/[^/]+\.[a-z0-9]{2,4}($|\?)/i)) {
                    originalFilename = url.split('/').pop().split('?')[0];
                }

                if (originalFilename) {
                    let baseName = originalFilename.replace(/\.[^/.]+$/, "");
                    baseName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
                    filename = `${baseName}.${ext}`;
                } else {
                    if (isAttachment) {
                        attachmentIndex++;
                        filename = `attachment-${attachmentIndex}.${ext}`;
                    } else {
                        mediaIndex++;
                        filename = `media-${mediaIndex}.${ext}`;
                    }
                }

                if (isBlob) {
                    mediaFiles.push({ filename, dataUrl });
                } else {
                    mediaFiles.push({ filename, directUrl: url });
                }

                if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
                    el.setAttribute('src', `flush.MEDIA_PLACEHOLDER/${filename}`);
                    el.removeAttribute('srcset');
                } else if (el.tagName === 'A') {
                    el.setAttribute('href', `flush.MEDIA_PLACEHOLDER/${filename}`);
                }
            } catch (e) {
                console.error("[Forensic Logger] Failed to process media:", url, e);
            }
        }

        // --- Gemini citation chips (<source-inline-chip>) ---
        // Angular buttons, NOT anchors; the target URL is absent from the DOM
        // at rest. Resolution order per chip: container_id cache (exact,
        // per-chip-instance) -> title cache (flagged when title is shared).

        // Count how many chips share each normalized title so title-based
        // matches can be flagged as ambiguous when N > 1.
        const titleCounts = new Map();
        doc.querySelectorAll('source-inline-chip, .source-inline-chip-container').forEach(c => {
            const t = c.querySelector('.source-title');
            const k = norm(t ? t.textContent : '').slice(0, 120);
            if (k) titleCounts.set(k, (titleCounts.get(k) || 0) + 1);
        });

        doc.querySelectorAll('source-inline-chip, .source-inline-chip-container').forEach(chip => {
            if (!chip.parentNode) return;

            // Collect every source title the chip exposes (multi-source chips
            // may list several; the opened dialog may hold more than the DOM shows).
            const titleEls = chip.querySelectorAll('.source-title');
            const labels = [...titleEls].map(t => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
            const label = labels[0] || (chip.textContent || '').replace(/\s+/g, ' ').trim();
            if (!label) { chip.remove(); return; }

            const sameTitleCount = titleCounts.get(norm(label).slice(0, 120)) || 0;

            // Per-instance container id (e.g. p-rc_491db16e7155877b-30):
            // chunk id + citation ordinal — the precise cache key.
            const holder = chip.closest('[id^="p-rc_"]');
            const cid = chip.getAttribute('data-fl-cid') || (holder ? holder.id : null);
            const skey = chip.getAttribute('data-fl-skey') || stableChipKey(chip);

            // Resolution: container_id cache (exact; may hold MULTIPLE urls
            // for one chip) -> title cache (fallback; single url).

            let urls = skey ? (citationIdCache.get(skey) || null) : null;
            let matchType = urls ? 'stable-key' : null;

            if (!urls) {
                urls = cid ? (citationIdCache.get(cid) || null) : null;
                if (urls) matchType = 'container-id';
            }

            if (!urls) {
                const lookedUp = lookupChipUrl(label);
                // Only accept title-based fallback when this title is unique in the
                // round; shared titles (Wikipedia, DoE...) are ambiguous by design.
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

            dlog('ChipResolve:', label.slice(0, 40), 'skey=' + skey, 'cid=' + cid, 'hits=' + urlList.length);   // ← HERE

            const entry = { source_title: label, url: urlList[0] || null };
            if (cid) entry.container_id = cid;
            if (skey) entry.stable_key = skey;
            if (urlList.length > 1) entry.urls = urlList;   // full multi-citation record

            if (urlList.length && matchType && matchType !== 'exact') {
                // Only title-derived matches are ambiguous when the title is shared;
                // structure-derived matches (stable-key, container-id) are exact.
                const titleBased = matchType === 'chip-title-prefix-of-cached' ||
                                   matchType === 'cached-prefix-of-chip-title';
                entry.url_match_type = (titleBased && sameTitleCount > 1)
                    ? matchType + '+title-shared' : matchType;
            }

            if (labels.length > 1) {
                entry.all_source_titles = labels;
                entry.source_list_complete = false; // dialog may enumerate more
            }

            // Decode jslog BardVeMetadataKey -> [response_id, conversation_id, null, chunk_id]
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

            citationChips.push(entry);

            // Emit one markdown link per known URL; bare label if none
            const mdText = urlList.length === 0
                ? ` [${label}] `
                : urlList.map(u => ` [${label}](${u}) `).join('');
            chip.replaceWith(doc.createTextNode(mdText));
        });

        // DOM-based anchor -> markdown link conversion (handles nested tags
        // and newlines that broke the old regex approach)
        doc.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (!href || href.startsWith('javascript:')) return;

            if (a.querySelector('img, video')) {
                const frag = doc.createDocumentFragment();
                Array.from(a.childNodes).forEach(n => frag.appendChild(n.cloneNode(true)));
                frag.appendChild(doc.createTextNode(`\n[Link](${href})\n`));
                a.replaceWith(frag);
            } else {
                const label = (a.textContent || '').replace(/\s+/g, ' ').trim() || href;
                a.replaceWith(doc.createTextNode(`[${label}](${href})`));
            }
        });

        return {
            md: convertHtmlToMarkdown(doc.body.innerHTML),
            html: doc.body.innerHTML
        };
    };

    const promptRes = await processHtml(data.promptHtml, true);
    const thinkingRes = await processHtml(data.thinkingHtml, false);
    const responseRes = await processHtml(data.responseHtml, false);

    let finalRoundHtml = "";
    if (data.roundHtml) {
        finalRoundHtml = data.roundHtml;
    } else {
        finalRoundHtml = `
            <div class="forensic-user-prompt">${promptRes.html}</div>
            <div class="forensic-ai-thinking">${thinkingRes.html}</div>
            <div class="forensic-ai-response">${responseRes.html}</div>
        `;
    }

    return {
        markdown: { prompt: promptRes.md, thinking: thinkingRes.md, response: responseRes.md },
        mediaFiles,
        citationChips,
        roundHtml: finalRoundHtml
    };
}

function convertHtmlToMarkdown(html) {
    let md = html;
    md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (m, c) => `\n\`\`\`\n${c}\n\`\`\`\n`);
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (m, c) => `\`${c}\``);
    md = md.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gi, '**$2**');
    md = md.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gi, '*$2*');
    md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
    md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
    md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
    md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
    md = md.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
    md = md.replace(/<img[^>]*src="(.*?)"[^>]*>/gi, '\n![]($1)\n');
    md = md.replace(/<video[^>]*src="(.*?)"[^>]*>.*?<\/video>/gi, '\n[Video]($1)\n');
    // NOTE: the old <a> regex was removed — anchors are converted in the DOM above.
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n');
    md = md.replace(/<[^>]+>/g, '');

    const txt = document.createElement('textarea');
    txt.innerHTML = md;
    md = txt.value;

    md = md.replace(/\n{3,}/g, '\n\n').trim();
    return md;
}
