document.getElementById('bulkLog').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'BULK_LOG_REQUEST' }, (response) => {
      // This callback checks if the content script was actually there
      if (chrome.runtime.lastError) {
        document.getElementById('status').textContent = "Error: Please refresh the page!";
        document.getElementById('status').style.color = 'red';
      } else {
        document.getElementById('status').textContent = "Extracting... Check downloads.";
        document.getElementById('status').style.color = 'green';
      }
      setTimeout(() => window.close(), 3000);
    });
  });
});
