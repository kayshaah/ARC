# ARC – Amazon Review Classification (Chrome Extension)

**Status (Oct 16, 2025):**  
You have a working Chrome extension overlay (“ARC”) that injects **trust badges** onto Amazon review cards and shows a **hover tooltip** with details. Data can be batched to a local **FastAPI** backend via the background service worker (`/ingest`). The **next major step** is to move **all scoring** (ARC score, AI-style score, reviewer spam likelihood) from the content script to the **backend model** via a `/score` endpoint. You have code for both client-side (heuristic) and backend-scored flows; backend scoring is **not yet switched on**.

---

## Folder layout (dev)
```
arc-extension/
├─ manifest.json               # MV3 manifest
├─ background.js               # service worker (upload + scoring proxies)
├─ content_script.js           # current overlay & data collection (client-side scoring OR backend-scored version)
├─ hello.html + popup.js/css   # popup UI with on/off switch (CSP-safe, no inline JS)
├─ icon.png
└─ server/
   └─ app.py                   # FastAPI dev server with /ingest (working) and /score (stub provided)
```

> If you don’t keep a `server/` folder, you can place `app.py` at repo root; adjust paths accordingly.

---

## What works now

- **Overlay UI**  
  - Injects a **badge** onto each Amazon review block.  
  - **Hover** shows a tooltip (uses a page-level shadow portal to avoid clipping).  
  - Handles **lazy-loaded** reviews (MutationObserver + scroll rescan).  
  - Verified Purchase detection and image-count extraction.  
  - Works on product pages, “See all reviews” pages, and many reviewer profile layouts.

- **Data pipeline (optional, already wired)**  
  - Content script batches **review records** (title, body, rating, verified, images, author, ASIN, `review_key`)  
  - Sends to **background.js** → POST to **FastAPI `/ingest`** (writes `reviews.jsonl` to a safe path).  
  - Batching is **debounced** and **flushed** on `visibilitychange`/`pagehide` so you don’t lose records.

- **Diagnostics**  
  - Background service worker logs (open via `chrome://extensions` → your extension → **Service worker**).  
  - Content script **PING** confirms background is live.  
  - FastAPI exposes **Swagger UI** at `http://127.0.0.1:8001/docs`.

---

## Not done yet (next steps)

- **Switch to backend-scored flow**: All scores/labels come from `/score`.  
  - The content script collects features and queues them to `ARC_SCORE_BATCH`.  
  - Background calls `POST /score` and returns model outputs.  
  - Badges/tooltip update from the backend response.  
- **Plug in your real ML model** inside `app.py → score_one()` or an imported module.  
- **Persist scored rows** (upsert by `review_key`) and/or store to a DB (SQLite/Postgres).

---

## Chrome extension setup

### `manifest.json` (key points)
```json
{
  "manifest_version": 3,
  "name": "ARC v1",
  "version": "1.0",
  "action": { "default_popup": "hello.html", "default_icon": "icon.png" },

  "background": { "service_worker": "background.js" },

  "permissions": ["storage"],

  "host_permissions": [
    "https://www.amazon.*/*",
    "http://127.0.0.1:8001/*",
    "http://localhost:8001/*"
  ],

  "content_scripts": [{
    "matches": ["https://www.amazon.*/*"],
    "js": ["content_script.js"],
    "run_at": "document_idle"
  }]
}
```

### `background.js` (must log on load)
- Should print `"[ARC/bg] loaded"` in the Service Worker console.
- Must implement **ARC_UPLOAD_BATCH** → `POST /ingest` and **ARC_SCORE_BATCH** → `POST /score`.

> Open `chrome://extensions` → enable **Developer mode** → **Reload** the extension → click **Service worker** and make sure you see logs.

### `hello.html` / `popup.js`
- No inline JS (CSP).  
- Toggle stored in `chrome.storage.local` as `arcEnabled` and pinged to content script (`ARC_TOGGLE`).

---

## FastAPI server

### Install & run (Mac)
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install fastapi uvicorn
uvicorn app:app --reload --port 8001
```

Open `http://127.0.0.1:8001/docs` to test.

### `app.py` (summary)
- `/ingest` (POST): appends JSON rows to a **writable** path (prints exact path on startup).  
- `/score` (POST): receives a list of feature dicts (`review_key`, `review_title`, `review_body`, `verified_purchase`, `images_count`, etc.), returns:
  ```json
  {
    "results": [{
      "review_key": "abc123",
      "arc_score": 72,
      "reasons": ["Verified purchase","Detailed", "2 images attached"],
      "ai_style_score": 41,
      "ai_style_label": "Human-like",
      "reviewer_spam_score": 33,
      "reviewer_type_label": "Organic-leaning",
      "history": []  // optional
    }]
  }
  ```

> You have a working `/ingest` and a stub `/score` function; replace `score_one()` with your model call.

---

## Testing checklist

1. **Server up**: `http://127.0.0.1:8001/docs` loads; `/ingest` works via “Try it out”.  
2. **Background active**: Service Worker console shows `"[ARC/bg] loaded"`.  
3. **Content PING**: On an Amazon review page, page console shows `"[ARC/cs] PING ok:"`.  
4. **Badges appear**: Scroll the reviews page; badges should attach to each review card.  
5. **Uploads happen** (optional): Background console shows POST `/ingest` with 200 OK; server prints a write path.  
6. **Scoring (when switched)**: Background console shows POST `/score`; badges update from model outputs.

---

## Common issues & fixes

- **Service worker console blank** → `background.js` path not referenced, or syntax error. Check `manifest.json`, reload, open **Errors**.  
- **`{"detail":"Not Found"}` at root** → you hit `/`; use `/docs`, `/ingest`, or `/score`.  
- **No `data/reviews.jsonl`** → server didn’t get POSTs, or wrote to a different path. The app prints the exact file path.  
- **PermissionError on write** → use the safe `app.py` that writes under `~/Library/Application Support/ARC/` or `/tmp/ARC`.  
- **Not all reviews captured** → lazy-load; our script rescan on scroll + DOM mutations; keep scrolling.  
- **Inline script CSP error in popup** → move JS to `popup.js`, reference it via `<script src="popup.js"></script>`.

---

## Switching to backend-scored mode (when ready)

1. Replace `content_script.js` with the **backend-scored** version (already provided in chat).  
   - It **only** collects features and calls `ARC_SCORE_BATCH`.  
   - It still uploads raw rows to `/ingest` (optional).  
2. Ensure `background.js` implements `ARC_SCORE_BATCH` → `POST /score`.  
3. Implement your real model in `app.py → score_one()` (or call an external service).  
4. Reload extension, refresh Amazon page, confirm badges show **model** scores.

---

## Data schema (ingest)

Each row (JSONL) contains:
```json
{
  "scrape_ts": "2025-10-16T12:34:56.789Z",
  "page_url": "https://www.amazon.com/…",
  "product_asin": "B0XXXXXXX",
  "review_key": "hash",
  "review_title": "…",
  "review_body": "…",
  "review_rating": 4.0,
  "verified_purchase": true,
  "images_count": 2,
  "reviewer_name": "John Doe",
  "reviewer_profile_url": "https://www.amazon.com/gp/profile/…",

  // present only after scoring (backend-scored)
  "arc_score": 72,
  "reasons": ["Verified purchase","Detailed","2 images attached"],
  "ai_style_score": 41,
  "ai_style_label": "Human-like",
  "reviewer_spam_score": 33,
  "reviewer_type_label": "Organic-leaning"
}
```

Use `review_key` to **upsert** (avoid duplicates) when you move to a DB.

---

## Roadmap

- [ ] Switch extension to **backend-scored** flow.  
- [ ] Plug real model into `/score` (text features, metadata, reviewer history).  
- [ ] Add **upsert** on backend (SQLite/Postgres) keyed by `review_key`.  
- [ ] Add `/health` endpoint + versioning.  
- [ ] Add telemetry counters & error logs.  
- [ ] Optimize reviewer-profile fetch on server (optional).  
- [ ] Pack & publish (when ToS-compliant).

---

## Notes for Future Me

- The user explicitly said: **“still haven’t switched to backend yet.”**  
- Use this README as the hand-off and return point. Next step: swap `content_script.js` to backend-scored and test `/score`.
