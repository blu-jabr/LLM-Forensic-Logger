// @match *://gemini.google.com/*
// @match *://*.googleusercontent.com/*
// @host_permissions *://gemini.google.com/*
// @host_permissions *://*.googleusercontent.com/*
(function() {
    const match = (host, path) => host.includes('gemini.google.com');

    const cleanNode = (node) => {
        if (!node) return "";
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button[aria-label="Copy"], button[aria-label="Listen"], button[aria-label="Share"], button[aria-label="Edit"], button[aria-label="Good response"], button[aria-label="Bad response"], button[aria-label="Generate more"]').forEach(el => el.remove());
        return clone.outerHTML || clone.innerHTML; 
    };

    const rawClone = (node) => {
        if (!node) return "";
        return node.cloneNode(true).outerHTML;
    };

    // FIX: Smarter session name extraction
    const getSessionName = () => {
        // Look for the active/selected conversation in the sidebar
        const activeItem = document.querySelector('.chat-history-item-selected, [aria-current="page"] .conversation-title, [data-test-id="conversation-title"]');
        if (activeItem && activeItem.innerText.trim() && !activeItem.innerText.includes("Flash")) {
            return activeItem.innerText.trim();
        }
        
        // Fallback: Use the very first user prompt as the title
        const firstPrompt = document.querySelector('user-query-content, user-query, .query-text');
        if (firstPrompt && firstPrompt.innerText.trim()) {
            const text = firstPrompt.innerText.trim().replace(/\n/g, ' ');
            return text.length > 50 ? text.substring(0, 50) + "..." : text;
        }
        
        return "Untitled Gemini Session";
    };

    const extractMetadata = (node) => {
        if (!node) return {};
        const metadata = { messageIds: [], testIds: [], citations: [] };
        
        const idEls = node.querySelectorAll('[data-message-id], [data-id]:not(script)');
        idEls.forEach(el => {
            const id = el.getAttribute('data-message-id') || el.getAttribute('data-id');
            if (id && !metadata.messageIds.includes(id)) metadata.messageIds.push(id);
        });

        const testEls = node.querySelectorAll('[data-test-id]');
        testEls.forEach(el => {
            const testId = el.getAttribute('data-test-id');
            if (testId && !metadata.testIds.includes(testId)) metadata.testIds.push(testId);
        });

        const citeEls = node.querySelectorAll('[data-provenance], [data-citation]');
        citeEls.forEach(el => {
            const cite = el.getAttribute('data-provenance') || el.getAttribute('data-citation');
            const link = el.href || (el.closest('a') ? el.closest('a').href : null);
            if (cite && !metadata.citations.some(c => c.id === cite)) {
                metadata.citations.push({ id: cite, url: link });
            }
        });
        return metadata;
    };

    // FIX: Traverse in strict DOM order, no visual sorting
    const getTurns = () => {
        const allEls = Array.from(document.querySelectorAll('user-query, model-response'));
        const validTurns = [];
        let currentTurn = document.createElement('div');
        
        for (let el of allEls) {
            const isUser = el.tagName.toLowerCase() === 'user-query';
            if (isUser) {
                // If we already have content, push the previous turn
                if (currentTurn.children.length > 0) {
                    validTurns.push(currentTurn);
                }
                // Start a new turn
                currentTurn = document.createElement('div');
                currentTurn.appendChild(el.cloneNode(true));
            } else {
                // It's a model response, add to current turn
                currentTurn.appendChild(el.cloneNode(true));
            }
        }
        // Push the final turn
        if (currentTurn.children.length > 0) validTurns.push(currentTurn);
        
        return validTurns;
    };

    const extract = () => {
        const turns = getTurns();
        const lastTurn = turns[turns.length - 1];
        if (!lastTurn) return null;

        const userEl = lastTurn.querySelector('user-query-content, user-query, .query-text');
        const modelEl = lastTurn.querySelector('message-content, model-response, .response-container');

        return {
            promptHtml: cleanNode(userEl),
            thinkingHtml: "",
            responseHtml: cleanNode(modelEl),
            roundHtml: rawClone(lastTurn),
            metadata: extractMetadata(lastTurn)
        };
    };

    const bulkExtract = () => {
        const turns = getTurns();
        const rounds = [];
        for (let turn of turns) {
            const userEl = turn.querySelector('user-query-content, user-query, .query-text');
            const modelEl = turn.querySelector('message-content, model-response, .response-container');

            const promptHtml = cleanNode(userEl);
            const responseHtml = cleanNode(modelEl);
            const roundHtml = rawClone(turn);

            if (promptHtml || responseHtml || roundHtml) {
                rounds.push({ 
                    promptHtml, 
                    thinkingHtml: "", 
                    responseHtml, 
                    roundHtml,
                    metadata: extractMetadata(turn)
                });
            }
        }
        return rounds;
    };

    window.ForensicModules.gemini = { match, extract, bulkExtract, getSessionName };
})();
