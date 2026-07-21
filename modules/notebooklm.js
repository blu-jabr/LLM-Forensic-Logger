// @host *://notebooklm.google.com/*
// @host_permissions *://notebooklm.google.com/*
(function() {
    const match = (host, path) => host.includes('notebooklm.google.com');
    const extract = () => {
        const userMessages = document.querySelectorAll('.chat-message-user, .user-query');
        const assistantMessages = document.querySelectorAll('.chat-message-model, .model-response');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

        if (!lastUserMsg || !lastAssistantMsg) return null;

        const promptText = lastUserMsg.innerText;
        const responseText = lastAssistantMsg.innerText;

        return { promptText, thinkingText: "", responseText };
    };
    window.ForensicModules.notebooklm = { match, extract };
})();
