(() => {
  'use strict';
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'extension-health-check' || event.data?.type !== 'armed') return;
    chrome.runtime.sendMessage({ type: 'extension-health', active: true }).catch(() => {});
  });
})();
