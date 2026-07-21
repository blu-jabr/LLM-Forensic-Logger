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
            if (extractedData.promptHtml === lastLoggedPromptText) {
                isLogging = false;
                return;
            }
            lastLoggedPromptText = extractedData.promptHtml;
            
            const { markdown, mediaFiles, roundHtml } = await processHtmlAndMedia(extractedData);
            
            const payload = {
                prompt: markdown.prompt,
                thinking: markdown.thinking,
                response: markdown.response,
                mediaFiles: mediaFiles,
                roundHtml: roundHtml,
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
                        const { markdown, mediaFiles, roundHtml } = await processHtmlAndMedia(round);
                        processedRounds.push({
                            prompt: markdown.prompt,
                            thinking: markdown.thinking,
                            response: markdown.response,
                            mediaFiles: mediaFiles,
                            roundHtml: roundHtml
                        });
                    }
                    
                    chrome.runtime.sendMessage({ type: 'BULK_LOG_SESSION', payload: processedRounds })
                        .catch(e => console.error("[Forensic Logger] Failed to send bulk log:", e));
                    sendResponse({ status: 'success' });
                })();
                return true; 
            }
        }
        sendResponse({ status: 'no_module_matched' });
    }
    return true;
});

// --- HTML to Markdown & Media Extraction Engine ---

async function processHtmlAndMedia(data) {
    let mediaFiles = [];
    let mediaIndex = 0;
    let attachmentIndex = 0;
    
    const processHtml = async (htmlString, isPromptSection) => {
        if (!htmlString) return { md: "", html: "" };
        const doc = new DOMParser().parseFromString(htmlString, 'text/html');
        
        const mediaElements = Array.from(doc.querySelectorAll('img, video, a[href][download], a[href], [style*="background-image"]'));

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

            if (!isPromptSection && el.tagName === 'A' && !el.hasAttribute('download') && !url.match(/\.(png|jpg|jpeg|gif|pdf|mp4|webm|csv|webp|svg)$/i)) {
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

                // Rewrite src/href to point to the local file (preserves HTML structure for .xhtml)
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
        // Pass the pristine HTML directly to the background script.
        // Do NOT run the media fetcher on it, preserving original URLs.
        finalRoundHtml = data.roundHtml;
    } else {
        // Fallback for modules that don't provide a full roundHtml
        finalRoundHtml = `
            <div class="forensic-user-prompt">${promptRes.html}</div>
            <div class="forensic-ai-thinking">${thinkingRes.html}</div>
            <div class="forensic-ai-response">${responseRes.html}</div>
        `;
    }

    return { 
        markdown: { prompt: promptRes.md, thinking: thinkingRes.md, response: responseRes.md }, 
        mediaFiles,
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
