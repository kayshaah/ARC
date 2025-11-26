# app.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
import pickle
import os
import re

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# LOAD ML MODEL (Checks for "Generic/Spammy" text patterns)
MODEL_PATH = "arc_model.pkl"
model = None
if os.path.exists(MODEL_PATH):
    with open(MODEL_PATH, 'rb') as f:
        model = pickle.load(f)
    print("✅ ML Model Loaded")

# DATA MODELS
class ReviewIn(BaseModel):
    review_title: Optional[str] = ""
    review_body: Optional[str] = ""
    verified_purchase: bool = False
    image_count: int = 0
    author_name: Optional[str] = "Unknown"

class ScoreReq(BaseModel):
    reviews: List[ReviewIn]

# HELPER: Check for weird usernames
def is_suspicious_name(name):
    if not name: return True
    name = name.lower().strip()
    # 1. "Amazon Customer" is generic
    if "amazon customer" in name: return True
    # 2. Pattern: "User" followed by many numbers (e.g. User938475)
    if re.match(r"user\d{4,}", name): return True
    # 3. Pattern: Gibberish alphanumeric (no spaces, mixed numbers/letters, length > 8)
    # e.g. "a83k29f2"
    if re.match(r"^[a-z0-9]{8,}$", name) and not " " in name: return True
    return False

@app.post("/score")
def score(req: ScoreReq):
    if not req.reviews: return {"scores": []}
    
    # Pre-calculate ML probabilities for the batch
    texts = [(r.review_title or "") + " " + (r.review_body or "") for r in req.reviews]
    ml_scores = [0.5] * len(texts) # Default neutral
    
    if model:
        try:
            # predict_proba gives [prob_fake, prob_real]
            # We take prob_real (0.0 to 1.0)
            probs = model.predict_proba(texts)[:, 1]
            ml_scores = probs
        except:
            pass

    results = []

    for i, r in enumerate(req.reviews):
        # === THE FORMULA ===
        # Start Neutral
        score = 50 

        # 1. VERIFIED PURCHASE (Heavy Positive)
        if r.verified_purchase:
            score += 25
        
        # 2. IMAGES / VIDEO (Positive)
        if r.image_count > 0:
            score += 15

        # 3. TEXT DETAIL (Length check)
        text_len = len(texts[i])
        if text_len > 400: score += 15       # Very Detailed
        elif text_len > 150: score += 10     # Decent detail
        elif text_len < 30: score -= 20      # Too short/Generic (Negative)

        # 4. ML MODEL OPINION (Text Quality)
        # If Model is confident it's REAL (> 0.7), add points
        # If Model is confident it's FAKE (< 0.4), subtract points
        ml_conf = ml_scores[i]
        if ml_conf > 0.7: score += 10
        elif ml_conf < 0.4: score -= 20      # Likely AI/Spam text

        # 5. USERNAME CHECK (Negative)
        if is_suspicious_name(r.author_name):
            score -= 15

        # 6. CAP SCORE (0 to 100)
        final_score = int(max(0, min(100, score)))
        
        results.append({
            "total": final_score,
            # We return parts so you could debug if you wanted
            "details": {
                "verified": r.verified_purchase,
                "ml_score": float(ml_conf)
            }
        })

    return {"scores": results}
