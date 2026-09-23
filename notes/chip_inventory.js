// Full inventory: container_id + decoded jslog IDs, for cross-run stability test
copy(JSON.stringify(
  [...document.querySelectorAll('source-inline-chip')].map(c => {
    const btn = c.querySelector('button[jslog*="BardVeMetadataKey"]');
    let js = null;
    if (btn) {
      const m = (btn.getAttribute('jslog') || '').match(/BardVeMetadataKey:([A-Za-z0-9+\/=]+)/);
      if (m) { try { js = JSON.parse(atob(m[1]))[0]; } catch (e) {} }
    }
    return {
      cid: (c.closest('[id^="p-rc_"]') || {}).id || null,
      response_id: js ? js[0] : null,
      chunk_id: js ? js[3] : null,
      titles: [...c.querySelectorAll('.source-title')].map(t => t.textContent.replace(/\s+/g, ' ').trim())
    };
  }).filter(x => x.titles.length)
    .sort((a, b) => (a.cid || '').localeCompare(b.cid || '')),
  null, 2));
console.log('copied');
