document.getElementById('scanBtn').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.scripting.executeScript({
      target: {tabId: tabs[0].id},
      function: () => { window.location.reload(); }
    });
  });
});

// Mock stats for demo
document.getElementById('scannedCount').innerText = Math.floor(Math.random() * 20) + 5;
document.getElementById('fakeCount').innerText = Math.floor(Math.random() * 3);
