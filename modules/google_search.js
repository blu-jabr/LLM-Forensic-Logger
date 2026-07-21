// @match *://www.google.com/search*
// @host_permissions *://www.google.com/search*
(function() {
    const match = (host, path) => host.includes('google.com') && path.includes('/search');
    
    const cleanNode = (node) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button, svg, [class*="icon"], [aria-label="Copy"], [aria-label="Share"]').forEach(el => el.remove());
        return clone.innerHTML;
    };

    const extract = () => {
        const aiBlock = document.querySelector('div[aria-label*="AI Overviews"], div[data-async-context*="ai"]');
        if (!aiBlock) return null;

        const searchInput = document.querySelector('textarea[name="q"], input[name="q"]');
        const promptHtml = `<p>${searchInput ? searchInput.value : document.title}</p>`;
        const responseHtml = cleanNode(aiBlock);

        return { promptHtml, thinkingHtml: "", responseHtml };
    };

    const bulkExtract = () => {
        // Google Search AI only ever has one "round" per page load
        const data = extract();
        return data ? [data] : [];
    };

    window.ForensicModules.google_search = { match, extract, bulkExtract };
})();
