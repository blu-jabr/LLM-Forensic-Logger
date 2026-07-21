(function() {
    const match = (host, path) => host.includes('gemini.google.com');
    const extract = () => {
        const userMessages = document.querySelectorAll('user-query, .query-text');
        const assistantMessages = document.querySelectorAll('model-response, .model-response-text');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

        if (!lastUserMsg || !lastAssistantMsg) return null;

        const promptText = lastUserMsg.innerText;
        const responseText = lastAssistantMsg.innerText;

        return { promptText, thinkingText: "", responseText };
    };
    window.ForensicModules.gemini = { match, extract };
})();
