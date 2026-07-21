// @match *://gemini.google.com/*
// @match *://*.googleusercontent.com/*
// @host_permissions *://gemini.google.com/*
// @host_permissions *://*.googleusercontent.com/*
(function() {
    const match = (host, path) => host.includes('gemini.google.com');

    // Used for the Markdown file (strips UI buttons)
    const cleanNode = (node) => {
        if (!node) return "";
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button[aria-label="Copy"], button[aria-label="Listen"], button[aria-label="Share"], button[aria-label="Edit"], button[aria-label="Good response"], button[aria-label="Bad response"], button[aria-label="Generate more"]').forEach(el => el.remove());
        return clone.outerHTML || clone.innerHTML; 
    };

    // Used for the XHTML file (ZERO modifications, preserves original URLs)
    const rawClone = (node) => {
        if (!node) return "";
        return node.cloneNode(true).outerHTML;
    };

    const getTurns = () => {
        let turns = document.querySelectorAll('infinite-scroller > div');
        if (turns.length === 0) turns = document.querySelectorAll('.conversation-container');
        if (turns.length === 0) {
            const userEls = document.querySelectorAll('user-query');
            const modelEls = document.querySelectorAll('model-response');
            turns = [];
            const max = Math.max(userEls.length, modelEls.length);
            for (let i = 0; i < max; i++) {
                const div = document.createElement('div');
                if (userEls[i]) div.appendChild(userEls[i].cloneNode(true));
                if (modelEls[i]) div.appendChild(modelEls[i].cloneNode(true));
                turns.push(div);
            }
        }
        return Array.from(turns);
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
            roundHtml: rawClone(lastTurn) // Pristine snapshot for XHTML
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
            const roundHtml = rawClone(turn); // Pristine snapshot for XHTML

            if (promptHtml || responseHtml || roundHtml) {
                rounds.push({ promptHtml, thinkingHtml: "", responseHtml, roundHtml });
            }
        }
        return rounds;
    };

    window.ForensicModules.gemini = { match, extract, bulkExtract };
})();
