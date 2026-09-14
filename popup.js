function setStatus(text, color) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.style.color = color;
}

document.getElementById('bulkLog').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'BULK_LOG_REQUEST' }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus("Error: Please refresh the page!", 'red');
      } else {
        setStatus("Extracting... Check downloads.", 'green');
      }
      setTimeout(() => window.close(), 3000);
    });
  });
});

document.getElementById('handoff').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    let chatId = 'unknown';
    try { chatId = new URL(tabs[0].url).pathname.split('/').pop() || 'unknown'; } catch (e) {}

    chrome.runtime.sendMessage({ type: 'GENERATE_HANDOFF', chatId: chatId }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setStatus("Error: background unreachable. Reload the extension.", 'red');
        return;
      }
      if (response.status === 'success') {
        setStatus(`Handoff written from ${response.rounds} rounds. Check downloads.`, 'green');
        setTimeout(() => window.close(), 4000);
      } else if (response.status === 'empty') {
        setStatus(response.message, '#b45309');
      } else {
        setStatus('Error: ' + (response.error || 'unknown'), 'red');
      }
    });
  });
});
