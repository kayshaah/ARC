// --- ARC Content Script ---

function pick(el, sel) { return el.querySelector(sel); }

async function getScoresFromBackend(reviews) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "ARC_GET_SCORES", payload: { reviews } }, resp => {
      if (resp && resp.ok && resp.body) resolve(resp.body.scores);
      else resolve(null);
    });
  });
}

async function processReviews() {
  // 1. Find all review elements that haven't been processed
  const selectors = ['[data-hook="review"]', '.review', '[data-hook="review-card"]'];
  const allReviews = [];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => allReviews.push(el));
  });

  const unbadged = allReviews.filter(el => el.dataset.arcProcessed !== "1");
  if (unbadged.length === 0) return;

  // 2. Mark them as processing so we don't duplicate
  unbadged.forEach(el => el.dataset.arcProcessed = "1");

  // 3. Extract Text
  const payload = unbadged.map(el => ({
    review_title: pick(el, '[data-hook="review-title"]')?.innerText || "",
    review_body: pick(el, '[data-hook="review-body"]')?.innerText || ""
  }));

  // 4. Send to Python
  console.log(`[ARC] Sending ${payload.length} reviews to ML model...`);
  const scores = await getScoresFromBackend(payload);

  // 5. Render Badges
  unbadged.forEach((el, index) => {
    const score = scores ? scores[index] : 50; // Default 50 if error
    injectBadge(el, score);
  });
}

function injectBadge(reviewNode, score) {
  // Determine Color
  let color = "#ef4444"; // Red (Fake)
  let bg = "#fef2f2";
  let label = "Likely Fake";

  if (score > 40) { color = "#f59e0b"; bg = "#fffbeb"; label = "Neutral"; } // Yellow
  if (score > 70) { color = "#10b981"; bg = "#ecfdf5"; label = "Genuine"; } // Green

  const badge = document.createElement("div");
  badge.className = "arc-badge";
  badge.innerHTML = `
    <div style="
      background: ${bg}; color: ${color}; border: 1px solid ${color};
      font-weight: bold; font-size: 12px; padding: 4px 8px; 
      border-radius: 6px; display: inline-flex; align-items: center; gap: 6px;
      margin-bottom: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    ">
      <span>ARC Score: ${score}%</span>
      <span style="opacity: 0.7; font-weight: normal;">| ${label}</span>
    </div>
  `;
  
  // Insert at the top of the review
  reviewNode.prepend(badge);
}

// --- Run Logic ---
// Run immediately
processReviews();

// Run when user scrolls (to catch lazy loaded reviews)
let timer;
window.addEventListener("scroll", () => {
  clearTimeout(timer);
  timer = setTimeout(processReviews, 500);
});
