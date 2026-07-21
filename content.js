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
                console.log(`[Forensic Logger] Module matched: ${moduleName}. Extracted:`, extractedData);
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

            console.log("[Forensic Logger] Sending payload to background...", payload);
            chrome.runtime.sendMessage({ type: 'LOG_LLM_ROUND', payload: payload });
        } else if (!extractedData) {
            console.log("[Forensic Logger] No module matched or data was null.");
        }
    } catch (error) {
        console.error('[Forensic Logger] Error processing round:', error);
    } finally {
        isLogging = false;
    }
}
