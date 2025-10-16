// ==== ARC content_script.js ===================================================
// Single-file content script with:
// - singleton guard (prevents double-injection)
// - storage + popup toggle support
// - badges with page-level tooltip (no clipping)
// - reviewer profile fetch (absolute URLs, pagination, caching)
// - AI-style score + reviewer spam likelihood + labels
// - image attachments boost
// - batched upload to background → FastAPI (/ingest)

// --- ARC singleton guard (prevents double-injection/redeclaration) -----------
if (window.__ARC_CS_ACTIVE__) {
  throw new Error("ARC content script already active");
}
window.__ARC_CS_ACTIVE__ = true;

// --- cache (per tab; reuse across re-injections) -----------------------------
const _arcCache = window.__ARC_CACHE__ || (window.__ARC_CACHE__ = { reviewer: new Map() }); // authorHref -> {items, ts}
function getCachedReviewer(authorHref){
  const it = _arcCache.reviewer.get(authorHref);
  return it && (Date.now() - it.ts) < 15*60*1000 ? it.items : null; // 15 min TTL
}
function setCachedReviewer(authorHref, items){
  _arcCache.reviewer.set(authorHref, { items, ts: Date.now() });
}

// --- batching to backend via background.js -----------------------------------
const _arcBatch = [];
let _arcBatchTimer = null;

function hashKey(s) {
  let h = 2166136261;
  for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h>>>0).toString(16);
}

function enqueueForUpload(obj) {
  _arcBatch.push(obj);
  if (_arcBatch.length >= 20) {
    flushUpload();
  } else {
    clearTimeout(_arcBatchTimer);
    _arcBatchTimer = setTimeout(flushUpload, 800); // debounce
  }
}

function flushUpload() {
  if (!_arcBatch.length) return;
  const toSend = _arcBatch.splice(0, _arcBatch.length);
  chrome.runtime.sendMessage({ type: "ARC_UPLOAD_BATCH", payload: toSend }, () => {
    // ignore response in MVP; add error handling if you like
  });
}

// --- page-level tooltip portal (avoids clipping) -----------------------------
let arcTooltip = null;
let openTooltip = null; // cleanup fn

function getOrCreateTooltipPortal(){
  if (arcTooltip && document.body.contains(arcTooltip.host)) return arcTooltip;
  const host = document.createElement('div');
  host.id = 'arc-tt-host';
  Object.assign(host.style, {
    position:'fixed', inset:'0', zIndex:'2147483646', pointerEvents:'none'
  });
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

// --- helpers -----------------------------------------------------------------
function escapeHtml(s){ return s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : ""; }
function pick(el, sel){ return el.querySelector(sel); }
function clamp01to100(x){ return Math.max(0, Math.min(100, Math.round(x))); }

function makeAbsoluteUrl(href) {
  try { return href ? new URL(href, location.origin).toString() : null; } catch { return null; }
}
function absolutizeAmazon(nextHref, baseUrl) {
  try {
    const base = new URL(baseUrl || location.href);
    return new URL(nextHref, `${base.protocol}//${base.host}`).toString();
  } catch { return null; }
}

// Verified Purchase detector
function isVerifiedPurchase(reviewNode){
  const badge = reviewNode.querySelector('[data-hook="avp-badge"]');
  if (badge && /verified\s*purchase/i.test(badge.textContent || '')) return true;
  for (const el of reviewNode.querySelectorAll('span,div')) {
    const t = (el.textContent || '').trim();
    if (t && /(^|\s)verified\s*purchase(\s|$)/i.test(t)) return true;
  }
  return false;
}

// Image count in a review (for score bonus)
function reviewImageCount(node) {
  const imgs = node.querySelectorAll('[data-hook="review-image-tile"] img, .review-image-tile img, [data-hook="review-image"] img, img.review-image-tile');
  return imgs ? imgs.length : 0;
}

// Base trust score (toy heuristic)
function baseScore({title, body, verified}){
  let score = 50;
  const txt = (title || "") + " " + (body || "");
  const len = txt.trim().length;
  if (verified) score += 20;
  if (len < 40) score -= 20; else if (len < 120) score -= 5; else score += 5;
  const lower = txt.toLowerCase();
  ["amazing product","highly recommend","best purchase","works great"].forEach(p => { if (lower.includes(p)) score -= 5; });
  return clamp01to100(score);
}

// On-page same-author history (fast, same product page)
function sameAuthorPageHistory(authorName, currentNode){
  if (!authorName) return [];
  const nodes = findReviewNodes();
  const matches = [];
  nodes.forEach(n => {
    if (n === currentNode) return;
    const aName = n.querySelector('.a-profile-name')?.innerText?.trim();
    if (aName && aName === authorName) {
      const t = n.querySelector('[data-hook="review-title"]')?.innerText?.trim()
            || n.querySelector('.review-title')?.innerText?.trim() || "";
      const b = n.querySelector('[data-hook="review-body"]')?.innerText?.trim()
            || n.querySelector('.review-text-content')?.innerText?.trim() || "";
      const rText = n.querySelector('[data-hook="review-star-rating"]')?.innerText
            || n.querySelector('.a-icon-alt')?.innerText || "";
      const rating = rText ? parseFloat(rText.split(" ")[0]) : null;
      const vp = isVerifiedPurchase(n);
      matches.push({ title:t, body:b, rating, verified:vp });
    }
  });
  return matches;
}

// Reviewer profile fetch (pagination + caching)
async function fetchReviewerProfile(authorHref, want=10, maxPages=2){
  try{
    let url = makeAbsoluteUrl(authorHref);
    if (!url) return [];
    const cached = getCachedReviewer(url);
    if (cached) return cached.slice(0, want);

    const all = [];
    for (let page=0; page<maxPages && all.length<want; page++){
      const res = await fetch(url, { credentials:'include' });
      if (!res.ok) break;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const blocks = doc.querySelectorAll('[data-hook="review"], .review, .profile-at-card, .a-section.review, .a-section.profile-at-review');
      for (const el of blocks){
        const t = el.querySelector('[data-hook="review-title"]')?.innerText?.trim()
              || el.querySelector('.review-title')?.innerText?.trim() || "";
        const b = el.querySelector('[data-hook="review-body"]')?.innerText?.trim()
              || el.querySelector('.review-text-content')?.innerText?.trim() || "";
        const rText = el.querySelector('[data-hook="review-star-rating"]')?.innerText
              || el.querySelector('.a-icon-alt')?.innerText || "";
        const rating = rText ? parseFloat(rText.split(' ')[0]) : null;

        let vp = false;
        const badge = el.querySelector('[data-hook="avp-badge"]');
        if (badge && /verified\s*purchase/i.test(badge.textContent||'')) vp = true;
        else {
          for (const s of el.querySelectorAll('span,div')){
            const tx=(s.textContent||'').trim();
            if (tx && /(^|\s)verified\s*purchase(\s|$)/i.test(tx)){ vp = true; break; }
          }
        }

        if (t || b) all.push({ title:t, body:b, rating, verified:vp });
        if (all.length >= want) break;
      }

      const next = doc.querySelector('li.a-last a, a[href*="pageNumber="], a[href*="pageNumber%3D"]');
      if (!next) break;
      const nextHref = next.getAttribute('href'); if(!nextHref) break;
      const abs = absolutizeAmazon(nextHref, url); if (!abs) break;
      url = abs;

      await new Promise(r => setTimeout(r, 400)); // polite delay
    }

    setCachedReviewer(makeAbsoluteUrl(authorHref), all);
    return all;
  } catch { return []; }
}

// History-based score nudges
function applyHistoryNudges(score, history){
  if (!history?.length) return score;
  const withRatings = history.filter(h => typeof h.rating === 'number');
  const avg = withRatings.length ? (withRatings.reduce((a,c)=>a+(c.rating||0),0)/withRatings.length) : null;
  const verifiedCount = history.filter(h => h.verified).length;
  const longCount = history.filter(h => ((h.title||'').length + (h.body||'').length) > 120).length;
  const allFive = withRatings.length >= 3 && withRatings.every(h => h.rating >= 4.5);
  if (avg && avg >= 3.5 && verifiedCount >= 1) score += 3;
  if (longCount >= 2) score += 2;
  if (allFive && verifiedCount === 0) score -= 4;
  return clamp01to100(score);
}

// AI-style score (heuristic; higher ≈ more AI-like)
function aiStyleScore(text){
  const t=(text||"").trim(); if (t.length<40) return 20;
  const sents=t.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean);
  const lens=sents.map(s=>s.split(/\s+/).length); const avg=lens.reduce((a,c)=>a+c,0)/(lens.length||1);
  const std=Math.sqrt((lens.reduce((a,c)=>a+Math.pow(c-avg,2),0)/(lens.length||1))||0);
  const words=(t.match(/\b\w+\b/g)||[]).length; const uniq=new Set((t.toLowerCase().match(/[a-z]+/g)||[])).size;
  const ttr=words?uniq/words:0; const punct=(t.match(/[,:;()-]/g)||[]).length/(t.length||1);
  const fancy=(t.match(/[\u{1F300}-\u{1FAFF}�•—–“”‘’]/gu)||[]).length;
  let s=0; if(avg>=14)s+=15; if(std<=4)s+=25; if(ttr<=0.42)s+=20; if(punct>=0.02)s+=10; if(fancy===0)s+=10;
  if(/in summary|overall,|furthermore|moreover|in conclusion/i.test(t)) s+=10;
  if(/i received this product for free|honest review/i.test(t)) s+=10;
  return clamp01to100(s);
}
function aiLabel(aiScore) {
  if (aiScore >= 70) return "AI-like";
  if (aiScore <= 35) return "Human-like";
  return "Unclear";
}

// Reviewer spam likelihood (higher ≈ more suspicious)
function reviewerSpamLikelihood(history){
  if(!history?.length) return 50;
  const n=history.length;
  const ratings=history.filter(h=>typeof h.rating==='number').map(h=>h.rating);
  const avgRating=ratings.length?ratings.reduce((a,c)=>a+c,0)/ratings.length:null;
  const allFive=ratings.length>=3 && ratings.every(r=>r>=4.5);
  const allOne =ratings.length>=3 && ratings.every(r=>r<=1.5);
  const verifiedFrac=history.filter(h=>h.verified).length/n;
  const lengths=history.map(h=>((h.title||'').length+(h.body||'').length));
  const avgLen=lengths.reduce((a,c)=>a+c,0)/n;
  const phrases=["amazing product","highly recommend","best purchase","works great","great value","5 stars"];
  let dupHits=0; history.forEach(h=>{ const lower=((h.title||'')+' '+(h.body||'')).toLowerCase(); phrases.forEach(p=>{ if(lower.includes(p)) dupHits++; }); });
  const dupRate=dupHits/Math.max(1,n);

  let spam=30;
  if(allFive||allOne) spam+=20;
  if(verifiedFrac<0.2 && n>=3) spam+=20;
  if(avgLen<80) spam+=10;
  if(dupRate>0.6) spam+=15;
  if(avgRating!==null && (avgRating>=4.7 || avgRating<=1.3)) spam+=10;

  return clamp01to100(spam);
}
function reviewerLabel(spamScore) {
  if (spamScore >= 70) return "Spam-leaning / Paid-like";
  if (spamScore <= 35) return "Organic-leaning";
  return "Unclear";
}

// --- tooltip render ----------------------------------------------------------
function buildTooltipHTML(data){
  const { score, reasons, history, aiScore, aiLabel:aiLbl, spamScore, reviewerLabel:revLbl } = data;
  const good = score >= 60;
  const headerBg = good ? '#edf9f0' : '#fff0f0';
  const headerText = good ? '#0a5a2b' : '#7a0000';

  const histHtml = history?.length
    ? `<div style="margin-top:8px;">
         <div style="font-weight:600; margin-bottom:4px;">Reviewer history (sample)</div>
         <ul style="padding-left:16px; margin:0; max-height:120px; overflow:auto;">
           ${history.map(h => {
             const len = ((h.title||'') + ' ' + (h.body||'')).trim().length;
             const tag = [
               typeof h.rating==='number' ? `${h.rating}★` : null,
               h.verified ? 'VP' : null,
               len>120 ? 'detailed' : (len<40 ? 'short' : null)
             ].filter(Boolean).join(' · ');
             const text = escapeHtml(((h.title||'') + ' — ' + (h.body||'')).slice(0,110));
             return `<li style="margin-bottom:6px;">${tag ? `<b>${tag}:</b> ` : ''}${text}</li>`;
           }).join('')}
         </ul>
       </div>`
    : `<div style="margin-top:8px; color:#666; font-size:12px;">No prior reviews found.</div>`;

  return `
    <div class="tt" role="tooltip">
      <div class="hd" style="background:${headerBg}; color:${headerText};">
        <div style="font-weight:700;">ARC score: ${score}%</div>
      </div>
      <div class="ct">
        <div class="rsn"><b>Reasons</b>
          <ul>${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        </div>

        <div class="rsn" style="margin-top:8px;">
          <b>AI style:</b> ${escapeHtml(aiLbl || '')} (${aiScore}/100)
          <span style="color:#666; font-size:11px;">(heuristic)</span>
        </div>

        ${typeof spamScore === 'number' ? `
          <div class="rsn" style="margin-top:6px;">
            <b>Reviewer type:</b> ${escapeHtml(revLbl || '')} (${spamScore}/100)
            <span style="color:#666; font-size:11px;">(behavioral)</span>
          </div>` : ''}

        ${histHtml}

        <div style="margin-top:8px; font-size:11px; color:#666;">
          ARC demo — heuristics + quick reviewer context.
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

  const rect = badgeEl.getBoundingClientRect();
  const gap = 6;
  const desiredTop = rect.bottom + gap;
  const desiredLeft = Math.min(
    Math.max(rect.right - 300, 8),
    window.innerWidth - 12 - 260
  );

  tip.style.top = `${Math.min(desiredTop, window.innerHeight - tip.offsetHeight - 12)}px`;
  tip.style.left = `${desiredLeft}px`;

  let hoverCount = 0;
  const enter = () => { hoverCount++; };
  const leave = () => { hoverCount--; setTimeout(() => { if (hoverCount <= 0) close(); }, 120); };
  tip.addEventListener('mouseenter', enter);
  tip.addEventListener('mouseleave', leave);
  badgeEl.addEventListener('mouseenter', enter);
  badgeEl.addEventListener('mouseleave', leave);

  const onScroll = () => close();
  const onResize = () => close();
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);

  function close(){
    tip.remove();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKey);
    openTooltip = null;
  }
  openTooltip = close;
}

// --- reviews wiring ----------------------------------------------------------
function findReviewNodes(){
  const sels = ['[data-hook="review"]', '.review', '.a-section.review'];
  const nodes = [];
  sels.forEach(s => document.querySelectorAll(s).forEach(n => nodes.push(n)));
  return [...new Set(nodes)];
}

(function () {
  let arcEnabled = true;
  let observer = null;

  // popup messaging
  chrome.runtime?.onMessage?.addListener?.((msg, _sender, sendResponse) => {
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

  // mirror storage
  chrome.storage?.local?.get?.({ arcEnabled:true }, (res) => {
    arcEnabled = !!res.arcEnabled;
    if (arcEnabled) boot();
  });
  chrome.storage?.onChanged?.addListener?.((changes) => {
    if ('arcEnabled' in changes) {
      arcEnabled = !!changes.arcEnabled.newValue;
      const hasBadges = document.querySelector('.arc-badge-host');
      if (arcEnabled && !hasBadges) boot();
      if (!arcEnabled) teardown();
    }
  });

  function boot(){
    addEnabledDot();
    attachBadges();
    observeForNewReviews();
  }
  function teardown(){
    removeEnabledDot();
    document.querySelectorAll('.arc-badge-host').forEach(n => n.remove());
    if (observer) { observer.disconnect(); observer = null; }
    hideTooltip();
    removeTooltipPortal();
  }

  // enabled indicator dot
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
      if (node.querySelector('.arc-badge-host')) return;

      // extract bits
      const title = pick(node,'[data-hook="review-title"]')?.innerText?.trim()
                 || pick(node,'.review-title')?.innerText?.trim() || "";
      const body  = pick(node,'[data-hook="review-body"]')?.innerText?.trim()
                 || pick(node,'.review-text-content')?.innerText?.trim() || "";
      const ratingText = pick(node,'[data-hook="review-star-rating"]')?.innerText
                       || pick(node,'.a-icon-alt')?.innerText || "";
      const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : null;
      const verified = isVerifiedPurchase(node);
      const author = pick(node,'.a-profile-name')?.innerText?.trim() || "Unknown";
      const authorHref = makeAbsoluteUrl(pick(node,'.a-profile')?.getAttribute('href'));
      const imgCount = reviewImageCount(node);

      // compute scores
      const fullText = `${title} ${body}`.trim();
      const aiScore = aiStyleScore(fullText);
      let score = baseScore({ title, body, verified });
      if (imgCount > 0) score = clamp01to100(score + Math.min(8, 3 + (imgCount - 1) * 2)); // image bonus

      // create a stable key for backend upserts
      const productAsin = (location.pathname.match(/\/dp\/([A-Z0-9]{10})/) || [])[1]
        || (new URLSearchParams(location.search).get("asin") || null);
      const review_key = hashKey([author, title, body, productAsin || location.href].join("|"));

      // host + badge (shadow)
      const host = document.createElement('div');
      host.className = 'arc-badge-host';
      host.style.position = 'relative';
      node.style.position = node.style.position || 'relative';
      node.prepend(host);

      const sr = host.attachShadow({ mode:'open' });
      sr.innerHTML = `
        <style>
          .badge {
            position:absolute; top:6px; right:6px; padding:6px 8px; border-radius:8px;
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial;
            font-weight:700; font-size:12px; cursor:pointer; user-select:none;
            box-shadow:0 4px 14px rgba(0,0,0,.12); transition: transform .12s ease;
          }
          .badge:hover { transform: translateY(-1px); }
        </style>
        <div class="badge">…</div>
      `;
      const badge = sr.querySelector('.badge');

      // initial tooltip data
      let tooltipData = {
        score,
        aiScore,
        aiLabel: aiLabel(aiScore),
        reasons: [
          verified ? 'Verified purchase' : 'Unverified',
          ((title+body).length < 40) ? 'Very short' : ((title+body).length < 120) ? 'Short' : 'Detailed',
          ...(imgCount > 0 ? [`${imgCount} image${imgCount>1?'s':''} attached`] : [])
        ],
        history: sameAuthorPageHistory(author, node),
        spamScore: null,
        reviewerLabel: null
      };

      // upload initial record (fast path)
      const baseRecord = {
        scrape_ts: new Date().toISOString(),
        page_url: location.href,
        product_asin: productAsin,
        review_key,
        review_title: title || null,
        review_body: body || null,
        review_rating: rating,
        verified_purchase: !!verified,
        images_count: imgCount,
        reviewer_name: author || null,
        reviewer_profile_url: authorHref || null,
        arc_score: score,
        ai_style_score: aiScore,
        ai_style_label: aiLabel(aiScore),
        reviewer_spam_score: null,
        reviewer_type_label: null
      };
      enqueueForUpload(baseRecord);

      function paintBadge(sc){
        const good = sc >= 60;
        badge.style.background = good ? '#eef9f1' : '#fff1f1';
        badge.style.color = good ? '#0a5a2b' : '#7a0000';
        badge.textContent = `${sc}%`;
      }
      paintBadge(score);

      // async fetch reviewer profile & refine
      (async () => {
        const prof = await fetchReviewerProfile(authorHref, 10, 2);
        if (prof.length) {
          const allHistory = [...tooltipData.history, ...prof];
          const spamScore = reviewerSpamLikelihood(allHistory);
          const refined = applyHistoryNudges(score, allHistory) - Math.round((spamScore - 50)/10);
          tooltipData = {
            ...tooltipData,
            score: clamp01to100(refined),
            history: allHistory,
            spamScore,
            reviewerLabel: reviewerLabel(spamScore)
          };
          paintBadge(tooltipData.score);

          // upload enriched record (slow path)
          enqueueForUpload({
            ...baseRecord,
            arc_score: tooltipData.score,
            reviewer_spam_score: spamScore,
            reviewer_type_label: reviewerLabel(spamScore)
          });
        }
      })();

      // tooltip events
      badge.addEventListener('mouseenter', () => showTooltipNearBadge(badge, tooltipData));
      badge.addEventListener('focus',    () => showTooltipNearBadge(badge, tooltipData));
      badge.addEventListener('mouseleave', hideTooltip);
      badge.addEventListener('blur',       hideTooltip);
      window.addEventListener('scroll', hideTooltip, { passive:true });
    });
  }

  function observeForNewReviews(){
    const container = document.querySelector('#reviewsMedley, #cm_cr-review_list, #reviews-container, body');
    observer = new MutationObserver(() => setTimeout(attachBadges, 150));
    observer.observe(container || document.body, { childList:true, subtree:true });
  }
})();
