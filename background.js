const ARC_API = "http://127.0.0.1:8001";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ARC_GET_SCORES") {
    fetch(`${ARC_API}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload)
    })
    .then(res => res.json())
    .then(data => sendResponse({ ok: true, body: data }))
    .catch(err => sendResponse({ ok: false, error: err.toString() }));
    
    return true; // Async wait
  }
});
