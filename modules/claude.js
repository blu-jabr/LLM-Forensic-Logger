(function() {
    const match = (host, path) => host.includes('claude.ai');
    const extract = () => {
        const userMessages = document.querySelectorAll('[data-testid="user-message"]');
        const assistantMessages = document.querySelectorAll('.font-claude-message');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

        if (!lastUserMsg || !lastAssistantMsg) return null;

        const promptText = lastUserMsg.innerText;
        let thinkingText = "";
        const thinkingElement = lastAssistantMsg.querySelector('.bg-gray-100');
        if (thinkingElement) thinkingText = thinkingElement.innerText;
        const responseText = lastAssistantMsg.innerText.replace(thinkingText, '').trim();

        return { promptText, thinkingText, responseText };
    };
    window.ForensicModules.claude = { match, extract };
})();
