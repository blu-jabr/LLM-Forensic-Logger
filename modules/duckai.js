// @match *://duck.ai/*
// @host_permissions *://duck.ai/*
(function() {
    const match = (host, path) => host.includes('duck.ai');
    const extract = () => {
        const userMessages = document.querySelectorAll('article[data-testid^="user-message"], .msg__user');
        const assistantMessages = document.querySelectorAll('article[data-testid^="assistant-message"], .msg__assistant');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

        if (!lastUserMsg || !lastAssistantMsg) return null;

        const promptText = lastUserMsg.innerText;
        const responseText = lastAssistantMsg.innerText;

        return { promptText, thinkingText: "", responseText };
    };
    window.ForensicModules.duckai = { match, extract };
})();
