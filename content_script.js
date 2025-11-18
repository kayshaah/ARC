// ==== ARC content_script.js (full) ==========================================
// - One reset per product (session-scoped) before scraping
// - Deduped review detection (top-most nodes only)
// - Trust badge + hover tooltip (reasons + excerpt)
// - Verified Purchase + image count extraction
// - Batched uploads to background -> FastAPI /ingest
// - Flush on pagehide/hidden
// - No backend scoring here (can be added later via ARC_SCORE_BATCH)

// --- PING background (diagnostics) ------------------------------------------
try {
  chrome.runtime.sendMessage({ type: "ARC_PING" }, (resp) => {
    if (chrome.runtime.lastError) console.warn("[ARC/cs] PING failed:", chrome.runtime.lastError.message);
    else console.log("[ARC/cs] PING ok:", resp);
  });
} catch (e) { console.warn("[ARC/cs] PING exception:", e); }

// --- singleton guard ---------------------------------------------------------
if (window.__ARC_CS_ACTIVE__) throw new Error("ARC content script already active");
window.__ARC_CS_ACTIVE__ = true;

// === One reset per product (session-scoped) =================================
function getPageASIN() {
  const m = location.pathname.match(/\/dp\/([A-Z0-9]{10})/);
  return m ? m[1] : new URLSearchParams(location.search).get("asin");
}
function currentProductKey() {
  // Stable key per product in THIS tab
  return getPageASIN() || new URL(location.href).pathname;
}
function arcSend(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => resolve(resp || { ok: false }));
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
  await arcSend("ARC_RESET");           // POST /reset (global truncate)
  sessionStorage.setItem(stampKey, key);
}

// === Batching to backend via background.js ==================================
const _arcBatch = [];
let _arcBatchTimer = null;
// choose 1 for immediate dev testing, or 10/400 for quieter prod-ish behavior
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
  chrome.runtime.sendMessage({ type: "ARC_UPLOAD_BATCH", payload: toSend }, (resp) => {
    if (chrome.runtime.lastError) {
      console.warn("[ARC/cs] upload sendMessage error:", chrome.runtime.lastError.message);
      return;
    }
    console.log("[ARC/cs] upload resp:", resp);
  });
}
function safeEnqueue(key, stage, record){
  const k = `${key}:${stage}`;
  if (_sentKeys.has(k)) return;
  _sentKeys.add(k);
  enqueueForUpload(record);
}
window.addEventListener('pagehide', flushUpload);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushUpload();
});

// === ARC "scan" animation styles ============================================
(function injectArcScanStyles(){
  const id = "arc-scan-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @keyframes arcScanHighlightText {
      0%   { background-color: rgba(129, 230, 217, 0);   }
      25%  { background-color: rgba(129, 230, 217, 0.8); }
      100% { background-color: rgba(129, 230, 217, 0);   }
    }
    @keyframes arcScanHighlightStars {
      0%   { background-color: rgba(252, 211, 77, 0);   }
      25%  { background-color: rgba(252, 211, 77, 0.9); }
      100% { background-color: rgba(252, 211, 77, 0);   }
    }
    @keyframes arcScanHighlightName {
      0%   { background-color: rgba(196, 181, 253, 0);   }
      25%  { background-color: rgba(196, 181, 253, 0.9); }
      100% { background-color: rgba(196, 181, 253, 0);   }
    }

    .arc-scan-text {
      animation: arcScanHighlightText 0.6s ease-out forwards;
      border-radius: 4px;
      pointer-events: auto;
    }
    .arc-scan-stars {
      animation: arcScanHighlightStars 0.6s ease-out forwards;
      border-radius: 4px;
    }
    .arc-scan-name {
      animation: arcScanHighlightName 0.6s ease-out forwards;
      border-radius: 4px;
    }
  `;
  document.head.appendChild(style);
})();


// === Tooltip portal (page-level shadow root; no clipping) ===================
let arcTooltip = null, openTooltip = null;
function getOrCreateTooltipPortal(){
  if (arcTooltip && document.body.contains(arcTooltip.host)) return arcTooltip;
  const host = document.createElement('div');
  Object.assign(host.style,{ position:'fixed', inset:'0', zIndex:'2147483646', pointerEvents:'none' });
  const sr = host.attachShadow({ mode:'open' });
  sr.innerHTML = `<style>
    .tt{position:fixed;min-width:260px;max-width:340px;background:#fff;border:1px solid #eaeaea;border-radius:10px;
        box-shadow:0 12px 28px rgba(0,0,0,.18);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial;
        font-size:12px;color:#222;pointer-events:auto}
    .hd{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #eee}
    .ct{padding:10px}.rsn{color:#444}.rsn ul{margin:6px 0 0 16px;padding:0}
  </style>`;
  document.body.appendChild(host);
  arcTooltip = { host, sr };
  return arcTooltip;
}
function hideTooltip(){ if (openTooltip) { openTooltip(); openTooltip = null; } }
function removeTooltipPortal(){ if (arcTooltip?.host) { arcTooltip.host.remove(); arcTooltip = null; } }

function buildTooltipHTML(data){
  const { score, reasons, excerpt } = data;
  const good = score >= 60;
  const headerBg = good ? '#edf9f0' : '#fff0f0';
  const headerText = good ? '#0a5a2b' : '#7a0000';
  return `
    <div class="tt" role="tooltip">
      <div class="hd" style="background:${headerBg}; color:${headerText};">
        <div style="font-weight:700;">ARC score: ${score}%</div>
      </div>
      <div class="ct" style="max-height: 260px; overflow: auto;">
        <div class="rsn"><b>Reasons</b>
          <ul>${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        </div>
        ${excerpt ? `
        <div style="margin-top:8px;"><b>Excerpt</b>
          <div style="padding:8px;background:#f7f7f7;border-radius:8px;max-height:120px;overflow:auto;">
            ${escapeHtml(excerpt)}
          </div>
        </div>` : ``}
        <div style="margin-top:8px; font-size:11px; color:#666;">
          ARC demo — heuristics + context. (Model scoring can replace this.)
        </div>
      </div>
    </div>
  `;
}
function showTooltipNearBadge(badgeEl, data){
  const portal = getOrCreateTooltipPortal();
  if (openTooltip) { openTooltip(); openTooltip = null; }
  const wrap = document.createElement('div');
  wrap.innerHTML = buildTooltipHTML(data);
  const tip = wrap.firstElementChild;
  portal.sr.appendChild(tip);

  // position...
  const rect = badgeEl.getBoundingClientRect(), gap = 6;
  const desiredTop = rect.bottom + gap;
  const desiredLeft = Math.min(Math.max(rect.right - 300, 8), window.innerWidth - 12 - 260);
  tip.style.top = `${Math.min(desiredTop, window.innerHeight - tip.offsetHeight - 12)}px`;
  tip.style.left = `${desiredLeft}px`;

  let hoverCount = 0;
  let closeTimer = null;

  const scheduleClose = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (hoverCount <= 0) close();
    }, 250);  // a bit more generous
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
  tip.addEventListener('mouseenter', enter);
  tip.addEventListener('mouseleave', leave);
  badgeEl.addEventListener('mouseenter', enter);
  badgeEl.addEventListener('mouseleave', leave);

  tip.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
  tip.addEventListener('touchmove', (e) => { e.stopPropagation(); }, { passive: true });

  const openScrollY = window.scrollY;

  const onScroll = () => {
    // Only close if user isn't hovering AND page moved a bit
    if (hoverCount <= 0 && Math.abs(window.scrollY - openScrollY) > 40) {
      close();
    }
  };
  const onResize = () => close();
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  window.removeEventListener('scroll', hideTooltip);   // remove the global “close on any scroll”
  window.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);

  function close(){
    tip.remove();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKey);
    openTooltip = null;
    // Re-arm the global handler for next time if you want:
    // window.addEventListener('scroll', hideTooltip, { passive:true });
  }
  openTooltip = close;
}

// === Helpers =================================================================
function escapeHtml(s){ return s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : ""; }
function pick(el, sel){ return el.querySelector(sel); }
function clamp01to100(x){ return Math.max(0, Math.min(100, Math.round(x))); }
function hashKey(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(16); }

function isVerifiedPurchase(reviewNode){
  const badge = reviewNode.querySelector('[data-hook="avp-badge"]');
  if (badge && /verified\s*purchase/i.test(badge.textContent || '')) return true;
  for (const el of reviewNode.querySelectorAll('span,div')) {
    const t = (el.textContent || '').trim();
    if (t && /(^|\s)verified\s*purchase(\s|$)/i.test(t)) return true;
  }
  return false;
}
function reviewImageCount(node) {
  const imgs = node.querySelectorAll('[data-hook="review-image-tile"] img, .review-image-tile img, [data-hook="review-image"] img, img.review-image-tile');
  return imgs ? imgs.length : 0;
}
function expandTruncatedIfAny(node){
  const btn = node.querySelector('a[data-hook="review-body-read-more"], a.cr-expand-review, .a-expander-header a, .a-expander-prompt');
  if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window }));
}

// tiny heuristic score — replace with backend model when ready
function baseScore({title, body, verified, imgCount}){
  let score = 50;
  const txt = (title||"") + " " + (body||"");
  const len = txt.trim().length;
  if (verified) score += 20;
  if (imgCount > 0) score += Math.min(8, 3 + Math.max(0, imgCount-1)*2);
  if (len < 40) score -= 20; else if (len < 120) score -= 5; else score += 5;
  const lower = txt.toLowerCase();
  ["amazing product","highly recommend","best purchase","works great"].forEach(p => { if (lower.includes(p)) score -= 5; });
  return clamp01to100(score);
}

// === Review discovery (top-most only) =======================================
function findReviewNodes(){
  const sels = [
    '[data-hook="review"]','[data-hook="review-collapsed"]','[data-hook="review-card"]',
    '.a-section.review','.review','.profile-at-review','.profile-at-card',
    '.cr-widget-ReviewList [data-hook="review"]','#cm_cr-review_list [data-hook="review"]',
    '#cm-cr-dp-review-list .review'
  ];
  const all=[]; sels.forEach(s => document.querySelectorAll(s).forEach(n => all.push(n)));
  const uniq=[]; all.forEach(n => { if (!all.some(o => o !== n && o.contains(n))) uniq.push(n); });
  return uniq;
}

// Scanner Function
let arcScanHasRun = false;

function runScanAnimationOnce() {
  if (arcScanHasRun) return;
  arcScanHasRun = true;

  const reviews = findReviewNodes();
  if (!reviews.length) return;

  const perReviewDelay = 140; // ms between reviews
  const perFieldDelay  = 40;  // stagger title/body/stars/name inside each review

  reviews.forEach((node, idx) => {
    const titleEl = pick(node,'[data-hook="review-title"]') || pick(node,'.review-title');
    const bodyEl  = pick(node,'[data-hook="review-body"]')  || pick(node,'.review-text-content');
    const starsEl = pick(node,'[data-hook="review-star-rating"]') || pick(node,'.a-icon-star');
    const nameEl  = pick(node,'.a-profile-name');

    const start = idx * perReviewDelay;

    const targets = [
      { el: starsEl, cls: "arc-scan-stars",  extra: 0 },
      { el: nameEl,  cls: "arc-scan-name",   extra: perFieldDelay },
      { el: titleEl, cls: "arc-scan-text",   extra: perFieldDelay * 2 },
      { el: bodyEl,  cls: "arc-scan-text",   extra: perFieldDelay * 3 },
    ];

    targets.forEach(({ el, cls, extra }) => {
      if (!el) return;
      const delay = start + extra;
      setTimeout(() => {
        el.classList.add(cls);
        // remove class after animation so DOM is clean
        setTimeout(() => el.classList.remove(cls), 700);
      }, delay);
    });
  });
}


// === Core lifecycle ==========================================================
(function(){
  let arcEnabled = true;
  let observer = null;

  // popup toggle sync
  chrome.runtime?.onMessage?.addListener?.((msg,_sender,sendResponse)=>{
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ARC_TOGGLE') {
      arcEnabled = !!msg.enabled;
      arcEnabled ? boot() : teardown();
      sendResponse({ ok:true, enabled:arcEnabled });
    } else if (msg.type === 'ARC_GET_STATUS') {
      sendResponse({ enabled: !!arcEnabled });
    }
    return true;
  });
  chrome.storage?.local?.get?.({ arcEnabled:true }, (res) => {
    arcEnabled = !!res.arcEnabled;
    if (arcEnabled) boot();
  });

  async function boot(){
    await ensureResetOnceForProduct();  // <- single reset, then scrape
    addEnabledDot();
    attachBadges();
    setTimeout(runScanAnimationOnce, 1600);
    observeForNewReviews();
  }
  function teardown(){
    removeEnabledDot();
    document.querySelectorAll('.arc-badge-host').forEach(n => n.remove());
    if (observer) { observer.disconnect(); observer = null; }
    hideTooltip();
    removeTooltipPortal();
    flushUpload();
  }

  // enabled indicator
  function addEnabledDot(){
    if (document.getElementById('arc-enabled-dot')) return;
    const dot = document.createElement('div');
    dot.id = 'arc-enabled-dot';
    Object.assign(dot.style, {
      position:'fixed', left:'8px', top:'8px', width:'10px', height:'10px',
      borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 0 2px rgba(34,197,94,.25)',
      zIndex:'2147483646', opacity:'0.85', pointerEvents:'none'
    });
    dot.title = 'ARC enabled';
    document.body.appendChild(dot);
  }
  function removeEnabledDot(){ document.getElementById('arc-enabled-dot')?.remove(); }

  function attachBadges(){
    if (!arcEnabled) return;
    const reviews = findReviewNodes();
    reviews.forEach(node => {
      if (node.dataset.arcBadged === "1") return; // prevent duplicates
      node.dataset.arcBadged = "1";
      if (node.querySelector('.arc-badge-host')) return;

      expandTruncatedIfAny(node);

      // extract review bits
      const title = pick(node,'[data-hook="review-title"]')?.innerText?.trim()
                 || pick(node,'.review-title')?.innerText?.trim() || "";
      const body  = pick(node,'[data-hook="review-body"]')?.innerText?.trim()
                 || pick(node,'.review-text-content')?.innerText?.trim() || "";
      const ratingText = pick(node,'[data-hook="review-star-rating"]')?.innerText
                       || pick(node,'.a-icon-alt')?.innerText || "";
      const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : null;
      const verified = isVerifiedPurchase(node);
      const imgCount = reviewImageCount(node);
      const author   = pick(node,'.a-profile-name')?.innerText?.trim() || "Unknown";
      const authorHref = pick(node,'.a-profile')?.getAttribute('href') || null;

      // product ASIN + stable key
      const asin = getPageASIN();
      const review_key = hashKey([author, title, body, asin || location.href].join("|"));

      // compute score (placeholder heuristic; swap to backend when ready)
      const score = baseScore({ title, body, verified, imgCount });

      // create badge
      const host = document.createElement('div');
      host.className = 'arc-badge-host';
      host.style.position = 'relative';
      node.prepend(host);
      const sr = host.attachShadow({ mode:'open' });
      sr.innerHTML = `<style>
         .badge{position:absolute; top:6px; right:6px; padding:6px 8px; border-radius:8px;
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial;
                font-weight:700; font-size:12px; cursor:pointer; user-select:none;
                box-shadow:0 4px 14px rgba(0,0,0,.12); transition: transform .12s ease;}
         .badge:hover{ transform: translateY(-1px); }
      </style>
      <div class="badge">${score}%</div>`;
      const badge = sr.querySelector('.badge');

      // color
      const good = score >= 60;
      badge.style.background = good ? '#eef9f1' : '#fff1f1';
      badge.style.color = good ? '#0a5a2b' : '#7a0000';

      // tooltip data
      const reasons = [
        verified ? 'Verified purchase' : 'Unverified',
        (title + body).length < 40 ? 'Very short' : ( (title + body).length < 120 ? 'Short' : 'Detailed'),
        ...(imgCount > 0 ? [`${imgCount} image${imgCount>1?'s':''} attached`] : [])
      ];
      const excerpt = ((title ? title + " — " : "") + body).slice(0, 800);
      const tipData = { score, reasons, excerpt };

      // tooltip events
      badge.addEventListener('mouseenter', () => showTooltipNearBadge(badge, tipData));
      badge.addEventListener('focus',    () => showTooltipNearBadge(badge, tipData));
      //badge.addEventListener('mouseleave', hideTooltip);
      //badge.addEventListener('blur',       hideTooltip);

      // upload (base)
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
        arc_score: score
      };
      safeEnqueue(review_key, 'base', baseRecord);
    });
  }

  function observeForNewReviews(){
    const container = document.querySelector('#reviewsMedley, #cm_cr-review_list, #cm-cr-dp-review-list, #reviews-container')
                   || document.body;
    observer = new MutationObserver(() => setTimeout(attachBadges, 100));
    observer.observe(container, { childList:true, subtree:true });
    let scrollT;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollT);
      scrollT = setTimeout(attachBadges, 120);
    }, { passive:true });
  }
})();
