// Bulk-time harvester: click each unique chip once, with tab-opens swallowed
async function harvestChipsViaClicks() {
    const chips = [...document.querySelectorAll('source-inline-chip')];
    const byTitle = new Map();
    chips.forEach(chip => {
        const t = chip.querySelector('.source-title');
        const label = t ? t.textContent.replace(/\s+/g, ' ').trim() : '';
        if (label && !byTitle.has(norm(label).slice(0, 120))) byTitle.set(norm(label).slice(0, 120), chip);
    });
    if (byTitle.size === 0) return;
    dlog(`Harvesting ${byTitle.size} unique citation chip(s) via keyboard...`);
    window.postMessage({ type: 'FORENSIC_SET_HARVEST', value: true }, '*');
    await new Promise(r => setTimeout(r, 150));

    try {
        for (const [key, chip] of byTitle) {
            if (citationUrlCache.has(key)) continue; // already known
            const btn = chip.querySelector('button');
            if (!btn) continue;
            const before = pendingOpenQueue.length;
            lastHoveredChipTitle = key;
            btn.focus();
            btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 700));

            let url = null;
            const dlg = document.querySelector('[role="dialog"]');
            if (dlg) {
                const a = [...dlg.querySelectorAll('a[href]')]
                    .find(a => /^https?:/i.test(a.href) && !/google\.(com|co)|gstatic\.com|googleusercontent\.com/i.test(a.href));
                if (a) url = a.href;
                if (!url) {  // URL may live in a data-* attribute on the source cards
                    for (const el of dlg.querySelectorAll('*')) {
                        for (const attr of el.attributes) {
                            if (attr.name.startsWith('data-') && /^https?:/i.test(attr.value)) { url = attr.value; break; }
                        }
                        if (url) break;
                    }
                }
                if (!url) {  // last resort: click the first card, rely on open-interception
                    const card = dlg.querySelector('button, [role="button"]');
                    if (card) { card.click(); await new Promise(r => setTimeout(r, 500)); }
                    if (pendingOpenQueue.length > before) url = pendingOpenQueue[pendingOpenQueue.length - 1];
                }
            }
            if (!url && pendingOpenQueue.length > before) url = pendingOpenQueue[pendingOpenQueue.length - 1];

            if (url) { cachePut(key, url); dlog('Harvested:', key, '->', url); }
            else dlog('No URL captured for:', key);

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(r => setTimeout(r, 200));
            if (document.querySelector('[role="dialog"]')) {  // synthetic Escape ignored?
                const x = document.querySelector('[role="dialog"] [aria-label*="lose"], [role="dialog"] button[aria-label*="Close"]');
                if (x) x.click();
                await new Promise(r => setTimeout(r, 200));
            }
        }
    } finally {
        lastHoveredChipTitle = null;
        window.postMessage({ type: 'FORENSIC_SET_HARVEST', value: false }, '*');
    }
}
