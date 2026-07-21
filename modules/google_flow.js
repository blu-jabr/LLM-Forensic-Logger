// @match *://labs.google/*
// @host_permissions *://labs.google/*
(function() {
    const match = (host, path) => host.includes('labs.google') && path.includes('fx/tools/flow');
    const extract = () => {
        const promptArea = document.querySelector('textarea, input[type="text"]');
        if (!promptArea) return null;

        const promptText = promptArea.value || promptArea.innerText;
        let responseText = "";

        const creationBlocks = document.querySelectorAll('[class*="creation"], [class*="result"], [class*="generation"], [class*="asset"]');
        if (creationBlocks.length > 0) {
            const lastBlock = creationBlocks[creationBlocks.length - 1];
            responseText = lastBlock.innerText.replace(/Download|Share|Edit|Delete|Generate/g, '').trim();
        } else {
            responseText = "[Video generation initiated/completed - No extractable text metadata found]";
        }

        return { promptText, thinkingText: "", responseText };
    };
    window.ForensicModules.google_flow = { match, extract };
})();
