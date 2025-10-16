// ==== ARC content_script.js (clean) ==========================================

// --- cache (per tab) ---------------------------------------------------------
const _arcCache = { reviewer: new Map() }; // authorHref -> {items, ts}
function getCachedReviewer(authorHref){
  const it = _arcCache.reviewer.get(authorHref);
  return it && (Date.now() - it.ts) < 15*60*1000 ? it.items : null; // 15 min
}
function setCachedReviewer(authorHref, items){
  _arcCache.reviewer.set(authorHref, { items, ts: Date.now() });
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

// --- extension state + lifecycle --------------------------------------------
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

  // lifecycle
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

  // enabled dot
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

  // --- utils -----------------------------------------------------------------
  function escapeHtml(s){ return s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : ""; }
  function pick(el, sel){ return el.querySelector(sel); }

  function isVerifiedPurchase(reviewNode){
    const badge = reviewNode.querySelector('[data-hook="avp-badge"]');
    if (badge && /verified\s*purchase/i.test(badge.textContent || '')) return true;
    for (const el of reviewNode.querySelectorAll('span,div')) {
      const t = (el.textContent || '').trim();
      if (t && /(^|\s)verified\s*purchase(\s|$)/i.test(t)) return true;
    }
    return false;
  }

  function baseScore({title, body, verified}){
    let score = 50;
    const txt = (title || "") + " " + (body || "");
    const len = txt.trim().length;
    if (verified) score += 20;
    if (len < 40) score -= 20; else if (len < 120) score -= 5; else score += 5;
    const lower = txt.toLowerCase();
    ["amazing product","highly recommend","best purchase","works great"].forEach(p => { if (lower.includes(p)) score -= 5; });
    return Math.max(0, Math.min(100, Math.round(score)));
  }

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

  async function fetchReviewerProfile(authorHref, want=10, maxPages=2){
    try{
      if (!authorHref) return [];
      const cached = getCachedReviewer(authorHref);
      if (cached) return cached.slice(0, want);

      let url = authorHref;
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
        const base = new URL(url);
        url = new URL(nextHref, `${base.protocol}//${base.host}`).toString();

        await new Promise(r => setTimeout(r, 400));
      }

      setCachedReviewer(authorHref, all);
      return all;
    } catch { return []; }
  }

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
    return Math.max(0, Math.min(100, score));
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
    return Math.max(0, Math.min(100, Math.round(s)));
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

    return Math.max(0, Math.min(100, Math.round(spam)));
  }

  // --- tooltip render --------------------------------------------------------
  function buildTooltipHTML(data){
    const { score, reasons, history, aiScore, spamScore } = data;
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
            <b>AI style score:</b> ${aiScore}/100
            <span style="color:#666; font-size:11px;">(higher ≈ more AI-like; heuristic)</span>
          </div>

          ${typeof spamScore === 'number' ? `
            <div class="rsn" style="margin-top:6px;">
              <b>Reviewer spam likelihood:</b> ${spamScore}/100
              <span style="color:#666; font-size:11px;">(behavioral signal)</span>
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

    // after appended, we can read offsetHeight
    tip.style.top = `${Math.min(desiredTop, window.innerHeight - tip.offsetHeight - 12)}px`;
    tip.style.left = `${desiredLeft}px`;

    let hoverCount = 0;
    const enter = () => { hoverCount++; };
    const leave = () => {
      hoverCount--;
      setTimeout(() => { if (hoverCount <= 0) close(); }, 120);
    };
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

  // --- review wiring ---------------------------------------------------------
  function findReviewNodes(){
    const sels = ['[data-hook="review"]', '.review', '.a-section.review'];
    const nodes = [];
    sels.forEach(s => document.querySelectorAll(s).forEach(n => nodes.push(n)));
    return [...new Set(nodes)];
  }

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
      const authorHref = pick(node,'.a-profile')?.href || null;

      // compute scores
      const fullText = `${title} ${body}`.trim();
      const aiScore = aiStyleScore(fullText);
      let score = baseScore({ title, body, verified });

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
        reasons: [
          verified ? 'Verified purchase' : 'Unverified',
          ((title+body).length < 40) ? 'Very short' : ((title+body).length < 120) ? 'Short' : 'Detailed'
        ],
        history: sameAuthorPageHistory(author, node),
        spamScore: null
      };

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
          tooltipData = { ...tooltipData, score: refined, history: allHistory, spamScore };
          paintBadge(refined);
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
