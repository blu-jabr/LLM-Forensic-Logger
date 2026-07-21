// @match *://claude.ai/*
// @host_permissions *://claude.ai/*
(function() {
    const match = (host, path) => host.includes('claude.ai');
    
    const cleanNode = (node) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button, svg, [class*="icon"], .copy-button').forEach(el => el.remove());
        return clone.innerHTML;
    };

    const extract = () => {
        const userMessages = document.querySelectorAll('[data-testid="user-message"]');
        const assistantMessages = document.querySelectorAll('.font-claude-message');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];
        if (!lastUserMsg || !lastAssistantMsg) return null;

        const promptHtml = cleanNode(lastUserMsg);
        let thinkingHtml = "";
        
        // Claude thinking blocks often have this background or a specific testid
        const thinkingElement = lastAssistantMsg.querySelector('.bg-gray-100, [class*="thinking"], [data-testid="thinking"]');
        if (thinkingElement) {
            thinkingHtml = cleanNode(thinkingElement);
            thinkingElement.remove();
        }
        const responseHtml = cleanNode(lastAssistantMsg);

        return { promptHtml, thinkingHtml, responseHtml };
    };

    const bulkExtract = () => {
        const userMessages = document.querySelectorAll('[data-testid="user-message"]');
        const assistantMessages = document.querySelectorAll('.font-claude-message');
        const rounds = [];
        const maxRounds = Math.max(userMessages.length, assistantMessages.length);
        
        for (let i = 0; i < maxRounds; i++) {
            let promptHtml = "";
            let thinkingHtml = "";
            let responseHtml = "";

            if (userMessages[i]) promptHtml = cleanNode(userMessages[i]);

            if (assistantMessages[i]) {
                const thinkingElement = assistantMessages[i].querySelector('.bg-gray-100, [class*="thinking"], [data-testid="thinking"]');
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

    window.ForensicModules.claude = { match, extract, bulkExtract };
})();
