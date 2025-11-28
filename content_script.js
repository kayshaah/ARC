// content_script.js

// --- HELPER FUNCTIONS ---
function pick(el, sel) { return el.querySelector(sel); }

function isVerified(node) {
  const text = node.innerText || "";
  return text.toLowerCase().includes("verified purchase");
}

function getImageCount(node) {
  const imgs = node.querySelectorAll('.review-image-tile, .review-image-section img');
  return imgs.length;
}

function getAuthorName(node) {
  const el = pick(node, '.a-profile-name');
  return el ? el.innerText.trim() : "Unknown";
}

// --- API COMMUNICATION ---
async function getScoresFromBackend(reviews) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "ARC_GET_SCORES", payload: { reviews } }, resp => {
      if (resp && resp.ok && resp.body) resolve(resp.body.scores);
      else resolve(null);
    });
  });
}

// --- MAIN PROCESS ---
async function processReviews() {
  // Select all possible review containers on Amazon
  const selectors = ['[data-hook="review"]', '.review', '[data-hook="review-card"]'];
  const allReviews = [];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => allReviews.push(el));
  });

  // Filter out reviews that already have the Trust Button
  const unbadged = allReviews.filter(el => !el.querySelector('.arc-trust-btn'));
  if (unbadged.length === 0) return;

  // Mark as processing visually (invisible marker)
  unbadged.forEach(el => {
      const ghost = document.createElement('div');
      ghost.className = 'arc-processed-mark';
      el.prepend(ghost);
  });

  // 1. EXTRACT DATA
  const payload = unbadged.map(el => ({
    review_title: pick(el, '[data-hook="review-title"]')?.innerText || "",
    review_body: pick(el, '[data-hook="review-body"]')?.innerText || "",
    verified_purchase: isVerified(el),
    image_count: getImageCount(el),
    author_name: getAuthorName(el)
  }));

  // 2. GET SCORES
  const scores = await getScoresFromBackend(payload);

  // 3. RENDER UI
  unbadged.forEach((el, index) => {
    // Safety check: Don't add if already added
    if (el.querySelector('.arc-trust-btn')) return;

    // Default object if API fails or returns null
    const data = scores ? scores[index] : { total: 50, label: "Analyzing...", reasons: [], history: "Unknown" }; 
    injectTrustUI(el, data);
  });
}

function injectTrustUI(reviewNode, data) {
  // 1. Define Colors based on Score
  let color = "#ef4444"; // Red
  let bg = "#fee2e2";
  let ring = "#f87171";
  
  // High Trust (90+)
  if (data.total >= 90) { 
      color = "#059669"; bg = "#d1fae5"; ring = "#34d399"; // Green
  } 
  // Medium Trust (60-89)
  else if (data.total >= 60) { 
      color = "#0891b2"; bg = "#cffafe"; ring = "#22d3ee"; // Cyan
  } 
  // Low Confidence (40-59)
  else if (data.total >= 40) { 
      color = "#d97706"; bg = "#fef3c7"; ring = "#fbbf24"; // Orange
  }

  // 2. Create the "Trust Button" (The Pill)
  const btn = document.createElement("div");
  btn.className = "arc-trust-btn";
  btn.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px;
    background: ${bg}; color: ${color}; 
    padding: 4px 10px; border-radius: 20px;
    font-family: 'Segoe UI', sans-serif; font-weight: 700; font-size: 11px;
    cursor: pointer; margin-bottom: 8px;
    border: 1px solid ${ring}; transition: all 0.2s ease;
    position: relative; z-index: 10;
  `;
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
    </svg>
    <span>${data.total}% Trust</span>
  `;

  // 3. Create the "Overlay" (Hidden by default)
  const overlay = document.createElement("div");
  overlay.className = "arc-overlay";
  
  // Construct Reasons List HTML
  const reasonsHtml = data.reasons && data.reasons.length > 0 
    ? data.reasons.map(r => `<div style="display:flex; gap:6px; margin-top:4px; font-size:11px; color:#4b5563;"><span>${r.icon}</span><span>${r.text}</span></div>`).join('')
    : `<div style="font-size:11px; color:#9ca3af; font-style:italic;">No specific flags detected.</div>`;

  overlay.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #e5e7eb;">
        <span style="font-weight:800; font-size:14px; color:#111827;">${data.label}</span>
        <span style="background:${color}; color:white; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold;">${data.total}/100</span>
    </div>
    
    <div style="margin-bottom:10px;">
        <div style="font-size:10px; text-transform:uppercase; color:#9ca3af; font-weight:700; letter-spacing:0.5px; margin-bottom:2px;">Analysis</div>
        ${reasonsHtml}
    </div>

    <div style="background:#f9fafb; padding:8px; border-radius:6px; border:1px solid #f3f4f6;">
        <div style="font-size:10px; text-transform:uppercase; color:#9ca3af; font-weight:700; letter-spacing:0.5px; margin-bottom:2px;">Reviewer History</div>
        <div style="display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600; color:#374151;">
            <span>👤</span> <span>${data.history || "Consistent Reviewer"}</span>
        </div>
    </div>
    
    <div style="position:absolute; bottom:-6px; left:20px; width:12px; height:12px; background:white; transform:rotate(45deg); border-bottom:1px solid rgba(0,0,0,0.1); border-right:1px solid rgba(0,0,0,0.1);"></div>
  `;

  // Overlay Styles (Glassmorphism / Shadow)
  overlay.style.cssText = `
    position: absolute; bottom: 130%; left: 0; 
    width: 220px; background: white; 
    border-radius: 12px; padding: 12px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(0,0,0,0.08);
    opacity: 0; visibility: hidden; transform: translateY(10px);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none; z-index: 100;
  `;

  // 4. Hover Logic (Show/Hide Overlay)
  btn.appendChild(overlay);
  
  btn.addEventListener('mouseenter', () => {
    overlay.style.opacity = '1';
    overlay.style.visibility = 'visible';
    overlay.style.transform = 'translateY(0)';
  });
  
  btn.addEventListener('mouseleave', () => {
    overlay.style.opacity = '0';
    overlay.style.visibility = 'hidden';
    overlay.style.transform = 'translateY(10px)';
  });

  // Insert Button into the DOM
  reviewNode.prepend(btn);
}

// 5. DEMO TRIGGER: Alt + Double Click to spawn a fake review
if (!window.__ARC_DEMO_LISTENER) {
    window.__ARC_DEMO_LISTENER = true;
    document.addEventListener("dblclick", (e) => {
        // Must hold ALT key to trigger
        if (!e.altKey) return; 

        const fake = document.createElement("div");
        fake.className = "a-section review aok-relative";
        fake.setAttribute("data-hook", "review");
        
        // This HTML mimics Amazon's review structure
        fake.innerHTML = `
            <div class="a-row"><span class="a-profile-name">Amazon Customer</span></div>
            <div class="a-row"><i class="a-icon a-icon-star a-star-5"><span class="a-icon-alt">5.0 out of 5 stars</span></i></div>
            <div class="a-row"><span data-hook="review-body" class="review-text"><span>Good product. I like it. Fast shipping.</span></span></div>
            <div class="a-row"><span class="a-size-mini a-color-state a-text-bold">Verified Purchase</span></div>
        `;
        
        // Find the review list container
        const list = document.querySelector('#cm_cr-review_list, #reviewsMedley');
        if (list) { 
            list.prepend(fake); 
            // Trigger ARC to scan the new element
            processReviews(); 
        } else {
            alert("Could not find review list to inject fake review!");
        }
    });
}

// Start processing immediately
processReviews();

// Watch for scroll events (Infinite Scroll support)
let timer;
window.addEventListener("scroll", () => {
  clearTimeout(timer);
  timer = setTimeout(processReviews, 500);
});
