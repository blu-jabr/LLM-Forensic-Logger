// @match *://gemini.google.com/*
// @host_permissions *://gemini.google.com/*
// @world MAIN
(function() {
    const relay = (url) => {
        try { window.top.postMessage({ type: 'FORENSIC_WINDOW_OPEN', url: String(url) }, '*'); } catch (e) {}
    };

    // window.open — programmatic opens (left-click path)
    const origOpen = window.open;
    window.open = function(url, target, features) {
        console.debug('[FL:inject] window.open called with:', url);
        try { if (url && typeof url === 'string' && /^https?:/i.test(url)) relay(url); } catch (e) {}
        if (window.__FORENSIC_HARVEST__) return null;
        return origOpen.call(window, url, target, features);
    };

    // Anchor navigation: click (left) AND auxclick (middle/right button).
    // Middle-click is handled natively by the browser — no window.open —
    // so auxclick is the ONLY interception point for it.
    const handleAnchorNav = (e) => {
        const path = (e.composedPath && e.composedPath()) || [];
        const A = path.find(n => n && n.tagName === 'A') ||
                  (e.target && e.target.closest ? e.target.closest('a[href]') : null);
        if (A && A.href && /^https?:/i.test(A.href)) {
            console.debug('[FL:inject]', e.type, '(button=' + e.button + ') ->', A.href);
            try {
                window.top.postMessage({
                    type: 'FORENSIC_WINDOW_OPEN',
                    url: String(A.href),
                    anchorHtml: A.outerHTML.slice(0, 500)      // NEW: lets content.js identify the sub-citation
                }, '*');
            } catch (e2) {}
            if (window.__FORENSIC_HARVEST__) e.preventDefault();
        }
    };

    document.addEventListener('click', handleAnchorNav, true);
    document.addEventListener('auxclick', handleAnchorNav, true);

    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'FORENSIC_SET_HARVEST') window.__FORENSIC_HARVEST__ = !!e.data.value;
    });
})();
