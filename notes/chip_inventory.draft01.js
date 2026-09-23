// Chip inventory with stable-ish keys. Run BEFORE and AFTER a page reload;
// compare cid values for the same titles. If cids match across reloads,
// container-id cache keys are stable. If they change, report back.
copy(JSON.stringify(
  [...document.querySelectorAll('source-inline-chip')].map(c => ({
    cid: (c.closest('[id^="p-rc_"]') || {}).id || null,
    titles: [...c.querySelectorAll('.source-title')].map(t => t.textContent.replace(/\s+/g, ' ').trim()),
    multi: /multiple/i.test((c.querySelector('button') || {}).className || '')
  })).filter(x => x.titles.length)
    .sort((a, b) => (a.cid || '').localeCompare(b.cid || '')),
  null, 2));
console.log('copied — paste to a file and label it with the run timestamp');
