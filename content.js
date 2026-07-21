// HACK: Prevent aggressive SPAs (like Gemini) from clearing our debug logs
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

function processLatestRound(durationMs) {
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

        if (extractedData && extractedData.promptText && extractedData.promptText !== lastLoggedPromptText && extractedData.responseText) {
            lastLoggedPromptText = extractedData.promptText;
            
            const payload = {
                prompt: extractedData.promptText,
                thinking: extractedData.thinkingText || "",
                response: extractedData.responseText,
                generationDurationMs: durationMs,
                domNodeCount: document.getElementsByTagName('*').length,
                origin: window.location.origin
            };

            if (chrome.runtime && chrome.runtime.id) {
                // ADDED .catch() to handle the Promise rejection gracefully
                chrome.runtime.sendMessage({ type: 'LOG_LLM_ROUND', payload: payload })
                    .catch(e => {
                        console.log("[Forensic Logger] Extension context invalidated. Please refresh the page.");
                        observer.disconnect(); // Stop observing to prevent spam
                    });
            }
        }
    } catch (error) {
        console.error('[Forensic Logger] Error processing round:', error);
    } finally {
        isLogging = false;
    }
}

// Listen for manual bulk extraction from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'BULK_LOG_REQUEST') {
        console.log("[Forensic Logger] Received bulk log request.");
        const host = window.location.hostname;
        const path = window.location.pathname;
        
        for (const moduleName in window.ForensicModules) {
            const mod = window.ForensicModules[moduleName];
            if (mod.match(host, path) && mod.bulkExtract) {
                const allRounds = mod.bulkExtract();
                console.log(`[Forensic Logger] Found ${allRounds.length} rounds. Sending to background...`);
                
                chrome.runtime.sendMessage({ type: 'BULK_LOG_SESSION', payload: allRounds })
                    .catch(e => console.error("[Forensic Logger] Failed to send bulk log:", e));
                sendResponse({ status: 'success' });
                return true;
            }
        }
        sendResponse({ status: 'no_module_matched' });
    }
    return true;
});
