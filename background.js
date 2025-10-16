// === ARC background.js (MV3 service worker) ================================

// ---- DIAGNOSTICS -----------------------------------------------------------
console.log("[ARC/bg] loaded");

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[ARC/bg] onInstalled:", details.reason);
});
chrome.runtime.onStartup?.addListener?.(() => {
  console.log("[ARC/bg] onStartup");
});

// ---- CONFIG ---------------------------------------------------------------
const ARC_API_BASE = "http://127.0.0.1:8001"; // change for prod

// ---- MESSAGE HANDLER -------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ARC_PING") {
        console.log("[ARC/bg] PING from", sender?.tab?.id);
        sendResponse({ ok: true, pong: true, time: Date.now() });
        return;
      }

      if (msg.type === "ARC_UPLOAD_BATCH" && Array.isArray(msg.payload)) {
        const n = msg.payload.length;
        console.log("[ARC/bg] uploading batch:", n);
        const res = await fetch(`${ARC_API_BASE}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviews: msg.payload }),
        });
        const text = await res.text();
        console.log("[ARC/bg] upload result:", res.status, text);
        // Try to parse JSON; if fails, return raw text
        let body;
        try { body = JSON.parse(text); } catch { body = { raw: text }; }
        sendResponse({ ok: res.ok, status: res.status, body });
        return;
      }

      if (msg.type === "ARC_FORCE_INJECT") {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id || !tab.url) {
          sendResponse({ ok: false, error: "No active tab." });
          return;
        }
        const AMAZON_RE = /^https:\/\/www\.amazon\.(com|ca|co\.uk|in|de|it|es|fr)\//;
        if (!AMAZON_RE.test(tab.url)) {
          sendResponse({ ok: false, error: "Not an Amazon page." });
          return;
        }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content_script.js"]
        });
        sendResponse({ ok: true });
        }  catch (e) {
        console.error("[ARC/bg] ARC_FORCE_INJECT error:", e);
        sendResponse({ ok: false, error: String(e) });
        }
        return;
        }


      console.warn("[ARC/bg] unknown message:", msg);
      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (e) {
      console.error("[ARC/bg] error:", e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep channel open (async)
});

// });

// });
