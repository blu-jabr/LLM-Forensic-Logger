// content.js — service-agnostic orchestration. FROZEN FILE.
// All per-service logic lives in modules/<service>.js. Modules may implement:
//   match(host, path), extract(), bulkExtract(), getSessionName()
//   processParsedDoc(doc, { isPromptSection, chips })   [optional]
//       Called on each DOMParser-parsed section before markdown conversion;
//       may rewrite the doc and push citation records into ctx.chips.
//   bulkPreExtract()                                    [optional, async]
//       Called once before bulkExtract() (e.g. active harvesters).
// dlog/derr come from modules/index.js, loaded first.

// HACK: Prevent aggressive SPAs from clearing our debug logs
window.console.clear = () => { dlog('[Forensic Logger] Prevented console.clear()'); };

dlog('C0 content.js loaded; modules:', Object.keys(window.ForensicModules || {}));

let isLogging = false;
let isBulkLogging = false;
let lastLoggedPromptText = "";
let debounceTimer = null;
let streamStartTime = 0;
let isScrolling = false;
let scrollTimeout = null;
const pageLoadTime = Date.now();

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

        if (!extractedData) dlog('C5 extract() returned null (no rounds in DOM?)');

        if (extractedData && extractedData.promptHtml) {
            const currentPromptText = extractedData.promptHtml.replace(/<[^>]+>/g, '').trim();
            if (currentPromptText === lastLoggedPromptText) {
                dlog('C6 duplicate prompt — skipped');
                isLogging = false;
                return;
            }
            lastLoggedPromptText = currentPromptText;

            const matchedMod = window.ForensicModules[matchedModuleName];
            const { markdown, mediaFiles, roundHtml, citationChips } = await processHtmlAndMedia(extractedData, matchedMod);
            dlog('C7 media processed:', { media: mediaFiles.length, chips: (citationChips || []).length, roundHtml: roundHtml.length });

            const sessionName = matchedMod.getSessionName ? matchedMod.getSessionName() : document.title;

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
                        if (typeof mod.bulkPreExtract === 'function') await mod.bulkPreExtract();

                        const allRounds = await mod.bulkExtract();
                        dlog('B3 rounds extracted:', allRounds.length);
                        dlog(`[Forensic Logger] Found ${allRounds.length} rounds. Processing media...`);

                        const sessionName = mod.getSessionName ? mod.getSessionName() : document.title;

                        const processedRounds = [];
                        for (const round of allRounds) {
                            const { markdown, mediaFiles, roundHtml, citationChips } = await processHtmlAndMedia(round, mod);
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

// --- HTML to Markdown & Media Extraction Engine (service-agnostic) ---

async function processHtmlAndMedia(data, modRef) {
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
                        ext = 'jpg'; // thumbnail CDN; background mime-verify corrects if wrong
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

        // ── Module-specific document transform (optional hook) ──
        // e.g. the Gemini module resolves citation chips to URLs and rewrites
        // them to markdown links, pushing chip records into ctx.chips.
        if (modRef && typeof modRef.processParsedDoc === 'function') {
            try {
                modRef.processParsedDoc(doc, { isPromptSection, chips: citationChips });
            } catch (e) {
                derr('[Forensic Logger] processParsedDoc failed:', e);
            }
        }

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
