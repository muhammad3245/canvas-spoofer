chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'extension-health' && Number.isInteger(sender.tab?.id)) {
    chrome.storage.session.set({ [`active-${sender.tab.id}`]: true });
    return;
  }
  if (message?.type === 'get-extension-health') {
    if (!Number.isInteger(message.tabId)) {
      sendResponse({ active: false });
      return;
    }
    chrome.storage.session.get(`active-${message.tabId}`, result => {
      sendResponse({ active: Boolean(result[`active-${message.tabId}`]) });
    });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') chrome.storage.session.remove(`active-${tabId}`);
});
chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(`active-${tabId}`));
