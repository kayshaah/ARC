from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
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

# LOAD ML MODEL
MODEL_PATH = "arc_model.pkl"
model = None
if os.path.exists(MODEL_PATH):
    try:
        with open(MODEL_PATH, 'rb') as f:
            model = pickle.load(f)
        print("✅ ML Model Loaded")
    except:
        pass

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
    if "amazon customer" in name: return True
    if re.match(r"user\d{4,}", name): return True
    if re.match(r"^[a-z0-9]{8,}$", name) and not " " in name: return True
    return False

@app.post("/score")
def score(req: ScoreReq):
    if not req.reviews: return {"scores": []}
    
    texts = [(r.review_title or "") + " " + (r.review_body or "") for r in req.reviews]
    ml_scores = [0.5] * len(texts)
    
    if model:
        try:
            probs = model.predict_proba(texts)[:, 1]
            ml_scores = probs
        except:
            pass

    results = []

    for i, r in enumerate(req.reviews):
        score = 50 
        reasons = [] # Collect reasons for the UI

        # 1. VERIFIED PURCHASE
        if r.verified_purchase: 
            score += 25
            reasons.append({"icon": "✅", "text": "Verified Purchase"})
        else:
            reasons.append({"icon": "⚠️", "text": "Unverified Purchase"})
        
        # 2. IMAGES / VIDEO
        if r.image_count > 0: 
            score += 15
            reasons.append({"icon": "📸", "text": "Includes real media"})

        # 3. TEXT DETAIL
        text_len = len(texts[i])
        if text_len > 400: 
            score += 15
            reasons.append({"icon": "📝", "text": "Detailed review"})
        elif text_len < 30: 
            score -= 20
            reasons.append({"icon": "📉", "text": "Suspiciously short text"})

        # 4. ML MODEL OPINION
        ml_conf = ml_scores[i]
        if ml_conf > 0.7: score += 10
        elif ml_conf < 0.4: 
            score -= 20
            reasons.append({"icon": "🤖", "text": "AI-like writing style detected"})

        # 5. USERNAME / HISTORY CHECK
        is_sus = is_suspicious_name(r.author_name)
        if is_sus: 
            score -= 15
            history_status = "Suspicious History"
        else:
            history_status = "Consistent Reviewer"

        # 6. CAP SCORE
        final_score = int(max(0, min(100, score)))
        
        # DETERMINE LABEL
        if final_score < 30: label = "Spam"
        elif final_score < 50: label = "Low Confidence"
        elif final_score >= 90: label = "Highly Authentic"
        else: label = "Feels Genuine"

        results.append({
            "total": final_score,
            "label": label,
            "reasons": reasons,
            "history": history_status
        })

    return {"scores": results}
