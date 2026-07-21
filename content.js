let isLogging = false;
let lastLoggedPromptText = "";
let debounceTimer = null;
let streamStartTime = 0;

// Initialize observer to detect DOM changes
const observer = new MutationObserver((mutations) => {
    if (isLogging) return;
    if (streamStartTime === 0) streamStartTime = Date.now();

    // Debounce: Wait 1.5s after the last DOM change before extracting
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

        // Dynamically find the matching module
        for (const moduleName in window.ForensicModules) {
            const mod = window.ForensicModules[moduleName];
            if (mod.match(host, path)) {
                extractedData = mod.extract();
                break;
            }
        }

        // Only log if we actually got a new prompt and a response
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

            chrome.runtime.sendMessage({ type: 'LOG_LLM_ROUND', payload: payload });
        }
    } catch (error) {
        console.error('[Forensic Logger] Error processing round:', error);
    } finally {
        isLogging = false;
    }
}
