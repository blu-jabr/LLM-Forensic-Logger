# How to add a new LLM model

I am building a Chromium extension that logs LLM chats. I need you to generate a new modular content script file for [INSERT LLM NAME] (URL: [INSERT LLM URL]).

Please write the file following this exact format and structure. The file must start with the @match and @host_permissions comments so my build script can parse them. It must use an IIFE to attach itself to the `window.ForensicModules` namespace.

The module must export two functions:
1. `match(host, path)`: returns true if the host/path matches the LLM.
2. `extract()`: queries the DOM for the latest user prompt, the LLM's thinking text (if applicable), and the LLM's response text. Returns an object: `{ promptText, thinkingText, responseText }`.

Here is an example of the required format for a ChatGPT module:

    // @match *://chatgpt.com/*
    // @host_permissions *://chatgpt.com/*
    (function() {
        const match = (host, path) => host.includes('chatgpt.com');
        const extract = () => {
            const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
            const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
            const lastUserMsg = userMessages[userMessages.length - 1];
            const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];
    
            if (!lastUserMsg || !lastAssistantMsg) return null;
    
            const promptText = lastUserMsg.innerText;
            let thinkingText = "";
            const thinkingElement = lastAssistantMsg.querySelector('.whitespace-pre-wrap:has(> .text-gray-500)');
            if (thinkingElement) thinkingText = thinkingElement.innerText;
            const responseText = lastAssistantMsg.innerText.replace(thinkingText, '').trim();
    
            return { promptText, thinkingText, responseText };
        };
        window.ForensicModules.chatgpt = { match, extract };
    })();
    
Please generate the equivalent file for [INSERT LLM NAME]. Use your knowledge of [INSERT LLM NAME]'s DOM structure, or use standard semantic HTML querying to find the most likely containers for user messages and AI responses. Name the module window.ForensicModules.[insert_module_name].
