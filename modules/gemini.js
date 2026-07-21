// @match *://gemini.google.com/*
// @match *://*.googleusercontent.com/*
// @host_permissions *://gemini.google.com/*
// @host_permissions *://*.googleusercontent.com/*
(function() {
    const match = (host, path) => host.includes('gemini.google.com');
    
    const cleanNode = (node) => {
        const clone = node.cloneNode(true);
        
        // Safely remove ONLY specific UI action buttons, preserving file icons and images
        clone.querySelectorAll('button[aria-label="Copy"], button[aria-label="Listen"], button[aria-label="Share"], button[aria-label="Edit"], button[aria-label="Good response"], button[aria-label="Bad response"], button[aria-label="Generate more"]').forEach(el => el.remove());
        
        return clone.innerHTML;
    };

    const extract = () => {
        const userElements = document.querySelectorAll('user-query-content');
        const modelElements = document.querySelectorAll('message-content');
        
        const effectiveUserEls = userElements.length > 0 ? userElements : document.querySelectorAll('user-query, .query-text');
        const effectiveModelEls = modelElements.length > 0 ? modelElements : document.querySelectorAll('model-response, .model-response-text, .response-container');

        const lastUserMsg = effectiveUserEls[effectiveUserEls.length - 1];
        const lastModelMsg = effectiveModelEls[effectiveModelEls.length - 1];

        if (!lastUserMsg || !lastModelMsg) return null;

        const promptHtml = cleanNode(lastUserMsg);
        let thinkingHtml = "";
        
        const thinkingElement = lastModelMsg.querySelector('[class*="thought"], [class*="reasoning"]');
        if (thinkingElement) {
            thinkingHtml = cleanNode(thinkingElement);
            thinkingElement.remove();
        }
        const responseHtml = cleanNode(lastModelMsg);

        return { promptHtml, thinkingHtml, responseHtml };
    };

    const bulkExtract = () => {
        const userElements = document.querySelectorAll('user-query-content');
        const modelElements = document.querySelectorAll('message-content');
        
        const effectiveUserEls = userElements.length > 0 ? userElements : document.querySelectorAll('user-query, .query-text');
        const effectiveModelEls = modelElements.length > 0 ? modelElements : document.querySelectorAll('model-response, .model-response-text, .response-container');

        const rounds = [];
        const maxRounds = Math.max(effectiveUserEls.length, effectiveModelEls.length);
        
        for (let i = 0; i < maxRounds; i++) {
            let promptHtml = "";
            let thinkingHtml = "";
            let responseHtml = "";

            if (effectiveUserEls[i]) promptHtml = cleanNode(effectiveUserEls[i]);
            if (effectiveModelEls[i]) {
                const thinkingElement = effectiveModelEls[i].querySelector('[class*="thought"], [class*="reasoning"]');
                if (thinkingElement) {
                    thinkingHtml = cleanNode(thinkingElement);
                }
                responseHtml = cleanNode(effectiveModelEls[i]);
            }

            if (promptHtml || responseHtml) {
                rounds.push({ promptHtml, thinkingHtml, responseHtml });
            }
        }
        return rounds;
    };

    window.ForensicModules.gemini = { match, extract, bulkExtract };
})();
