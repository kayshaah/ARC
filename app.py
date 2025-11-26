# app.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
import pickle
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = "arc_model.pkl"
model = None

# Load Model
if os.path.exists(MODEL_PATH):
    with open(MODEL_PATH, 'rb') as f:
        model = pickle.load(f)
    print("✅ Model Loaded")
else:
    print("⚠️ Model not found. Run train_model.py")

class ReviewIn(BaseModel):
    review_title: Optional[str] = ""
    review_body: Optional[str] = ""
    verified_purchase: bool = False # <--- We need this!

class ScoreReq(BaseModel):
    reviews: List[ReviewIn]

@app.post("/score")
def score(req: ScoreReq):
    if not req.reviews: return {"scores": []}
    
    texts = [(r.review_title or "") + " " + (r.review_body or "") for r in req.reviews]
    scores = []

    # 1. Get Base ML Score
    if model:
        try:
            probs = model.predict_proba(texts)[:, 1]
            scores = [int(p * 100) for p in probs]
        except:
            scores = [50] * len(texts)
    else:
        scores = [50] * len(texts)

    # 2. Apply "Hybrid" Logic (The Safety Layer)
    final_scores = []
    for i, r in enumerate(req.reviews):
        s = scores[i]
        
        # RULE: Verified Purchases get a Trust Bonus
        if r.verified_purchase:
            s += 30 
        
        # RULE: Very short reviews get a Penalty
        total_len = len(texts[i])
        if total_len < 30:
            s -= 20
        
        # Clamp between 0 and 100
        s = max(1, min(99, s))
        final_scores.append(s)

    return {"scores": final_scores}
