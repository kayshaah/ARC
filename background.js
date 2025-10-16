// background.js (MV3 service worker)
const AMAZON_RE = /^https:\/\/www\.amazon\.(com|ca|co\.uk|in|de|it|es|fr)\//;

function isAmazonUrl(url) { return AMAZON_RE.test(url || ""); }

chrome.runtime.onInstalled.addListener(() => {
  // default ON (change to false if you prefer)
  chrome.storage.local.set({ arcEnabled: true });
});

// When a tab updates (new URL or reload), inject if ARC is enabled and URL matches
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isAmazonUrl(tab.url)) return;
  const { arcEnabled } = await chrome.storage.local.get({ arcEnabled: true });
  if (!arcEnabled) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content_script.js"]
    });
  } catch (_) { /* ignore if already injected */ }
});

// Allow popup to request injection explicitly on the active tab
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "ARC_FORCE_INJECT") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && isAmazonUrl(tab.url)) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content_script.js"]
          });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      } else {
        sendResponse({ ok: false, error: "Not an Amazon page." });
      }
    }
  })();
  return true; // keep channel open for async

  // === ARC: backend upload proxy (background.js) ===============================
const ARC_API_BASE = "http://127.0.0.1:8001"; // change for prod

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg !== "object") return;

    // Upload a batch of reviews for storage/training
    if (msg.type === "ARC_UPLOAD_BATCH" && Array.isArray(msg.payload)) {
      try {
        const res = await fetch(`${ARC_API_BASE}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviews: msg.payload })
        });
        const json = await res.json().catch(() => ({}));
        sendResponse({ ok: res.ok, status: res.status, body: json });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }

    // Optionally: get model scores from backend
    if (msg.type === "ARC_SCORE_BATCH" && Array.isArray(msg.payload)) {
      try {
        const res = await fetch(`${ARC_API_BASE}/score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviews: msg.payload })
        });
        const json = await res.json().catch(() => ({}));
        sendResponse({ ok: res.ok, status: res.status, body: json });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }
  })();
  return true; // keep port open
});

});
