# Directory structure of notes/ 

```text
notes/
├── purge_snippet.js                  // have it
├── chip_inventory.js                 // the second snippet above (stability test + jslog decode)
├── chip_inventory_by_scroll.js       // same, but note you must re-run per scroll position (virtual scroller)
├── storage_dump.js                   // service-worker console:
│                                     //   chrome.storage.local.get(null, d => copy(JSON.stringify(d,null,2)));
│                                     //   (dumps sessions, sessionPackets, caches — full state snapshot)
├── hover_probe.js                    // page console; logs every hover-card anchor live:
│                                     //   new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n =>
│                                     //     n.querySelectorAll && n.querySelectorAll('a[href]').forEach(a =>
│                                     //       console.log('hover anchor:', a.href.slice(0,120))))).observe(document.body,{childList:true,subtree:true});
├── dialog_probe.js                   // focus chip, press Enter manually, then:
│                                     //   copy(document.querySelector('[role="dialog"]').outerHTML)
└── cid_compare.md                    // a text file where you paste inventory runs + timestamps
```

