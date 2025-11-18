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
    df = pd.DataFrame(rows)
    # add deriveds / coercions
    if "review_body" in df.columns:
        df["review_body"] = df["review_body"].fillna("").astype(str)
        df["review_length"] = df["review_body"].str.len()
    else:
        df["review_length"] = 0
    if "review_rating" in df.columns:
        df["review_rating"] = pd.to_numeric(df["review_rating"], errors="coerce")
    if "images_count" in df.columns:
        df["images_count"] = pd.to_numeric(df["images_count"], errors="coerce").fillna(0).astype(int)
    if "verified_purchase" in df.columns:
        df["verified_purchase"] = df["verified_purchase"].astype(bool)
    # ensure all columns exist
    for c in DF_COLS:
        if c not in df.columns:
            df[c] = None
    # stable column order
    df = df[DF_COLS]
    return df

def _append_to_memory(df_new: pd.DataFrame):
    global DF
    with DF_LOCK:
        if DF.empty:
            DF = df_new.copy()
        else:
            DF = pd.concat([DF, df_new], ignore_index=True)
        # de-dup: prefer review_key, else fall back to review_body
        if "review_key" in DF.columns:
            if DF["review_key"].notna().any():
                DF.drop_duplicates(subset=["review_key"], keep="last", inplace=True, ignore_index=True)
            else:
                DF.drop_duplicates(subset=["review_body"], keep="last", inplace=True, ignore_index=True)
        else:
            DF.drop_duplicates(subset=["review_body"], keep="last", inplace=True, ignore_index=True)

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
    """Append to JSONL for durability + update live in-memory DataFrame."""
    rows = [r.dict() for r in req.reviews]
    # 1) durability
    with OUT_FILE.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    # 2) live DF
    df_new = _rows_to_df(rows)
    _append_to_memory(df_new)
    with DF_LOCK:
        count = len(DF)
    return {"ok": True, "received": len(rows), "total_rows_in_memory": count}

@app.post("/reset")
def reset():
    """Truncate the JSONL file (disk) and reset live DF (memory)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text("", encoding="utf-8")
    global DF
    with DF_LOCK:
        DF = pd.DataFrame(columns=DF_COLS)
    return {"ok": True, "reset": str(OUT_FILE), "memory_rows": 0}

# === Convenience: peek the live DF (for debugging / notebooks) ==============

@app.get("/df/head")
def df_head(n: int = 10):
    with DF_LOCK:
        return DF.head(n).to_dict(orient="records")

@app.get("/df/count")
def df_count():
    with DF_LOCK:
        return {"rows_in_memory": len(DF)}

@app.post("/df/reset_memory")
def df_reset_memory():
    global DF
    with DF_LOCK:
        DF = pd.DataFrame(columns=DF_COLS)
    return {"ok": True, "memory_rows": 0}

@app.post("/score")
def score(req: ScoreReq):
    # placeholder: when model is ready, compute real scores here
    return {"scores": [50 for _ in req.reviews]}
