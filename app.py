# app.py
from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import json, threading
import pandas as pd
from datetime import datetime

DATA_DIR = Path("data")
OUT_FILE = DATA_DIR / "reviews.jsonl"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ====== Live, process-wide DataFrame store ===================================
DF_LOCK = threading.RLock()
DF_COLS = [
    "scrape_ts","page_url","product_asin","review_title","review_body",
    "review_rating","verified_purchase","images_count","reviewer_name",
    "reviewer_profile_url","arc_score","ai_style_score","ai_style_label",
    "reviewer_spam_score","reviewer_type_label","review_key","review_length",
]
DF = pd.DataFrame(columns=DF_COLS)

def _rows_to_df(rows: List[dict]) -> pd.DataFrame:
    """Convert raw review dicts into a normalized DataFrame (with derived cols)."""
    df = pd.DataFrame(rows)

    # Text + length
    if "review_body" in df.columns:
        df["review_body"] = df["review_body"].fillna("").astype(str)
        df["review_length"] = df["review_body"].str.len()
    else:
        df["review_body"] = ""
        df["review_length"] = 0

    # Ratings
    if "review_rating" in df.columns:
        df["review_rating"] = pd.to_numeric(df["review_rating"], errors="coerce")
    else:
        df["review_rating"] = pd.NA

    # Images
    if "images_count" in df.columns:
        df["images_count"] = (
            pd.to_numeric(df["images_count"], errors="coerce")
            .fillna(0)
            .astype(int)
        )
    else:
        df["images_count"] = 0

    # Verified purchase
    if "verified_purchase" in df.columns:
        df["verified_purchase"] = df["verified_purchase"].fillna(False).astype(bool)
    else:
        df["verified_purchase"] = False

    # ensure all columns exist
    for c in DF_COLS:
        if c not in df.columns:
            df[c] = None

    # stable column order
    df = df[DF_COLS]
    return df

def _append_to_memory(df_new: pd.DataFrame):
    """
    Append new rows into the global DF, de-duplicate, and keep only the last 10.
    """
    global DF
    with DF_LOCK:
        if DF.empty:
            DF = df_new.copy()
        else:
            DF = pd.concat([DF, df_new], ignore_index=True)

        # de-dup: prefer review_key, else fall back to review_body
        if "review_key" in DF.columns and DF["review_key"].notna().any():
            DF.drop_duplicates(
                subset=["review_key"], keep="last", inplace=True, ignore_index=True
            )
        else:
            DF.drop_duplicates(
                subset=["review_body"], keep="last", inplace=True, ignore_index=True
            )

        # 👉 keep only the last 10 rows (your "for now only 10 records")
        DF = DF.tail(10).reset_index(drop=True)

# ====== FastAPI ==============================================================

app = FastAPI()

# allow your extension/background to call this (during dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],         # tighten in prod
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
    """
    Append to JSONL for durability + update live in-memory DataFrame.
    This endpoint is what your extension currently calls via /ingest.
    """
    rows = [r.dict() for r in req.reviews]

    # 1) durability: append to JSONL on disk
    with OUT_FILE.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # 2) live DF (last 10 rows, deduped)
    df_new = _rows_to_df(rows)
    _append_to_memory(df_new)

    with DF_LOCK:
        count = len(DF)
    return {"ok": True, "received": len(rows), "total_rows_in_memory": count}

@app.post("/reset")
def reset():
    """
    Truncate the JSONL file (disk) and reset live DF (memory).
    Your extension already calls this at the start of a new product.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text("", encoding="utf-8")
    global DF
    with DF_LOCK:
        DF = pd.DataFrame(columns=DF_COLS)
    return {"ok": True, "reset": str(OUT_FILE), "memory_rows": 0}

# === Convenience: peek the live DF (for debugging / notebooks) ==============

@app.get("/df/head")
def df_head(n: int = 10):
    """
    Return up to n rows from the live DF (for debugging).
    """
    with DF_LOCK:
        return DF.head(n).to_dict(orient="records")

@app.get("/df/count")
def df_count():
    """
    Return how many rows are currently held in memory.
    (Should max out at 10 because of tail(10) in _append_to_memory.)
    """
    with DF_LOCK:
        return {"rows_in_memory": len(DF)}

@app.post("/df/reset_memory")
def df_reset_memory():
    """
    Reset only the in-memory DF (does NOT touch the JSONL file).
    """
    global DF
    with DF_LOCK:
        DF = pd.DataFrame(columns=DF_COLS)
    return {"ok": True, "memory_rows": 0}

# === Scoring (model-ready; currently a placeholder heuristic) ===============

@app.post("/score")
def score(req: ScoreReq):
    """
    Take incoming reviews, turn them into a DataFrame, and compute scores.

    Right now this uses a simple heuristic built on top of the DataFrame:
    - longer reviews → slightly higher score
    - verified_purchase True → +10
    - more images → small bonus

    Later, when your ML model is ready, this is where you'll:
    - load your vectorizer/model at module import
    - build features from the DF
    - return model-based trust scores.
    """
    if not req.reviews:
        return {"scores": []}

    # Convert to normalized DF (same pipeline as ingest)
    rows = [r.dict() for r in req.reviews]
    df = _rows_to_df(rows)

    scores: List[int] = []

    for _, row in df.iterrows():
        score_val = 50

        # length-based adjustment
        length = row.get("review_length") or 0
        try:
            length = int(length)
        except Exception:
            length = 0

        if length < 40:
            score_val -= 15
        elif length > 200:
            score_val += 5

        # verified purchase bonus
        verified = bool(row.get("verified_purchase"))
        if verified:
            score_val += 10

        # images bonus
        imgs = row.get("images_count") or 0
        try:
            imgs = int(imgs)
        except Exception:
            imgs = 0
        score_val += min(5, imgs * 2)

        # clamp 0–100 and cast to int
        score_val = max(0, min(100, int(round(score_val))))
        scores.append(score_val)

    return {"scores": scores}
