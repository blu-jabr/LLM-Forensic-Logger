// @match *://chatgpt.com/*
// @match *://chat.openai.com/*
// @host_permissions *://chatgpt.com/*
// @host_permissions *://chat.openai.com/*
(function() {
    const match = (host, path) => host.includes('chatgpt.com') || host.includes('chat.openai.com');
    
    const cleanNode = (node) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button, svg, [class*="icon"], .copy-button').forEach(el => el.remove());
        return clone.innerHTML;
    };

    const extract = () => {
        const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
        const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];
        if (!lastUserMsg || !lastAssistantMsg) return null;

        const promptHtml = cleanNode(lastUserMsg);
        let thinkingHtml = "";
        
        // ChatGPT reasoning/thinking blocks
        const thinkingElement = lastAssistantMsg.querySelector('.whitespace-pre-wrap:has(> .text-gray-500), [class*="reasoning"], [class*="think-block"]');
        if (thinkingElement) {
            thinkingHtml = cleanNode(thinkingElement);
            thinkingElement.remove(); 
        }
        const responseHtml = cleanNode(lastAssistantMsg);

        return { promptHtml, thinkingHtml, responseHtml };
    };

    const bulkExtract = () => {
        const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
        const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
        const rounds = [];
        const maxRounds = Math.max(userMessages.length, assistantMessages.length);
        
        for (let i = 0; i < maxRounds; i++) {
            let promptHtml = "";
            let thinkingHtml = "";
            let responseHtml = "";

            if (userMessages[i]) promptHtml = cleanNode(userMessages[i]);

            if (assistantMessages[i]) {
                const thinkingElement = assistantMessages[i].querySelector('.whitespace-pre-wrap:has(> .text-gray-500), [class*="reasoning"], [class*="think-block"]');
                if (thinkingElement) {
                    thinkingHtml = cleanNode(thinkingElement);
                }
                responseHtml = cleanNode(assistantMessages[i]);
            }

            if (promptHtml || responseHtml) {
                rounds.push({ promptHtml, thinkingHtml, responseHtml });
            }
        }
        return rounds;
    };

    window.ForensicModules.chatgpt = { match, extract, bulkExtract };
})();
