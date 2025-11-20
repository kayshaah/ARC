// ==== ARC content_script.js (full) ==========================================
// - One reset per product (session-scoped) before scraping
// - Deduped review detection (top-most nodes only)
// - Trust badge + hover tooltip (reasons + excerpt)
// - Reviewer credibility pill + tooltip (profile + page signals)
// - Verified Purchase + image count extraction
// - Batched uploads to background -> FastAPI /ingest
// - Flush on pagehide/hidden
// - Scan animation when reviews come into view

// --- PING background (diagnostics) ------------------------------------------
try {
  chrome.runtime.sendMessage({ type: "ARC_PING" }, (resp) => {
    if (chrome.runtime.lastError) console.warn("[ARC/cs] PING failed:", chrome.runtime.lastError.message);
    else console.log("[ARC/cs] PING ok:", resp);
  });
} catch (e) {
  console.warn("[ARC/cs] PING exception:", e);
}

// --- singleton guard ---------------------------------------------------------
if (window.__ARC_CS_ACTIVE__) throw new Error("ARC content script already active");
window.__ARC_CS_ACTIVE__ = true;

// === One reset per product (session-scoped) =================================
function getPageASIN() {
  const m = location.pathname.match(/\/dp\/([A-Z0-9]{10})/);
  return m ? m[1] : new URLSearchParams(location.search).get("asin");
}
function currentProductKey() {
  return getPageASIN() || new URL(location.href).pathname;
}
function arcSend(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) =>
      resolve(resp || { ok: false })
    );
  });
}
async function ensureResetOnceForProduct() {
  const key = currentProductKey();
  const stampKey = "__ARC_RESET_DONE_FOR__";
  const already = sessionStorage.getItem(stampKey);
  if (already === key) {
    console.log("[ARC/cs] reset already done for", key);
    return;
  }
  console.log("[ARC/cs] sending reset for", key);
  await arcSend("ARC_RESET");
  sessionStorage.setItem(stampKey, key);
}

// === Batching to backend via background.js ==================================
const _arcBatch = [];
let _arcBatchTimer = null;
const _ARC_BATCH_SIZE = 5;
const _ARC_DEBOUNCE_MS = 250;

const _sentKeys = new Set(); // dedupe: review_key:stage

function enqueueForUpload(obj) {
  _arcBatch.push(obj);
  if (_arcBatch.length >= _ARC_BATCH_SIZE) flushUpload();
  else {
    clearTimeout(_arcBatchTimer);
    _arcBatchTimer = setTimeout(flushUpload, _ARC_DEBOUNCE_MS);
  }
}
function flushUpload() {
  if (!_arcBatch.length) return;
  const toSend = _arcBatch.splice(0, _arcBatch.length);
  chrome.runtime.sendMessage(
    { type: "ARC_UPLOAD_BATCH", payload: toSend },
    (resp) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[ARC/cs] upload sendMessage error:",
          chrome.runtime.lastError.message
        );
        return;
      }
      console.log("[ARC/cs] upload resp:", resp);
    }
  );
}
function safeEnqueue(key, stage, record) {
  const k = `${key}:${stage}`;
  if (_sentKeys.has(k)) return;
  _sentKeys.add(k);
  enqueueForUpload(record);
}
window.addEventListener("pagehide", flushUpload);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushUpload();
});

// === ARC scan animation styles ==============================================
(function injectArcScanStyles() {
  const id = "arc-scan-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .arc-scan-block {
      background-color: rgba(255, 223, 88, 0.0);
      border-radius: 4px;
      animation: arcScanBlock 0.45s ease-out forwards;
    }
    @keyframes arcScanBlock {
      0%   { background-color: rgba(255,223,88,0.0); }
      35%  { background-color: rgba(255,223,88,0.95); }
      100% { background-color: rgba(255,223,88,0.0); }
    }

    .arc-scan-word {
      background-color: transparent;
      transition: background-color 0.12s ease-out;
      border-radius: 3px;
    }
    .arc-scan-word.arc-scan-on {
      background-color: rgba(255,223,88,0.95);
    }
  `;
  document.head.appendChild(style);
})();

// === Tooltip portal (shared for ARC + Reviewer) =============================
let arcTooltip = null,
  openTooltip = null;
function getOrCreateTooltipPortal() {
  if (arcTooltip && document.body.contains(arcTooltip.host)) return arcTooltip;
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    pointerEvents: "none",
  });
  const sr = host.attachShadow({ mode: "open" });
  sr.innerHTML = `<style>
    .tt {
      position: fixed;
      min-width: 260px;
      max-width: 360px;
      background: #fff;
      border: 1px solid #eaeaea;
      border-radius: 10px;
      box-shadow: 0 12px 28px rgba(0,0,0,.18);
      font-family: system-ui,-apple-system,"Segoe UI",Roboto,Arial;
      font-size: 12px;
      color: #222;
      pointer-events: auto;
    }
    .hd {
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:8px 10px;
      border-bottom:1px solid #eee;
    }
    .ct {
      padding:10px;
    }
    .rsn { color:#444; }
    .rsn ul{ margin:6px 0 0 16px; padding:0; }
  </style>`;
  document.body.appendChild(host);
  arcTooltip = { host, sr };
  return arcTooltip;
}
function hideTooltip() {
  if (openTooltip) {
    openTooltip();
    openTooltip = null;
  }
}
function removeTooltipPortal() {
  if (arcTooltip?.host) {
    arcTooltip.host.remove();
    arcTooltip = null;
  }
}

// ---- ARC review tooltip -----------------------------------------------------
function buildArcTooltipHTML(data) {
  const { score, reasons, excerpt } = data;
  const good = score >= 60;
  const headerBg = good ? "#edf9f0" : "#fff0f0";
  const headerText = good ? "#0a5a2b" : "#7a0000";
  return `
    <div class="tt" role="tooltip">
      <div class="hd" style="background:${headerBg}; color:${headerText};">
        <div style="font-weight:700;">ARC score: ${score}%</div>
      </div>
      <div class="ct" style="max-height: 260px; overflow: auto;">
        <div class="rsn"><b>Reasons</b>
          <ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
        </div>
        ${
          excerpt
            ? `
        <div style="margin-top:8px;"><b>Excerpt</b>
          <div style="padding:8px;background:#f7f7f7;border-radius:8px;max-height:120px;overflow:auto;">
            ${escapeHtml(excerpt)}
          </div>
        </div>`
            : ``
        }
        <div style="margin-top:8px; font-size:11px; color:#666;">
          ARC demo — heuristics + context. (Model scoring can replace this.)
        </div>
      </div>
    </div>
  `;
}

function showTooltipNearElement(anchorEl, htmlBuilder, data) {
  const portal = getOrCreateTooltipPortal();
  if (openTooltip) {
    openTooltip();
    openTooltip = null;
  }

  const wrap = document.createElement("div");
  wrap.innerHTML = htmlBuilder(data);
  const tip = wrap.firstElementChild;
  portal.sr.appendChild(tip);

  const rect = anchorEl.getBoundingClientRect();
  const gap = 6;
  const desiredTop = rect.bottom + gap;
  const desiredLeft = Math.min(
    Math.max(rect.right - 300, 8),
    window.innerWidth - 12 - 260
  );
  tip.style.top = `${Math.min(
    desiredTop,
    window.innerHeight - tip.offsetHeight - 12
  )}px`;
  tip.style.left = `${desiredLeft}px`;

  let hoverCount = 0;
  let closeTimer = null;

  const scheduleClose = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (hoverCount <= 0) close();
    }, 250);
  };

  const enter = () => {
    hoverCount++;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };
  const leave = () => {
    hoverCount--;
    if (hoverCount <= 0) scheduleClose();
  };

  tip.addEventListener("mouseenter", enter);
  tip.addEventListener("mouseleave", leave);
  anchorEl.addEventListener("mouseenter", enter);
  anchorEl.addEventListener("mouseleave", leave);

  tip.addEventListener(
    "wheel",
    (e) => {
      e.stopPropagation();
    },
    { passive: true }
  );
  tip.addEventListener(
    "touchmove",
    (e) => {
      e.stopPropagation();
    },
    { passive: true }
  );

  const openScrollY = window.scrollY;
  const onScroll = () => {
    if (hoverCount <= 0 && Math.abs(window.scrollY - openScrollY) > 40) close();
  };
  const onResize = () => close();
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  window.removeEventListener("scroll", hideTooltip);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);

  function close() {
    tip.remove();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKey);
    openTooltip = null;
  }
  openTooltip = close;
}

function showArcTooltipNearBadge(badgeEl, data) {
  showTooltipNearElement(badgeEl, buildArcTooltipHTML, data);
}

// ---- Reviewer tooltip -------------------------------------------------------
function buildReviewerTooltipHTML(data) {
  const { score, name, signals } = data;
  const headerBg = "#eef3ff";
  const headerText = "#1b3a8a";
  return `
    <div class="tt" role="tooltip">
      <div class="hd" style="background:${headerBg}; color:${headerText};">
        <div style="font-weight:700;">Reviewer credibility: ${score}/100</div>
        <div style="font-size:11px; opacity:0.9;">${escapeHtml(name || "")}</div>
      </div>
      <div class="ct" style="max-height: 260px; overflow:auto;">
        <div class="rsn"><b>Signals about this reviewer</b>
          <ul>
            ${signals.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
          </ul>
        </div>
        <div style="margin-top:8px; font-size:11px; color:#666;">
          ARC uses only public, review-related signals for reviewer credibility.
          Future versions may incorporate this reviewer's broader Amazon activity where available.
        </div>
      </div>
    </div>
  `;
}
function showReviewerTooltipNear(pillEl, data) {
  showTooltipNearElement(pillEl, buildReviewerTooltipHTML, data);
}

// === Helpers =================================================================
function escapeHtml(s) {
  return s
    ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : "";
}
function pick(el, sel) {
  return el.querySelector(sel);
}
function clamp01to100(x) {
  return Math.max(0, Math.min(100, Math.round(x)));
}
function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function isVerifiedPurchase(reviewNode) {
  const badge = reviewNode.querySelector('[data-hook="avp-badge"]');
  if (badge && /verified\s*purchase/i.test(badge.textContent || "")) return true;
  for (const el of reviewNode.querySelectorAll("span,div")) {
    const t = (el.textContent || "").trim();
    if (t && /(^|\s)verified\s*purchase(\s|$)/i.test(t)) return true;
  }
  return false;
}
function reviewImageCount(node) {
  const imgs = node.querySelectorAll(
    '[data-hook="review-image-tile"] img, .review-image-tile img, [data-hook="review-image"] img, img.review-image-tile'
  );
  return imgs ? imgs.length : 0;
}
function expandTruncatedIfAny(node) {
  const btn = node.querySelector(
    'a[data-hook="review-body-read-more"], a.cr-expand-review, .a-expander-header a, .a-expander-prompt'
  );
  if (btn)
    btn.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );
}

// tiny heuristic score — replace with backend model when ready
function baseScore({ title, body, verified, imgCount }) {
  let score = 50;
  const txt = (title || "") + " " + (body || "");
  const len = txt.trim().length;
  if (verified) score += 20;
  if (imgCount > 0) score += Math.min(8, 3 + Math.max(0, imgCount - 1) * 2);
  if (len < 40) score -= 20;
  else if (len < 120) score -= 5;
  else score += 5;
  const lower = txt.toLowerCase();
  ["amazing product", "highly recommend", "best purchase", "works great"].forEach(
    (p) => {
      if (lower.includes(p)) score -= 5;
    }
  );
  return clamp01to100(score);
}

// === Reviewer profile scraping (client-side) ================================
const _reviewerProfileCache = new Map(); // key -> Promise<stats>

function reviewerKey(authorHref, authorName) {
  return (authorHref || "") + "::" + (authorName || "");
}

function defaultReviewerStats(extra) {
  return Object.assign(
    {
      totalReviews: 0,
      shareVerified: 0,
      shareWithImages: 0,
      avgLength: 0,
      ratingVar: 0,
    },
    extra || {}
  );
}

/**
 * Public entry: get profile stats for a reviewer (cached).
 * Returns a Promise<{ totalReviews, shareVerified, shareWithImages, avgLength, ratingVar, [error]? }>
 */
function getReviewerProfileStats(authorHref, authorName) {
  const key = reviewerKey(authorHref, authorName);
  if (_reviewerProfileCache.has(key)) {
    return _reviewerProfileCache.get(key);
  }
  const p = fetchReviewerProfileStats(authorHref, authorName);
  _reviewerProfileCache.set(key, p);
  return p;
}

// === REPLACE YOUR EXISTING fetchReviewerProfileStats FUNCTION WITH THIS ===

async function fetchReviewerProfileStats(authorHref, authorName) {
  // 1. Input Validation
  if (!authorHref) {
    return defaultReviewerStats();
  }
  
  // 2. Construct URL
  const profileUrl = new URL(authorHref, location.origin).toString();

  // 3. Create a hidden iframe to load the profile
  // We use an iframe so the browser executes Amazon's React/JS to render the reviews.
  const iframe = document.createElement('iframe');
  iframe.style.display = "none";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.src = profileUrl;
  
  document.body.appendChild(iframe);

  // 4. Wait for load (wrapped in a Promise)
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout")), 8000); // 8s timeout
      
      iframe.onload = () => {
        clearTimeout(timer);
        // Slight delay to allow React to finish hydration after 'load' fires
        setTimeout(resolve, 500); 
      };
      iframe.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Iframe error"));
      };
    });

    // 5. Access the rendered DOM inside the iframe
    const doc = iframe.contentDocument || iframe.contentWindow.document;

    // Check for Captcha/Anti-bot
    const bodyText = doc.body.textContent || "";
    if (
      bodyText.includes("Enter the characters you see below") ||
      bodyText.includes("Type the characters you see in this image")
    ) {
      console.warn("[ARC] Amazon blocked the profile scrape (CAPTCHA detected).");
      return defaultReviewerStats({ error: "CAPTCHA" });
    }

    // 6. Improved Selectors for Rendered Content
    // Note: 'glacier-profile' classes are common in the rendered view
    const cards = Array.from(
      doc.querySelectorAll(
        '.desktop-profile-content div[data-component-props], .a-section.review, div[id^="profile-at-card"], [data-hook="review"], .glacier-review-card'
      )
    ).slice(0, 20);

    if (!cards.length) {
      // Debugging: helpful to see why it failed in console
      console.log(`[ARC] No cards found for ${authorName}. Body length: ${bodyText.length}`);
      return defaultReviewerStats();
    }

    // 7. Extract Data (Logic remains mostly the same, just robustified)
    let total = 0;
    let verifiedCount = 0;
    let imgCount = 0;
    let lengths = [];
    let ratings = [];

    for (const card of cards) {
      total += 1;
      const text = card.textContent || "";
      
      // Check Verified
      if (/verified\s*purchase/i.test(text)) verifiedCount++;

      // Check Images
      const imgs = card.querySelectorAll('img, [data-hook="review-image-tile"] img');
      if (imgs.length > 0) imgCount++;

      // Check Rating
      let rating = NaN;
      const ratingEl = card.querySelector('[data-hook="review-star-rating"], .a-icon-alt');
      if (ratingEl) {
        const parts = (ratingEl.textContent || "").split(" ");
        rating = parseFloat(parts[0]);
      }
      if (!isNaN(rating)) ratings.push(rating);

      // Check Length
      const bodyEl = card.querySelector('[data-hook="review-body"], .review-text, .review-text-content') || card;
      // Remove "Read more" text if present
      const clone = bodyEl.cloneNode(true);
      const readMore = clone.querySelector('.a-expander-prompt'); 
      if(readMore) readMore.remove();
      
      const len = (clone.textContent || "").trim().length;
      lengths.push(len);
    }

    const shareVerified = total ? verifiedCount / total : 0;
    const shareWithImages = total ? imgCount / total : 0;
    const avgLength = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;

    let ratingVar = 0;
    if (ratings.length > 1) {
      const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      ratingVar = ratings.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / ratings.length;
    }

    return {
      totalReviews: total,
      shareVerified,
      shareWithImages,
      avgLength,
      ratingVar,
    };

  } catch (e) {
    console.warn("[ARC] Iframe scrape failed:", e);
    return defaultReviewerStats();
  } finally {
    // 8. CLEANUP: Important! Remove the iframe so we don't bloat the DOM
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }
}


function reviewerScoreFromSignalsAndProfile(localSignals, profileStats) {
  const { verified, imgCount, reviewLen, pageReviewCount } = localSignals;
  const {
    totalReviews,
    shareVerified,
    shareWithImages,
    avgLength, // currently unused but available
    ratingVar,
  } = profileStats;

  let s = 50;

  // Local (this product page)
  if (verified) s += 8;
  if (imgCount > 0) s += 3;
  if (reviewLen > 150) s += 4;
  if (pageReviewCount > 1) s += Math.min(6, (pageReviewCount - 1) * 2);

  // Profile-level
  if (totalReviews === 0) s -= 5;
  else if (totalReviews < 3) s += 5;
  else if (totalReviews < 10) s += 12;
  else s += 20;

  s += Math.round(20 * shareVerified); // 0–20 pts
  s += Math.round(10 * Math.min(shareWithImages, 0.7)); // cap at 70%

  if (ratingVar < 0.1 && totalReviews >= 3) s -= 5;
  else if (ratingVar > 0.4) s += 3;

  return clamp01to100(s);
}

// === Review discovery (top-most only) =======================================
function findReviewNodes() {
  const sels = [
    '[data-hook="review"]',
    '[data-hook="review-collapsed"]',
    '[data-hook="review-card"]',
    ".a-section.review",
    ".review",
    ".profile-at-review",
    ".profile-at-card",
    '.cr-widget-ReviewList [data-hook="review"]',
    '#cm_cr-review_list [data-hook="review"]',
    "#cm-cr-dp-review-list .review",
  ];
  const all = [];
  sels.forEach((s) => document.querySelectorAll(s).forEach((n) => all.push(n)));
  const uniq = [];
  all.forEach((n) => {
    if (!all.some((o) => o !== n && o.contains(n))) uniq.push(n);
  });
  return uniq;
}

// === Scan animation helpers =================================================
function scanBodyWordByWord(bodyEl, baseDelayMs, onDone) {
  if (!bodyEl) {
    if (onDone) onDone();
    return;
  }
  if (bodyEl.dataset.arcScanWords === "1") {
    const spans = bodyEl.querySelectorAll(".arc-scan-word");
    runWordHighlightSequence(spans, baseDelayMs, onDone);
    return;
  }

  const text = bodyEl.textContent || "";
  const words = text.split(/(\s+)/); // keep spaces
  bodyEl.dataset.arcScanWords = "1";

  const frag = document.createDocumentFragment();
  words.forEach((w) => {
    if (/\s+/.test(w)) {
      frag.appendChild(document.createTextNode(w));
    } else {
      const span = document.createElement("span");
      span.className = "arc-scan-word";
      span.textContent = w;
      frag.appendChild(span);
    }
  });

  bodyEl.textContent = "";
  bodyEl.appendChild(frag);

  const spans = bodyEl.querySelectorAll(".arc-scan-word");
  runWordHighlightSequence(spans, baseDelayMs, onDone);
}

function runWordHighlightSequence(spans, baseDelayMs, onDone) {
  const perWordDelay = 28;
  const flashDur = 90;

  spans.forEach((span, idx) => {
    const delay = baseDelayMs + idx * perWordDelay;
    setTimeout(() => {
      span.classList.add("arc-scan-on");
      setTimeout(() => span.classList.remove("arc-scan-on"), flashDur);
    }, delay);
  });

  const total = baseDelayMs + spans.length * perWordDelay + flashDur + 40;
  if (onDone) setTimeout(onDone, total);
}

// === Scan runner ============================================================
let arcScanHasRun = false;
function runScanAnimationOnce() {
  if (arcScanHasRun || window.__ARC_SCAN_COMPLETED__) return;

  const reviews = findReviewNodes();
  if (!reviews.length) {
    setTimeout(runScanAnimationOnce, 500);
    return;
  }

  arcScanHasRun = true;
  window.__ARC_SCAN_COMPLETED__ = true;

  const perReviewOffset = 160;
  reviews.forEach((node, idx) => {
    const bodyEl =
      pick(node, "[data-hook=\"review-body\"]") ||
      pick(node, ".review-text-content");
    const starsEl =
      pick(node, "[data-hook=\"review-star-rating\"]") ||
      pick(node, ".a-icon-star");
    const nameEl = pick(node, ".a-profile-name");
    const reviewStart = idx * perReviewOffset;

    const blocks = [nameEl, starsEl];
    blocks.forEach((el, i) => {
      if (!el) return;
      const delay = reviewStart + i * 60;
      setTimeout(() => {
        el.classList.add("arc-scan-block");
        setTimeout(() => el.classList.remove("arc-scan-block"), 500);
      }, delay);
    });

    scanBodyWordByWord(bodyEl, reviewStart + 140, () => {
      const badge = node.__arcBadgeEl;
      if (badge && !badge.classList.contains("arc-visible")) {
        badge.classList.add("arc-visible");
      }
    });
  });
}

// === Core lifecycle ==========================================================
(function () {
  let arcEnabled = true;
  let observer = null;

  chrome.runtime?.onMessage?.addListener?.((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ARC_TOGGLE") {
      arcEnabled = !!msg.enabled;
      arcEnabled ? boot() : teardown();
      sendResponse({ ok: true, enabled: arcEnabled });
    } else if (msg.type === "ARC_GET_STATUS") {
      sendResponse({ enabled: !!arcEnabled });
    }
    return true;
  });
  chrome.storage?.local?.get?.({ arcEnabled: true }, (res) => {
    arcEnabled = !!res.arcEnabled;
    if (arcEnabled) boot();
  });

  async function boot() {
    await ensureResetOnceForProduct();
    addEnabledDot();
    attachBadges();
    observeForNewReviews();
    setupReviewScanTrigger();
  }
  function teardown() {
    removeEnabledDot();
    document.querySelectorAll(".arc-badge-host").forEach((n) => n.remove());
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    hideTooltip();
    removeTooltipPortal();
    flushUpload();
  }

  // enabled indicator
  function addEnabledDot() {
    if (document.getElementById("arc-enabled-dot")) return;
    const dot = document.createElement("div");
    dot.id = "arc-enabled-dot";
    Object.assign(dot.style, {
      position: "fixed",
      left: "8px",
      top: "8px",
      width: "10px",
      height: "10px",
      borderRadius: "50%",
      background: "#22c55e",
      boxShadow: "0 0 0 2px rgba(34,197,94,.25)",
      zIndex: "2147483646",
      opacity: "0.85",
      pointerEvents: "none",
    });
    dot.title = "ARC enabled";
    document.body.appendChild(dot);
  }
  function removeEnabledDot() {
    document.getElementById("arc-enabled-dot")?.remove();
  }

  function attachBadges() {
    if (!arcEnabled) return;
    const reviews = findReviewNodes();

    // precompute counts per reviewer on THIS page
    const reviewerCounts = new Map();
    reviews.forEach((node) => {
      const nameEl = pick(node, ".a-profile-name");
      const name = ((nameEl && nameEl.textContent) || "").trim();
      const profileHref = pick(node, ".a-profile")?.getAttribute("href") || "";
      const key = reviewerKey(profileHref, name);
      if (!key.trim()) return;
      reviewerCounts.set(key, (reviewerCounts.get(key) || 0) + 1);
    });

    reviews.forEach((node) => {
      if (node.dataset.arcBadged === "1") return;
      node.dataset.arcBadged = "1";
      if (node.querySelector(".arc-badge-host")) return;

      expandTruncatedIfAny(node);

      const title =
        pick(node, '[data-hook="review-title"]')?.innerText?.trim() ||
        pick(node, ".review-title")?.innerText?.trim() ||
        "";
      const body =
        pick(node, '[data-hook="review-body"]')?.innerText?.trim() ||
        pick(node, ".review-text-content")?.innerText?.trim() ||
        "";
      const ratingText =
        pick(node, '[data-hook="review-star-rating"]')?.innerText ||
        pick(node, ".a-icon-alt")?.innerText ||
        "";
      const rating = ratingText ? parseFloat(ratingText.split(" ")[0]) : null;
      const verified = isVerifiedPurchase(node);
      const imgCount = reviewImageCount(node);
      const authorEl = pick(node, ".a-profile-name");
      const author = authorEl?.innerText?.trim() || "Unknown";
      const profileLink = pick(node, ".a-profile");
      const authorHref = profileLink?.getAttribute("href") || null;

      const asin = getPageASIN();
      const review_key = hashKey(
        [author, title, body, asin || location.href].join("|")
      );

      const score = baseScore({ title, body, verified, imgCount });

      // Badge host
      const host = document.createElement("div");
      host.className = "arc-badge-host";
      host.style.position = "relative";
      node.prepend(host);
      const sr = host.attachShadow({ mode: "open" });
      sr.innerHTML = `<style>
         .badge{
            position:absolute; top:6px; right:6px; padding:6px 8px; border-radius:8px;
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial;
            font-weight:700; font-size:12px; cursor:pointer; user-select:none;
            box-shadow:0 4px 14px rgba(0,0,0,.12);
            transform: translateY(0);
            opacity: 0;
            transition: opacity .25s ease, transform .12s ease;
         }
         .badge.arc-visible{
            opacity: 1;
         }
         .badge:hover{ transform: translateY(-1px); }
      </style>
      <div class="badge">${score}%</div>`;

      const badge = sr.querySelector(".badge");
      const good = score >= 60;
      badge.style.background = good ? "#eef9f1" : "#fff1f1";
      badge.style.color = good ? "#0a5a2b" : "#7a0000";

      node.__arcBadgeEl = badge;

      if (arcScanHasRun || window.__ARC_SCAN_COMPLETED__) {
        badge.classList.add("arc-visible");
      }

      // Tooltip data for ARC
      const reasons = [
        verified ? "Verified purchase" : "Unverified",
        (title + body).length < 40
          ? "Very short"
          : (title + body).length < 120
          ? "Short"
          : "Detailed",
        ...(imgCount > 0
          ? [`${imgCount} image${imgCount > 1 ? "s" : ""} attached`]
          : []),
      ];
      const excerpt = ((title ? title + " — " : "") + body).slice(0, 800);
      const tipData = { score, reasons, excerpt };

      badge.addEventListener("mouseenter", () =>
        showArcTooltipNearBadge(badge, tipData)
      );
      badge.addEventListener("focus", () =>
        showArcTooltipNearBadge(badge, tipData)
      );

      // Reviewer pill decoration (lazy profile scraping)
      decorateReviewerPill({
        node,
        author,
        authorHref,
        verified,
        imgCount,
        reviewLen: body.length,
        reviewerCounts,
      });

      // Upload
      const baseRecord = {
        scrape_ts: new Date().toISOString(),
        page_url: location.href,
        product_asin: asin,
        review_key,
        review_title: title || null,
        review_body: body || null,
        review_rating: rating,
        verified_purchase: !!verified,
        images_count: imgCount,
        reviewer_name: author || null,
        reviewer_profile_url: authorHref || null,
        arc_score: score,
      };
      safeEnqueue(review_key, "base", baseRecord);
    });
  }

  function decorateReviewerPill(opts) {
    const {
      node,
      author,
      authorHref,
      verified,
      imgCount,
      reviewLen,
      reviewerCounts,
    } = opts;
    const nameEl = pick(node, ".a-profile-name");
    if (!nameEl || nameEl.dataset.arcReviewerDecorated === "1") return;
    nameEl.dataset.arcReviewerDecorated = "1";

    const profileLink = nameEl.closest("a") || nameEl;
    const key = reviewerKey(authorHref, author);
    const pageReviewCount = reviewerCounts.get(key) || 1;

    const host = document.createElement("span");
    host.className = "arc-reviewer-host";
    host.style.display = "inline-flex";
    host.style.alignItems = "center";
    host.style.gap = "6px";

    profileLink.parentNode.insertBefore(host, profileLink);
    host.appendChild(profileLink);

    const pill = document.createElement("span");
    pill.className = "arc-reviewer-pill";
    pill.textContent = "Reviewer";
    Object.assign(pill.style, {
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 8px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: "600",
      fontFamily: 'system-ui,-apple-system,"Segoe UI",Roboto,Arial',
      background: "#eef3ff",
      color: "#1b3a8a",
      border: "1px solid rgba(59,130,246,0.3)",
      cursor: "pointer",
      userSelect: "none",
    });

    host.insertBefore(pill, profileLink);

    // Lazy profile scrape: only when user hovers / focuses the pill
    let hasFetched = false;
    let reviewerTipData = null;

    const localSignals = { verified, imgCount, reviewLen, pageReviewCount };

    async function loadDataAndShow() {
      try {
        if (!hasFetched) {
          hasFetched = true;
          pill.textContent = "Loading…";

          // Slight jitter to look human-ish if user scrubs over many pills
          await new Promise((r) =>
            setTimeout(r, 200 + Math.random() * 500)
          );

          const profileStats = await getReviewerProfileStats(
            authorHref,
            author
          );
          const rScore = reviewerScoreFromSignalsAndProfile(
            localSignals,
            profileStats
          );
          pill.textContent = `Reviewer ${rScore}`;

          const signals = [];

          if (profileStats.error === "CAPTCHA") {
            signals.push(
              "Amazon asked for additional verification, so ARC could not analyze this reviewer's full profile."
            );
          } else if (profileStats.totalReviews > 0) {
            signals.push(
              `Analyzed ${profileStats.totalReviews} recent review${
                profileStats.totalReviews > 1 ? "s" : ""
              } from this profile (sampled).`
            );
            signals.push(
              `${Math.round(
                profileStats.shareVerified * 100
              )}% of sampled reviews are Verified Purchases.`
            );
            signals.push(
              `${Math.round(
                profileStats.shareWithImages * 100
              )}% of sampled reviews include images.`
            );
          } else {
            signals.push(
              "Could not retrieve review details from this reviewer's public profile (or it has limited data)."
            );
          }

          if (pageReviewCount > 1) {
            signals.push(
              `This reviewer has ${pageReviewCount} review${
                pageReviewCount > 1 ? "s" : ""
              } visible on this product's page.`
            );
          } else {
            signals.push(
              "Only this review from this reviewer is visible on this product's page."
            );
          }

          reviewerTipData = {
            score: rScore,
            name: author,
            signals,
          };
        }

        if (reviewerTipData) {
          showReviewerTooltipNear(pill, reviewerTipData);
        }
      } catch (e) {
        console.warn("[ARC] profile stats error:", e);
        pill.textContent = "Reviewer ?";
      }
    }

    pill.addEventListener("mouseenter", loadDataAndShow);
    pill.addEventListener("focus", loadDataAndShow);
  }

  function setupReviewScanTrigger() {
    if (window.__ARC_SCAN_OBS_SETUP__ || window.__ARC_SCAN_COMPLETED__) return;
    window.__ARC_SCAN_OBS_SETUP__ = true;

    const container =
      document.querySelector("#cm-cr-dp-review-list") ||
      document.querySelector("#reviewsMedley") ||
      document.querySelector("#cm_cr-review_list") ||
      document.querySelector("#reviews-container");

    if (!container) {
      setTimeout(() => {
        window.__ARC_SCAN_OBS_SETUP__ = false;
        setupReviewScanTrigger();
      }, 800);
      return;
    }

    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.2) {
            runScanAnimationOnce();
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: [0.2] }
    );

    io.observe(container);
  }

  function observeForNewReviews() {
    const container =
      document.querySelector(
        "#reviewsMedley, #cm_cr-review_list, #cm-cr-dp-review-list, #reviews-container"
      ) || document.body;
    observer = new MutationObserver(() => setTimeout(attachBadges, 100));
    observer.observe(container, { childList: true, subtree: true });
    let scrollT;
    window.addEventListener(
      "scroll",
      () => {
        clearTimeout(scrollT);
        scrollT = setTimeout(attachBadges, 120);
      },
      { passive: true }
    );
  }
})();
