# app.py
from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# allow your extension/background to call this (during dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],         # for dev; tighten in prod
    allow_methods=["*"],
    allow_headers=["*"],
)

class ReviewIn(BaseModel):
    scrape_ts: str
    page_url: str
    product_asin: Optional[str] = None

    review_title: Optional[str] = None
    review_body: Optional[str] = None
    review_rating: Optional[float] = None
    verified_purchase: Optional[bool] = None
    images_count: Optional[int] = 0

    reviewer_name: Optional[str] = None
    reviewer_profile_url: Optional[str] = None

    arc_score: Optional[int] = None
    ai_style_score: Optional[int] = None
    ai_style_label: Optional[str] = None

    reviewer_spam_score: Optional[int] = None
    reviewer_type_label: Optional[str] = None

    review_key: Optional[str] = None

class IngestReq(BaseModel):
    reviews: List[ReviewIn]

class ScoreReq(BaseModel):
    reviews: List[ReviewIn]

@app.post("/ingest")
def ingest(req: IngestReq):
    # TODO: write to disk/db; here we just print/count
    # Example: append to JSONL (very ML-friendly)
    import json
    from pathlib import Path
    out = Path("data") / "reviews.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a", encoding="utf-8") as f:
      for r in req.reviews:
          f.write(json.dumps(r.dict(), ensure_ascii=False) + "\n")
    return {"ok": True, "received": len(req.reviews)}

@app.post("/score")
def score(req: ScoreReq):
    # Optional: run your Python ML model here and return scores.
    # For demo, echo a neutral 50.
    return {"scores": [50 for _ in req.reviews]}
