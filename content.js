let isLogging = false;
let lastLoggedPromptText = "";
let generationStartTime = 0;

// Initialize observer to detect DOM changes
const observer = new MutationObserver((mutations) => {
  // If a generation is happening, we wait for it to stop
  if (isLogging) return;

  // Check if a generation is likely starting (Send button disabled or loading spinner visible)
  const isLoading = document.querySelector('button[aria-label*="Stop"]') || document.querySelector('.loading-indicator');
  if (isLoading && generationStartTime === 0) {
    generationStartTime = Date.now();
    return;
  }

  // If it was loading, but now isn't, generation just finished
  if (generationStartTime > 0 && !isLoading) {
    const duration = Date.now() - generationStartTime;
    generationStartTime = 0;
    
    // Debounce slightly to let the DOM settle after the loading element disappears
    setTimeout(() => {
      processLatestRound(duration);
    }, 500);
  }
});

// Start observing the body
observer.observe(document.body, { childList: true, subtree: true });

function processLatestRound(durationMs) {
  if (isLogging) return;
  isLogging = true;

  try {
    let promptText = "";
    let responseText = "";
    let thinkingText = "";

    // --- ChatGPT DOM Selectors ---
    if (window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('chat.openai.com')) {
      const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
      const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
      
      const lastUserMsg = userMessages[userMessages.length - 1];
      const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

      if (lastUserMsg && lastAssistantMsg) {
        promptText = lastUserMsg.innerText;
        
        // Check for o1/Thinking model
        const thinkingElement = lastAssistantMsg.querySelector('.whitespace-pre-wrap:has(> .text-gray-500)'); // Updated selector heuristic
        if (thinkingElement) thinkingText = thinkingElement.innerText;
        
        responseText = lastAssistantMsg.innerText.replace(thinkingText, '').trim();
      }
    } 
    // --- Claude DOM Selectors ---
    else if (window.location.hostname.includes('claude.ai')) {
      const userMessages = document.querySelectorAll('[data-testid="user-message"]');
      const assistantMessages = document.querySelectorAll('.font-claude-message');
      
      const lastUserMsg = userMessages[userMessages.length - 1];
      const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

      if (lastUserMsg && lastAssistantMsg) {
        promptText = lastUserMsg.innerText;
        
        // Claude thinking blocks
        const thinkingElement = lastAssistantMsg.querySelector('.bg-gray-100'); 
        if (thinkingElement) thinkingText = thinkingElement.innerText;
        
        responseText = lastAssistantMsg.innerText.replace(thinkingText, '').trim();
      }
    }

    // Only log if we actually got a new prompt
    if (promptText && promptText !== lastLoggedPromptText) {
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
