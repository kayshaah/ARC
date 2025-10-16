const toggle = document.getElementById('arcToggle');
const stateEl = document.getElementById('arcState');
const errEl = document.getElementById('err');

function setUI(on) {
  toggle.checked = !!on;
  stateEl.textContent = on ? 'On' : 'Off';
}

function getActiveTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => cb(tabs[0]));
}

// Init from storage
chrome.storage.local.get({ arcEnabled: true }, ({ arcEnabled }) => setUI(arcEnabled));

// Try to get live status from the page (content script)
getActiveTab(tab => {
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'ARC_GET_STATUS' }, (resp) => {
    if (chrome.runtime.lastError) return; // content script not present; ignore
    if (resp && 'enabled' in resp) setUI(!!resp.enabled);
  });
});

// Toggle handler
toggle.addEventListener('change', () => {
  const on = toggle.checked;
  chrome.storage.local.set({ arcEnabled: on }, () => {
    setUI(on);
    if (on) {
      // Ask background to inject into current Amazon tab
      chrome.runtime.sendMessage({ type: "ARC_FORCE_INJECT" }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && !resp.ok) {
          errEl.textContent = "Open an Amazon product page with reviews, then toggle On.";
          errEl.hidden = false;
        } else {
          errEl.hidden = true;
        }
      });
    }
  });
});
