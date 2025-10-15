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

// On open, read persisted state and show it
chrome.storage.local.get({ arcEnabled: true }, ({ arcEnabled }) => setUI(arcEnabled));

// Also try to read live status from the content script (if injected on this tab)
getActiveTab(tab => {
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'ARC_GET_STATUS' }, (resp) => {
    if (chrome.runtime.lastError) return; // content script not on this page yet
    if (resp && 'enabled' in resp) setUI(!!resp.enabled);
  });
});

// Toggle: persist + (if turning on) ask background to inject into current Amazon tab
toggle.addEventListener('change', () => {
  const on = toggle.checked;
  chrome.storage.local.set({ arcEnabled: on }, () => {
    setUI(on);
    if (on) {
      chrome.runtime.sendMessage({ type: "ARC_FORCE_INJECT" }, (resp) => {
        if (chrome.runtime.lastError) return; // service worker may be asleep; harmless
        if (resp && !resp.ok) {
          errEl.textContent = "Open an Amazon product page with reviews, then toggle On.";
          errEl.style.display = 'block';
        } else {
          errEl.style.display = 'none';
        }
      });
    }
  });
});
