// HACK: Prevent aggressive SPAs from clearing our debug logs
window.console.clear = () => { console.log('[Forensic Logger] Prevented console.clear()'); };

let isLogging = false;
let lastLoggedPromptText = "";
let debounceTimer = null;
let streamStartTime = 0;

const observer = new MutationObserver((mutations) => {
    if (isLogging) return;
    if (streamStartTime === 0) streamStartTime = Date.now();

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const duration = Date.now() - streamStartTime;
        streamStartTime = 0;
        processLatestRound(duration);
    }, 1500);
});

observer.observe(document.body, { childList: true, subtree: true });

async function processLatestRound(durationMs) {
    if (isLogging) return;
    isLogging = true;

    try {
        const host = window.location.hostname;
        const path = window.location.pathname;
        let extractedData = null;

        for (const moduleName in window.ForensicModules) {
            const mod = window.ForensicModules[moduleName];
            if (mod.match(host, path)) {
                extractedData = mod.extract();
                break;
            }
        }

        if (extractedData && extractedData.promptHtml) {
            // Use the raw HTML as the uniqueness check
            if (extractedData.promptHtml === lastLoggedPromptText) {
                isLogging = false;
                return;
            }
            lastLoggedPromptText = extractedData.promptHtml;
            
            // Process HTML into Markdown and fetch media
            const { markdown, mediaFiles } = await processHtmlAndMedia(extractedData);
            
            const payload = {
                prompt: markdown.prompt,
                thinking: markdown.thinking,
                response: markdown.response,
                mediaFiles: mediaFiles,
                generationDurationMs: durationMs,
                domNodeCount: document.getElementsByTagName('*').length,
                origin: window.location.origin
            };

            if (chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage({ type: 'LOG_LLM_ROUND', payload: payload })
                    .catch(e => {
                        console.log("[Forensic Logger] Extension context invalidated. Please refresh the page.");
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
        console.log("[Forensic Logger] Received bulk log request.");
        const host = window.location.hostname;
        const path = window.location.pathname;
        
        for (const moduleName in window.ForensicModules) {
            const mod = window.ForensicModules[moduleName];
            if (mod.match(host, path) && mod.bulkExtract) {
                (async () => {
                    const allRounds = mod.bulkExtract();
                    console.log(`[Forensic Logger] Found ${allRounds.length} rounds. Processing media...`);
                    
                    const processedRounds = [];
                    for (const round of allRounds) {
                        const { markdown, mediaFiles } = await processHtmlAndMedia(round);
                        processedRounds.push({
                            prompt: markdown.prompt,
                            thinking: markdown.thinking,
                            response: markdown.response,
                            mediaFiles: mediaFiles
                        });
                    }
                    
                    chrome.runtime.sendMessage({ type: 'BULK_LOG_SESSION', payload: processedRounds })
                        .catch(e => console.error("[Forensic Logger] Failed to send bulk log:", e));
                    sendResponse({ status: 'success' });
                })();
                return true; // Keep channel open for async
            }
        }
        sendResponse({ status: 'no_module_matched' });
    }
    return true;
});

// --- HTML to Markdown & Media Extraction Engine ---

async function processHtmlAndMedia(data, showAttachmentHtml) {
    let mediaFiles = [];
    let attachments = [];
    
    const processHtml = async (htmlString, isPromptSection) => {
        if (!htmlString) return "";
        const doc = new DOMParser().parseFromString(htmlString, 'text/html');
        
        // Convert to static array to prevent issues when modifying DOM during loop
        const mediaElements = Array.from(doc.querySelectorAll('img, video, a[href][download], a[href], [style*="background-image"]'));
        let mediaIndex = 0;
        let attachmentIndex = 0;

        for (let el of mediaElements) {
            // Skip if element was already removed from DOM by a previous replacement
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

            // Ignore standard navigation links ONLY in the AI response
            if (!isPromptSection && el.tagName === 'A' && !el.hasAttribute('download') && !url.match(/\.(png|jpg|jpeg|gif|pdf|mp4|webm|csv|webp|svg)$/i)) {
                el.outerHTML = `[${el.innerText}](${url})`;
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
                }

                // Determine if this is an attachment based on context
                let isAttachment = false;
                if (isPromptSection) {
                    // Everything in the user prompt is an attachment
                    isAttachment = true;
                } else {
                    // In the AI response, only explicit download links are attachments
                    if (el.tagName === 'A' && el.hasAttribute('download')) {
                        isAttachment = true;
                    }
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

                // Capture container HTML for attachments
                if (isAttachment) {
                    let containerHtml = "";
                    if (showAttachmentHtml) {
                        // Grab the immediate parent container's HTML
                        let container = el.parentElement;
                        if (container) {
                            containerHtml = container.outerHTML;
                        } else {
                            containerHtml = el.outerHTML;
                        }
                    }
                    attachments.push({ filename, containerHtml });
                }

                if (isBlob) {
                    mediaFiles.push({ filename, dataUrl });
                } else {
                    mediaFiles.push({ filename, directUrl: url });
                }

                // Rewrite the HTML to point to the local file
                if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
                    el.outerHTML = `\n![${filename}](flush.MEDIA_PLACEHOLDER/${filename})\n`;
                } else {
                    el.outerHTML = `\n[Attachment: ${filename}](flush.MEDIA_PLACEHOLDER/${filename})\n`;
                }
            } catch (e) {
                console.error("[Forensic Logger] Failed to process media:", url, e);
                if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
                    el.outerHTML = `\n[Media failed to download (CORS/CSP blocked): ${url}](${url})\n`;
                } else {
                    el.outerHTML = `\n[Attachment failed to download: ${url}](${url})\n`;
                }
            }
        }

        return convertHtmlToMarkdown(doc.body.innerHTML);
    };

    // Pass true for isPromptSection when processing the prompt, false otherwise
    const promptMd = await processHtml(data.promptHtml, true);
    const thinkingMd = await processHtml(data.thinkingHtml, false);
    const responseMd = await processHtml(data.responseHtml, false);

    return { 
        markdown: { prompt: promptMd, thinking: thinkingMd, response: responseMd }, 
        mediaFiles,
        attachments
    };
}

function convertHtmlToMarkdown(html) {
    // (Keep your existing convertHtmlToMarkdown function exactly as it is)
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
    md = md.replace(/<a[^>]*href="(.*?)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n');
    md = md.replace(/<[^>]+>/g, '');
    
    const txt = document.createElement('textarea');
    txt.innerHTML = md;
    md = txt.value;
    
    md = md.replace(/\n{3,}/g, '\n\n').trim();
    return md;
}
