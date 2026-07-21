let isLogging = false;
let lastLoggedPromptText = "";
let debounceTimer = null;
let streamStartTime = 0;

// Initialize observer to detect DOM changes
const observer = new MutationObserver((mutations) => {
    // If a generation is happening, we wait for it to stop
    if (isLogging) return;

    // Mark that streaming/generation is happening
    if (streamStartTime === 0) {
        streamStartTime = Date.now();
    }

    // Debounce: Reset the timer every time the DOM changes.
    // Only when the DOM hasn't changed for 1500ms (1.5s) will the function fire.
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const duration = Date.now() - streamStartTime;
        streamStartTime = 0; // Reset for next time
        processLatestRound(duration);
    }, 1500);
});

// Start observing the body
observer.observe(document.body, { childList: true, subtree: true });

function processLatestRound(durationMs) {
    if (isLogging) return;
    isLogging = true;

    try {
        const host = window.location.hostname;
        const path = window.location.pathname;
        let promptText = "";
        let responseText = "";
        let thinkingText = "";

        // --- ChatGPT ---
        if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
            const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
            const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
            const lastUserMsg = userMessages[userMessages.length - 1];
            const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

            if (lastUserMsg && lastAssistantMsg) {
                promptText = lastUserMsg.innerText;
                const thinkingElement = lastAssistantMsg.querySelector('.whitespace-pre-wrap:has(> .text-gray-500)');
                if (thinkingElement) thinkingText = thinkingElement.innerText;
                responseText = lastAssistantMsg.innerText.replace(thinkingText, '').trim();
            }
        } 
        // --- Claude ---
        else if (host.includes('claude.ai')) {
            const userMessages = document.querySelectorAll('[data-testid="user-message"]');
            const assistantMessages = document.querySelectorAll('.font-claude-message');
            const lastUserMsg = userMessages[userMessages.length - 1];
            const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

            if (lastUserMsg && lastAssistantMsg) {
                promptText = lastUserMsg.innerText;
                const thinkingElement = lastAssistantMsg.querySelector('.bg-gray-100');
                if (thinkingElement) thinkingText = thinkingElement.innerText;
                responseText = lastAssistantMsg.innerText.replace(thinkingText, '').trim();
            }
        } 
        // --- Google Gemini ---
        else if (host.includes('gemini.google.com')) {
            const userMessages = document.querySelectorAll('user-query, .query-text');
            const assistantMessages = document.querySelectorAll('model-response, .model-response-text');
            const lastUserMsg = userMessages[userMessages.length - 1];
            const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

            if (lastUserMsg && lastAssistantMsg) {
                promptText = lastUserMsg.innerText;
                responseText = lastAssistantMsg.innerText;
            }
        } 
        // --- Google NotebookLM ---
        else if (host.includes('notebooklm.google.com')) {
            const userMessages = document.querySelectorAll('.chat-message-user, .user-query');
            const assistantMessages = document.querySelectorAll('.chat-message-model, .model-response');
            const lastUserMsg = userMessages[userMessages.length - 1];
            const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

            if (lastUserMsg && lastAssistantMsg) {
                promptText = lastUserMsg.innerText;
                responseText = lastAssistantMsg.innerText;
            }
        } 
        // --- Duck.ai (DuckDuckGo AI Chat) ---
        else if (host.includes('duck.ai')) {
            const userMessages = document.querySelectorAll('article[data-testid^="user-message"], .msg__user');
            const assistantMessages = document.querySelectorAll('article[data-testid^="assistant-message"], .msg__assistant');
            const lastUserMsg = userMessages[userMessages.length - 1];
            const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

            if (lastUserMsg && lastAssistantMsg) {
                promptText = lastUserMsg.innerText;
                responseText = lastAssistantMsg.innerText;
            }
        } 
        // --- Google Search AI (AI Overviews) ---
        else if (host.includes('google.com') && path.includes('/search')) {
            const aiBlock = document.querySelector('div[aria-label*="AI Overviews"], div[data-async-context*="ai"]');
            if (aiBlock) {
                const searchInput = document.querySelector('textarea[name="q"], input[name="q"]');
                promptText = searchInput ? searchInput.value : document.title;
                responseText = aiBlock.innerText;
                responseText = responseText.replace(/Generate more|Share|Copy/g, '').trim();
            }
        }
        // --- Google Flow (labs.google/fx/tools/flow) ---
        else if (host.includes('labs.google') && path.includes('fx/tools/flow')) {
            // Google Flow is a video generation tool. We extract the prompt text.
            // We try to find the main text area where the user types the video prompt.
            const promptArea = document.querySelector('textarea, input[type="text"]');
            if (promptArea) {
                promptText = promptArea.value || promptArea.innerText;
            }
            
            // For the "response", we look for the latest generation card/asset container.
            // Since Flow outputs video, we log the metadata/UI text associated with the generated result.
            const creationBlocks = document.querySelectorAll('[class*="creation"], [class*="result"], [class*="generation"], [class*="asset"]');
            if (creationBlocks.length > 0) {
                const lastBlock = creationBlocks[creationBlocks.length - 1];
                // Extract text, stripping out generic button labels
                responseText = lastBlock.innerText.replace(/Download|Share|Edit|Delete|Generate/g, '').trim();
            } else {
                responseText = "[Video generation initiated/completed - No extractable text metadata found]";
            }
        }

        // Only log if we actually got a new prompt
        if (promptText && promptText !== lastLoggedPromptText && responseText) {
            lastLoggedPromptText = promptText;
            
            const payload = {
                prompt: promptText,
                thinking: thinkingText,
                response: responseText,
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
