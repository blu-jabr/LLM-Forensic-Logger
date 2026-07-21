(function() {
    const match = (host, path) => host.includes('chatgpt.com') || host.includes('chat.openai.com');
    const extract = () => {
        const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
        const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

        if (!lastUserMsg || !lastAssistantMsg) return null;

        const promptText = lastUserMsg.innerText;
        let thinkingText = "";
        const thinkingElement = lastAssistantMsg.querySelector('.whitespace-pre-wrap:has(> .text-gray-500)');
        if (thinkingElement) thinkingText = thinkingElement.innerText;
        const responseText = lastAssistantMsg.innerText.replace(thinkingText, '').trim();

        return { promptText, thinkingText, responseText };
    };
    window.ForensicModules.chatgpt = { match, extract };
})();
