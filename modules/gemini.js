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

    // FIX: Filter out garbage UI wrapper divs
    const getTurns = () => {
        let potentialTurns = document.querySelectorAll('infinite-scroller > div, .conversation-container > div');
        let validTurns = [];
        
        potentialTurns.forEach(turn => {
            // A valid turn MUST contain a user query or a model response
            if (turn.querySelector('user-query, model-response, .query-text, .response-container')) {
                validTurns.push(turn);
            }
        });

        // Fallback if wrapper structure changed completely
        if (validTurns.length === 0) {
            const userEls = document.querySelectorAll('user-query');
            const modelEls = document.querySelectorAll('model-response');
            const max = Math.max(userEls.length, modelEls.length);
            for (let i = 0; i < max; i++) {
                const div = document.createElement('div');
                if (userEls[i]) div.appendChild(userEls[i].cloneNode(true));
                if (modelEls[i]) div.appendChild(modelEls[i].cloneNode(true));
                validTurns.push(div);
            }
        }
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
