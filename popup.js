const card = document.getElementById('card');
const title = document.getElementById('title');
const detail = document.getElementById('detail');
const fixButton = document.getElementById('fix');

function showState(active, tab) {
  card.dataset.state = active ? 'active' : 'inactive';
  title.textContent = active ? 'Active and working' : 'Inactive';
  detail.textContent = active ? 'Everything is running on this page.' : 'This page may need a refresh.';
  fixButton.hidden = active || !tab?.id || !/^https?:/.test(tab.url || '');
}

chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const tab = tabs[0];
  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    showState(false, null);
    detail.textContent = 'Open a regular web page to use the extension.';
    return;
  }
  chrome.runtime.sendMessage({ type: 'get-extension-health', tabId: tab.id }, response => {
    if (chrome.runtime.lastError) showState(false, tab);
    else showState(Boolean(response?.active), tab);
  });
});

fixButton.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
    window.close();
  });
});
