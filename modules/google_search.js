(function() {
    const match = (host, path) => host.includes('google.com') && path.includes('/search');
    const extract = () => {
        const aiBlock = document.querySelector('div[aria-label*="AI Overviews"], div[data-async-context*="ai"]');
        if (!aiBlock) return null;

        const searchInput = document.querySelector('textarea[name="q"], input[name="q"]');
        const promptText = searchInput ? searchInput.value : document.title;
        
        let responseText = aiBlock.innerText;
        responseText = responseText.replace(/Generate more|Share|Copy/g, '').trim();

        return { promptText, thinkingText: "", responseText };
    };
    window.ForensicModules.google_search = { match, extract };
})();
