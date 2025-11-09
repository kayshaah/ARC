from __future__ import annotations
import json, pathlib
from typing import List, Dict, Any, Optional
import pandas as pd

# Map your extension keys -> canonical column names for the DF
FIELD_MAP = {
    "review": "review_text",
    "stars": "rating",
    "verified_purchase": "verified_purchase",
    "has_images": "has_images",
    "has_videos": "has_videos",
    "review_id": "review_id",
    "asin": "asin",
    "review_date": "review_date",
    "reviewer_id": "reviewer_id",
    "helpful_count": "helpful_count",
    "verified": "verified_purchase",  # in case it's called 'verified'
}

CANONICAL_ORDER = [
    "review_id", "asin", "review_date", "reviewer_id",
    "rating", "verified_purchase", "has_images", "has_videos",
    "helpful_count", "review_text", "review_length"
]

def _read_json_any(path: pathlib.Path) -> List[Dict[str, Any]]:
    """Reads either array JSON or NDJSON."""
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    # Try array JSON
    if text[0] == "[":
        data = json.loads(text)
        if isinstance(data, dict):
            # Some exporters wrap in {"data":[...]}
            data = data.get("data", [])
        if not isinstance(data, list):
            raise ValueError("Top-level JSON must be a list (array JSON).")
        return data
    # Fallback: NDJSON (one JSON object per line)
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows

def _rename_and_clean(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for r in rows:
        m: Dict[str, Any] = {}
        for k, v in r.items():
            canon = FIELD_MAP.get(k, k)  # keep unknowns as-is
            m[canon] = v
        # Derived features
        rt = m.get("review_text", "")
        if rt is None:
            rt = ""
        m["review_text"] = str(rt)
        m["review_length"] = len(m["review_text"])
        # Coerce known types
        if "rating" in m:
            try:
                m["rating"] = float(m["rating"])
            except Exception:
                m["rating"] = None
        for b in ("verified_purchase", "has_images", "has_videos"):
            if b in m:
                m[b] = bool(m[b])
        if "helpful_count" in m:
            try:
                m["helpful_count"] = int(m["helpful_count"])
            except Exception:
                m["helpful_count"] = 0
        out.append(m)
    return out

def load_reviews_df(json_path: str | pathlib.Path, limit: int = 10) -> pd.DataFrame:
    """Load up to `limit` reviews into a normalized DataFrame."""
    p = pathlib.Path(json_path)
    rows = _read_json_any(p)
    rows = rows[:limit] if limit is not None else rows
    rows = _rename_and_clean(rows)
    if not rows:
        return pd.DataFrame(columns=CANONICAL_ORDER)
    df = pd.DataFrame(rows)
    # Ensure stable column order and presence
    for col in CANONICAL_ORDER:
        if col not in df.columns:
            df[col] = None
    df = df[CANONICAL_ORDER]
    # Drop obvious dupes by review_id + review_text (if present)
    subset = [c for c in ("review_id", "review_text") if c in df.columns]
    if subset:
        df = df.drop_duplicates(subset=subset, keep="first").reset_index(drop=True)
    return df

def save_df(
    df: pd.DataFrame,
    out_path: str | pathlib.Path,
    fmt: str = "parquet"
) -> pathlib.Path:
    """Save DataFrame to parquet or csv."""
    out = pathlib.Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if fmt.lower() == "parquet":
        df.to_parquet(out, index=False)
    elif fmt.lower() == "csv":
        df.to_csv(out, index=False)
    else:
        raise ValueError("fmt must be 'parquet' or 'csv'")
    return out

if __name__ == "__main__":
    # Example CLI usage:
    #   python load_reviews.py /path/to/reviews.json
    import sys
    in_path = sys.argv[1] if len(sys.argv) > 1 else "reviews.json"
    df = load_reviews_df(in_path, limit=10)
    print(df.head(10).to_string(index=False))
    # Optionally save
    # save_df(df, "data/reviews_sample.parquet", fmt="parquet")
