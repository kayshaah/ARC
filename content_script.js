(function () {
  // ---- state
  let arcEnabled = true;
  let observer = null;

  // ---- storage: read initial state, then boot
  chrome.storage?.local?.get?.({ arcEnabled: true }, (res) => {
    arcEnabled = !!res.arcEnabled;
    if (arcEnabled) boot();
  });

  // react to popup toggle changes in real time
  chrome.storage?.onChanged?.addListener?.((changes) => {
    if ('arcEnabled' in changes) {
      arcEnabled = changes.arcEnabled.newValue;
      if (arcEnabled) {
        boot();
      } else {
        teardown();
      }
    }
  });

  function boot() {
    makePanelOnce();
    attachBadges();
    watchForChanges();
  }

  function teardown() {
    // remove panel
    document.getElementById('arc-panel-host')?.remove();
    // remove all badges
    document.querySelectorAll('.arc-badge-host').forEach(n => n.remove());
    // disconnect observer
    if (observer) { observer.disconnect(); observer = null; }
  }

  // -------- helpers
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  function escapeHtml(s) { return s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : ""; }

  // -------- overlay
  function makePanelOnce() {
    if (document.getElementById("arc-panel-host")) return;

    const host = document.createElement("div");
    host.id = "arc-panel-host";
    Object.assign(host.style, { position:"fixed", right:"12px", bottom:"12px", zIndex:"2147483646" });

    const sr = host.attachShadow({ mode: "open" });
    sr.innerHTML = `
      <style>
        .panel { width: 340px; max-width: calc(100vw - 24px); background: #fff;
                 border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.2);
                 font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial; overflow: hidden; }
        .hdr { display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid #eee; }
        .title { font-weight:700; font-size:14px; letter-spacing:.2px; }
        .spacer { flex:1; }
        .btn { background:transparent; border:none; cursor:pointer; padding:6px; border-radius:8px; font-size:14px; }
        .btn:hover { background:#f3f3f3; }
        .content { padding:10px; font-size:13px; color:#222; }
        .hint { color:#666; font-size:12px; margin-top:6px; }
      </style>
      <div class="panel" role="dialog" aria-label="ARC v1">
        <div class="hdr">
          <div class="title">ARC v1 overlay</div>
          <div class="spacer"></div>
          <button id="arc-quit" class="btn" title="Turn off ARC">✕</button>
        </div>
        <div class="content">
          <div>Click any <b>Trust</b> badge on a review to see details here.</div>
          <div class="hint">Demo logic only (no real ML yet).</div>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    // QUIT button: disables ARC globally via storage and cleans UI
    sr.getElementById('arc-quit').addEventListener('click', () => {
      chrome.storage?.local?.set?.({ arcEnabled: false });
      teardown();
    });
  }

  // -------- find reviews
  function findReviewNodes() {
    const sel = ['[data-hook="review"]', '.review', '.a-section.review'];
    const nodes = [];
    sel.forEach(s => document.querySelectorAll(s).forEach(n => nodes.push(n)));
    return [...new Set(nodes)];
  }

  // -------- verified-purchase (more robust)
  function isVerifiedPurchase(reviewNode) {
    // 1) canonical badge
    const badge = reviewNode.querySelector('[data-hook="avp-badge"]');
    if (badge && /verified\s*purchase/i.test(badge.textContent || '')) return true;

    // 2) some layouts render just text somewhere in the meta row
    const textCandidates = reviewNode.querySelectorAll('span, div');
    for (const el of textCandidates) {
      const t = (el.textContent || '').trim();
      if (t && /(^|\s)verified\s*purchase(\s|$)/i.test(t)) return true;
    }
    return false;
  }

  // -------- toy scoring
  function toyScore(title, body, verified) {
    let score = 50;
    const txt = (title || "") + " " + (body || "");
    const len = txt.trim().length;

    if (verified) score += 20;
    if (len < 40) score -= 20;
    else if (len < 120) score -= 5;
    else score += 5;

    const lower = txt.toLowerCase();
    ["amazing product", "highly recommend", "best purchase", "works great"].forEach(p => {
      if (lower.includes(p)) score -= 5;
    });

    score = Math.max(0, Math.min(100, Math.round(score)));
    const level = score >= 80 ? "high" : score >= 40 ? "medium" : "low";

    const reasons = [];
    reasons.push(verified ? "Verified purchase" : "Unverified");
    reasons.push(len < 40 ? "Very short" : len < 120 ? "Short" : "Detailed");
    return { score, level, reasons };
  }

  // -------- attach badges
  function attachBadges() {
    if (!arcEnabled) return;
    const reviews = findReviewNodes();
    reviews.forEach(node => {
      if (node.querySelector(".arc-badge-host")) return;

      const title = node.querySelector('[data-hook="review-title"]')?.innerText?.trim()
        || node.querySelector('.review-title')?.innerText?.trim() || "";
      const body  = node.querySelector('[data-hook="review-body"]')?.innerText?.trim()
        || node.querySelector('.review-text-content')?.innerText?.trim() || "";
      const ratingText = node.querySelector('[data-hook="review-star-rating"]')?.innerText
        || node.querySelector('.a-icon-alt')?.innerText || "";
      const rating = ratingText ? parseFloat(ratingText.split(" ")[0]) : null;
      const verified = isVerifiedPurchase(node);
      const author = node.querySelector('.a-profile-name')?.innerText?.trim() || "Unknown";

      const host = document.createElement("div");
      host.className = "arc-badge-host";
      host.style.position = "relative";
      node.style.position = node.style.position || "relative";
      node.prepend(host);

      const sr = host.attachShadow({ mode: "open" });
      sr.innerHTML = `
        <style>
          .badge { position: absolute; top: 6px; right: 6px; padding: 6px 8px; border-radius: 8px;
                   font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial;
                   font-weight: 700; font-size: 12px; cursor: pointer;
                   box-shadow: 0 4px 14px rgba(0,0,0,.15); transition: transform .15s ease; user-select: none; }
          .badge:hover { transform: translateY(-2px); }
          .high   { background: #e9ffe9; color:#0a5a2b; }
          .medium { background: #fff7d6; color:#5a3b00; }
          .low    { background: #ffe8e6; color:#7a0000; }
        </style>
        <div class="badge medium" title="Click for details">Trust</div>
      `;
      const badge = sr.querySelector(".badge");

      const res = toyScore(title, body, verified);
      badge.textContent = String(res.score) + "%";
      badge.classList.remove("high","medium","low");
      badge.classList.add(res.level);

      badge.addEventListener("click", () => {
        const panelHost = document.getElementById("arc-panel-host");
        if (!panelHost) return;
        const panelSR = panelHost.shadowRoot;
        const content = panelSR.querySelector(".content");
        content.innerHTML = `
          <div><b>Reviewer:</b> ${escapeHtml(author)}</div>
          <div><b>Rating:</b> ${rating ?? "?"} ★</div>
          <div><b>Score:</b> ${res.score}% (${res.level})</div>
          <div style="margin-top:8px;"><b>Reasons</b>
            <ul>${res.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
          </div>
          <div style="margin-top:8px;"><b>Excerpt</b>
            <div style="padding:8px;background:#f7f7f7;border-radius:8px;max-height:120px;overflow:auto;">
              ${escapeHtml((title + " — " + body).slice(0,800))}
            </div>
          </div>
          <div class="hint">Demo only. Real ML coming next.</div>
        `;
      });
    });
  }

  // -------- observer (handles Amazon’s dynamic loading)
  function watchForChanges() {
    const container = document.querySelector("#reviewsMedley, #cm_cr-review_list, #reviews-container, body");
    observer = new MutationObserver(() => setTimeout(attachBadges, 200));
    observer.observe(container || document.body, { childList: true, subtree: true });
  }

  // run after DOM is ready if enabled
  ready(() => { if (arcEnabled) boot(); });
})();
