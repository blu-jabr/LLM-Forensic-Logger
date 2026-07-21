// @match *://duck.ai/*
// @host_permissions *://duck.ai/*
(function() {
    const match = (host, path) => host.includes('duck.ai');
    
    const cleanNode = (node) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button, svg, [class*="icon"]').forEach(el => el.remove());
        return clone.innerHTML;
    };

    const extract = () => {
        const userMessages = document.querySelectorAll('article[data-testid^="user-message"], .msg__user');
        const assistantMessages = document.querySelectorAll('article[data-testid^="assistant-message"], .msg__assistant');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];
        if (!lastUserMsg || !lastAssistantMsg) return null;

        return { 
            promptHtml: cleanNode(lastUserMsg), 
            thinkingHtml: "", 
            responseHtml: cleanNode(lastAssistantMsg) 
        };
    };

    const bulkExtract = () => {
        const userMessages = document.querySelectorAll('article[data-testid^="user-message"], .msg__user');
        const assistantMessages = document.querySelectorAll('article[data-testid^="assistant-message"], .msg__assistant');
        const rounds = [];
        const maxRounds = Math.max(userMessages.length, assistantMessages.length);
        
        for (let i = 0; i < maxRounds; i++) {
            let promptHtml = userMessages[i] ? cleanNode(userMessages[i]) : "";
            let responseHtml = assistantMessages[i] ? cleanNode(assistantMessages[i]) : "";
            if (promptHtml || responseHtml) {
                rounds.push({ promptHtml, thinkingHtml: "", responseHtml });
            }
        }
        return rounds;
    };

    window.ForensicModules.duckai = { match, extract, bulkExtract };
})();
