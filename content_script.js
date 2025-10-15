(function () {
  let arcEnabled = true;
  let observer = null;

  // ===== live messaging from popup =====
  chrome.runtime?.onMessage?.addListener?.((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ARC_TOGGLE') {
      arcEnabled = !!msg.enabled;
      if (arcEnabled) boot();
      else teardown();
      sendResponse({ ok: true, enabled: arcEnabled });
    } else if (msg.type === 'ARC_GET_STATUS') {
      sendResponse({ enabled: !!arcEnabled });
    }
    // keep the channel open only for async; here we return immediately
    return true;
  });

  // also mirror storage (so new pages pick it up)
  chrome.storage?.local?.get?.({ arcEnabled: true }, (res) => {
    arcEnabled = !!res.arcEnabled;
    if (arcEnabled) boot();
  });
  chrome.storage?.onChanged?.addListener?.((changes) => {
    if ('arcEnabled' in changes) {
      arcEnabled = !!changes.arcEnabled.newValue;
      // don’t double-boot: if badges exist and enabled -> do nothing
      const hasBadges = document.querySelector('.arc-badge-host');
      if (arcEnabled && !hasBadges) boot();
      if (!arcEnabled) teardown();
    }
  });

  // ===== lifecycle =====
  function boot() {
    addEnabledDot();       // small indicator so you "see" ARC is on
    attachBadges();
    observeForNewReviews();
  }
  function teardown() {
    removeEnabledDot();
    document.querySelectorAll('.arc-badge-host').forEach(n => n.remove());
    if (observer) { observer.disconnect(); observer = null; }
  }

  // ===== tiny enabled dot (top-left corner) =====
  function addEnabledDot() {
    if (document.getElementById('arc-enabled-dot')) return;
    const dot = document.createElement('div');
    dot.id = 'arc-enabled-dot';
    Object.assign(dot.style, {
      position: 'fixed', left: '8px', top: '8px', width: '10px', height: '10px',
      borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 2px rgba(34,197,94,.25)',
      zIndex: '2147483646', opacity: '0.85', pointerEvents: 'none'
    });
    dot.title = 'ARC enabled';
    document.body.appendChild(dot);
  }
  function removeEnabledDot() {
    document.getElementById('arc-enabled-dot')?.remove();
  }

  // ===== utilities =====
  function escapeHtml(s){ return s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : ""; }
  function pick(el, sel){ return el.querySelector(sel); }

  function isVerifiedPurchase(reviewNode) {
    const badge = reviewNode.querySelector('[data-hook="avp-badge"]');
    if (badge && /verified\s*purchase/i.test(badge.textContent || '')) return true;
    for (const el of reviewNode.querySelectorAll('span,div')) {
      const t = (el.textContent || '').trim();
      if (t && /(^|\s)verified\s*purchase(\s|$)/i.test(t)) return true;
    }
    return false;
  }

  function baseScore({title, body, verified}) {
    let score = 50;
    const txt = (title || "") + " " + (body || "");
    const len = txt.trim().length;
    if (verified) score += 20;
    if (len < 40) score -= 20; else if (len < 120) score -= 5; else score += 5;
    const lower = txt.toLowerCase();
    ["amazing product","highly recommend","best purchase","works great"].forEach(p => { if (lower.includes(p)) score -= 5; });
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function sameAuthorPageHistory(authorName, currentNode) {
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
        matches.push({ title: t, body: b, rating, verified: vp });
      }
    });
    return matches;
  }

  async function fetchReviewerProfile(authorHref, limit = 5) {
    try {
      if (!authorHref) return [];
      const res = await fetch(authorHref, { credentials: 'include' });
      if (!res.ok) return [];
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const items = [];
      const blocks = doc.querySelectorAll('[data-hook="review"], .review, .profile-at-card, .a-section.review');
      for (const el of blocks) {
        const t = el.querySelector('[data-hook="review-title"]')?.innerText?.trim()
                || el.querySelector('.review-title')?.innerText?.trim() || "";
        const b = el.querySelector('[data-hook="review-body"]')?.innerText?.trim()
                || el.querySelector('.review-text-content')?.innerText?.trim() || "";
        const rText = el.querySelector('[data-hook="review-star-rating"]')?.innerText
                || el.querySelector('.a-icon-alt')?.innerText || "";
        const rating = rText ? parseFloat(rText.split(" ")[0]) : null;
        let vp = false;
        const badge = el.querySelector('[data-hook="avp-badge"]');
        if (badge && /verified\s*purchase/i.test(badge.textContent || '')) vp = true;
        else {
          for (const s of el.querySelectorAll('span,div')) {
            const tx = (s.textContent || '').trim();
            if (tx && /(^|\s)verified\s*purchase(\s|$)/i.test(tx)) { vp = true; break; }
          }
        }
        if (t || b) items.push({ title: t, body: b, rating, verified: vp });
        if (items.length >= limit) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  function applyHistoryNudges(score, history) {
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

  function buildTooltipHTML(data) {
    const { score, reasons, history } = data;
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
      <style>
        .tt { position:absolute; right:6px; top:34px; min-width:260px; max-width:320px;
              background:#fff; border:1px solid #eaeaea; border-radius:10px; box-shadow:0 12px 28px rgba(0,0,0,.18);
              font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial; font-size:12px; color:#222; z-index:99999; }
        .hd { display:flex; align-items:center; justify-content:space-between; padding:8px 10px;
              background:${headerBg}; color:${headerText}; border-bottom:1px solid #eee; }
        .ct { padding:10px; }
        .rsn { color:#444; }
        .rsn ul { margin:6px 0 0 16px; padding:0; }
      </style>
      <div class="tt" role="tooltip">
        <div class="hd"><div style="font-weight:700;">ARC score: ${score}%</div></div>
        <div class="ct">
          <div class="rsn"><b>Reasons</b>
            <ul>${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
          </div>
          ${histHtml}
          <div style="margin-top:8px; font-size:11px; color:#666;">ARC demo — heuristics + quick reviewer context.</div>
        </div>
      </div>
    `;
  }

  function createTooltip(shadowRoot, data) {
    const wrap = document.createElement('div');
    wrap.innerHTML = buildTooltipHTML(data);
    const el = wrap.firstElementChild;
    shadowRoot.appendChild(el);
    return el;
  }

  function findReviewNodes() {
    const sels = ['[data-hook="review"]', '.review', '.a-section.review'];
    const nodes = [];
    sels.forEach(s => document.querySelectorAll(s).forEach(n => nodes.push(n)));
    return [...new Set(nodes)];
  }

  function attachBadges() {
    if (!arcEnabled) return;
    const reviews = findReviewNodes();
    reviews.forEach(node => {
      if (node.querySelector('.arc-badge-host')) return;

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

      let score = baseScore({title, body, verified});
      let tooltipEl = null;
      let tooltipData = {
        score,
        reasons: [
          verified ? 'Verified purchase' : 'Unverified',
          ((title+body).length < 40) ? 'Very short' : ((title+body).length < 120) ? 'Short' : 'Detailed'
        ],
        history: sameAuthorPageHistory(author, node)
      };

      function paintBadge(sc) {
        const good = sc >= 60;
        badge.style.background = good ? '#eef9f1' : '#fff1f1';
        badge.style.color = good ? '#0a5a2b' : '#7a0000';
        badge.textContent = `${sc}%`;
      }
      paintBadge(score);

      (async () => {
        const prof = await fetchReviewerProfile(authorHref, 5);
        if (prof.length) {
          const allHistory = [...tooltipData.history, ...prof];
          const newScore = applyHistoryNudges(score, allHistory);
          tooltipData = { ...tooltipData, score: newScore, history: allHistory };
          paintBadge(newScore);
          if (tooltipEl && tooltipEl.isConnected) {
            tooltipEl.remove();
            tooltipEl = createTooltip(sr, tooltipData);
          }
        }
      })();

      function showTooltip() { if (!tooltipEl) tooltipEl = createTooltip(sr, tooltipData); }
      function hideTooltip() { if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; } }

      badge.addEventListener('mouseenter', showTooltip);
      badge.addEventListener('mouseleave', hideTooltip);
      badge.addEventListener('focus', showTooltip);
      badge.addEventListener('blur', hideTooltip);
      window.addEventListener('scroll', hideTooltip, { passive:true });
    });
  }

  function observeForNewReviews() {
    const container = document.querySelector('#reviewsMedley, #cm_cr-review_list, #reviews-container, body');
    observer = new MutationObserver(() => setTimeout(attachBadges, 150));
    observer.observe(container || document.body, { childList:true, subtree:true });
  }
})();
