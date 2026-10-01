document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['hostname'], (result) => {
    if (result.hostname) {
      document.getElementById('hostname').value = result.hostname;
    }
  });

  document.getElementById('save').addEventListener('click', () => {
    const hostname = document.getElementById('hostname').value.trim() || 'unknown-host';
    chrome.storage.local.set({ hostname: hostname }, () => {
      const status = document.getElementById('status');
      status.textContent = 'Saved.';
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
});
