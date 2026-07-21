// @match *://notebooklm.google.com/*
// @host_permissions *://notebooklm.google.com/*
(function() {
    const match = (host, path) => host.includes('notebooklm.google.com');
    
    const cleanNode = (node) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button, svg, [class*="icon"]').forEach(el => el.remove());
        return clone.innerHTML;
    };

    const extract = () => {
        const userMessages = document.querySelectorAll('.chat-message-user, .user-query');
        const assistantMessages = document.querySelectorAll('.chat-message-model, .model-response');
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
        const userMessages = document.querySelectorAll('.chat-message-user, .user-query');
        const assistantMessages = document.querySelectorAll('.chat-message-model, .model-response');
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

    window.ForensicModules.notebooklm = { match, extract, bulkExtract };
})();
