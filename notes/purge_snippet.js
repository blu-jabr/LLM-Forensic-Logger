// run in service worker console to purge citation chip cache

chrome.storage.local.remove(['citationUrlCache', 'citationIdCache'], () => console.log('purged'));
chrome.storage.local.get(['citationUrlCache', 'citationIdCache'], d => console.log(JSON.stringify(d, null, 2)));

// nuclear option: wipe ALL extension state (hostname too — re-set it in Options!)
// chrome.storage.local.clear(() => console.log('all state cleared'));
