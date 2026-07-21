// @match *://gemini.google.com/*
// @host_permissions *://gemini.google.com/*
(function() {
    const match = (host, path) => host.includes('gemini.google.com');
    const extract = () => {
        // Gemini uses custom tags, but we need to find the text inside them
        const userElements = document.querySelectorAll('user-query, .query-text');
        const modelElements = document.querySelectorAll('model-response, .model-response-text, .response-container');

        const lastUserMsg = userElements[userElements.length - 1];
        const lastModelMsg = modelElements[modelElements.length - 1];

        if (!lastUserMsg || !lastModelMsg) return null;

        const promptText = lastUserMsg.innerText.trim();
        
        // Gemini often injects "Copy" or "Listen" buttons into the response block
        let responseText = lastModelMsg.innerText;
        responseText = responseText.replace(/Copy|Listen|Share|Edit|Copy code/g, '').trim();

        return { promptText, thinkingText: "", responseText };
    };
    window.ForensicModules.gemini = { match, extract };
})();
