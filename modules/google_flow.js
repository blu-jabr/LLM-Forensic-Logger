// @match *://labs.google/fx/tools/flow*
// @host_permissions *://labs.google/fx/tools/flow*
(function() {
    const match = (host, path) => host.includes('labs.google') && path.includes('fx/tools/flow');
    
    const cleanNode = (node) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button, svg, [class*="icon"]').forEach(el => el.remove());
        return clone.innerHTML;
    };

    const extract = () => {
        const promptArea = document.querySelector('textarea, input[type="text"]');
        if (!promptArea) return null;

        const promptHtml = `<p>${promptArea.value || promptArea.innerText}</p>`;
        let responseHtml = "";

        const creationBlocks = document.querySelectorAll('[class*="creation"], [class*="result"], [class*="generation"], [class*="asset"]');
        if (creationBlocks.length > 0) {
            const lastBlock = creationBlocks[creationBlocks.length - 1];
            responseHtml = cleanNode(lastBlock);
        } else {
            responseHtml = "<p>[Video generation initiated/completed - No extractable text metadata found]</p>";
        }

        return { promptHtml, thinkingHtml: "", responseHtml };
    };

    const bulkExtract = () => {
        // Flow typically only shows the latest generation on screen
        const data = extract();
        return data ? [data] : [];
    };

    window.ForensicModules.google_flow = { match, extract, bulkExtract };
})();
