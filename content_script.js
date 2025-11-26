// content_script.js

// --- HELPER: Check for Verified Purchase text ---
function isVerified(node) {
  return (node.innerText || "").toLowerCase().includes("verified purchase");
}

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
  const selectors = ['[data-hook="review"]', '.review', '[data-hook="review-card"]'];
  const allReviews = [];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => allReviews.push(el));
  });

  // FILTER: Only process reviews that DO NOT have a badge yet
  const unbadged = allReviews.filter(el => !el.querySelector('.arc-badge'));
  
  if (unbadged.length === 0) return;

  // Mark them temporarily to prevent race conditions
  unbadged.forEach(el => {
      const ghost = document.createElement('div');
      ghost.className = 'arc-badge-placeholder';
      el.prepend(ghost);
  });

  // Extract Text
  const payload = unbadged.map(el => ({
    review_title: pick(el, '[data-hook="review-title"]')?.innerText || "",
    review_body: pick(el, '[data-hook="review-body"]')?.innerText || "",
    verified_purchase: isVerified(el) // <--- Sending this to backend now
  }));

  // Send to Python
  const scores = await getScoresFromBackend(payload);

  // Render Badges
  unbadged.forEach((el, index) => {
    // Remove placeholder if exists
    const ghost = el.querySelector('.arc-badge-placeholder');
    if(ghost) ghost.remove();
    
    // Double check we didn't badge it while waiting
    if (el.querySelector('.arc-badge')) return;

    const score = scores ? scores[index] : 50; 
    injectBadge(el, score);
  });
}

function injectBadge(reviewNode, score) {
  // Prevent Duplicates (Safety Check)
  if (reviewNode.querySelector('.arc-badge')) return;

  let color = "#ef4444"; 
  let bg = "#fef2f2";
  let label = "Likely Fake";

  if (score >= 40) { color = "#f59e0b"; bg = "#fffbeb"; label = "Neutral"; } 
  if (score >= 70) { color = "#10b981"; bg = "#ecfdf5"; label = "Genuine"; } 

  const badge = document.createElement("div");
  badge.className = "arc-badge"; // Important class for duplicate checking
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
  
  reviewNode.prepend(badge);
}

// Run Logic
processReviews();
let timer;
window.addEventListener("scroll", () => {
  clearTimeout(timer);
  timer = setTimeout(processReviews, 500);
});
