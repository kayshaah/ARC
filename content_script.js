// content_script.js (Updated Scraper)

// --- HELPERS ---
function pick(el, sel) { return el.querySelector(sel); }

function isVerified(node) {
  const text = node.innerText || "";
  return text.toLowerCase().includes("verified purchase");
}

function getImageCount(node) {
  // Amazon uses different classes for images depending on layout
  const imgs = node.querySelectorAll('.review-image-tile, .review-image-section img');
  return imgs.length;
}

function getAuthorName(node) {
  const el = pick(node, '.a-profile-name');
  return el ? el.innerText.trim() : "Unknown";
}

// --- API ---
async function getScoresFromBackend(reviews) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "ARC_GET_SCORES", payload: { reviews } }, resp => {
      if (resp && resp.ok && resp.body) resolve(resp.body.scores);
      else resolve(null);
    });
  });
}

// --- MAIN LOGIC ---
async function processReviews() {
  const selectors = ['[data-hook="review"]', '.review', '[data-hook="review-card"]'];
  const allReviews = [];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => allReviews.push(el));
  });

  const unbadged = allReviews.filter(el => !el.querySelector('.arc-badge'));
  if (unbadged.length === 0) return;

  // Mark pending
  unbadged.forEach(el => {
      const ghost = document.createElement('div');
      ghost.className = 'arc-badge-placeholder';
      el.prepend(ghost);
  });

  // 1. EXTRACT DATA FOR FORMULA
  const payload = unbadged.map(el => ({
    review_title: pick(el, '[data-hook="review-title"]')?.innerText || "",
    review_body: pick(el, '[data-hook="review-body"]')?.innerText || "",
    verified_purchase: isVerified(el),
    image_count: getImageCount(el),  // <--- NEW
    author_name: getAuthorName(el)   // <--- NEW
  }));

  const scores = await getScoresFromBackend(payload);

  unbadged.forEach((el, index) => {
    const ghost = el.querySelector('.arc-badge-placeholder');
    if(ghost) ghost.remove();
    if (el.querySelector('.arc-badge')) return;

    const scoreData = scores ? scores[index] : { total: 50, label: "?" }; 
    injectBadge(el, scoreData);
  });
}

function injectBadge(reviewNode, data) {
  // Color Logic based on your request
  // <25 Spam (Red), <50 Likely Fake (Orange), >50 Genuine (Green), >90 High Trust (Blue/Dark Green)
  let color = "#c53030"; // Red
  let bg = "#fff5f5";
  let label = "Likely Fake";

  if (data.total < 25) { 
      label = "Spam / Suspicious"; 
      color = "#742a2a"; bg = "#ffe3e3"; // Dark Red
  } else if (data.total < 50) {
      label = "Low Confidence"; 
      color = "#dd6b20"; bg = "#fffaf0"; // Orange
  } else if (data.total >= 90) {
      label = "Highly Authentic"; 
      color = "#276749"; bg = "#f0fff4"; // Dark Green
  } else {
      label = "Feels Genuine"; 
      color = "#38a169"; bg = "#f0fff4"; // Green
  }

  const badge = document.createElement("div");
  badge.className = "arc-badge";
  badge.innerHTML = `
    <div style="
      background: ${bg}; color: ${color}; border: 1px solid ${color};
      font-weight: bold; font-size: 11px; padding: 3px 8px; 
      border-radius: 4px; display: inline-flex; align-items: center; gap: 6px;
      margin-bottom: 6px; font-family: sans-serif;
    ">
      <span>ARC: ${data.total}/100</span>
      <span style="opacity: 0.8; font-weight: normal;">| ${label}</span>
    </div>
  `;
  reviewNode.prepend(badge);
}

processReviews();
let timer;
window.addEventListener("scroll", () => {
  clearTimeout(timer);
  timer = setTimeout(processReviews, 500);
});
