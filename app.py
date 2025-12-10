from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
import pickle
import os
import re
import numpy as np

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# LOAD DEEP LEARNING MODEL
MODEL_PATH = "arc_model.pkl"
encoder = None
classifier = None

if os.path.exists(MODEL_PATH):
    try:
        with open(MODEL_PATH, 'rb') as f:
            bundle = pickle.load(f)
            encoder = bundle["encoder"]
            classifier = bundle["classifier"]
        print("✅ Deep Learning Model (Transformer) Loaded")
    except Exception as e:
        print(f"❌ Error loading model: {e}")

# DATA MODELS
class ReviewIn(BaseModel):
    review_title: Optional[str] = ""
    review_body: Optional[str] = ""
    verified_purchase: bool = False
    image_count: int = 0
    author_name: Optional[str] = "Unknown"

class ScoreReq(BaseModel):
    reviews: List[ReviewIn]

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
    
    # 1. RUN DEEP LEARNING MODEL
    if encoder and classifier:
        try:
            # Encode text to vectors (Semantic Search)
            embeddings = encoder.encode(texts)
            # Predict
            probs = classifier.predict_proba(embeddings)[:, 1]
            ml_scores = probs
        except Exception as e:
            print(f"Inference Error: {e}")
            pass

    results = []

    for i, r in enumerate(req.reviews):
        score = 50 
        reasons = []

        # --- THE HYBRID FORMULA ---
        
        # 1. METADATA LAYER
        if r.verified_purchase: 
            score += 25
            reasons.append({"icon": "✅", "text": "Verified Purchase"})
        
        if r.image_count > 0: 
            score += 15
            reasons.append({"icon": "📸", "text": "Media verified"})

        # 2. SEMANTIC LAYER (The ML Score)
        ml_conf = ml_scores[i]
        
        # High Confidence Real
        if ml_conf > 0.8: 
            score += 15
            reasons.append({"icon": "🧠", "text": "Writing style analysis: Authentic"})
        # High Confidence Fake
        elif ml_conf < 0.3: 
            score -= 25
            reasons.append({"icon": "🤖", "text": "Writing style analysis: Generic/AI"})

        # 3. BEHAVIORAL LAYER (Username)
        if is_suspicious_name(r.author_name): 
            score -= 15
            history = "Suspicious Profile"
        else:
            history = "Standard Profile"

        # 4. CAP SCORE
        final_score = int(max(0, min(100, score)))
        
        # Labeling
        if final_score < 40: label = "Likely Fake"
        elif final_score < 60: label = "Low Confidence"
        elif final_score >= 90: label = "Highly Authentic"
        else: label = "Feels Genuine"

        results.append({
            "total": final_score,
            "label": label,
            "reasons": reasons,
            "history": history
        })

    return {"scores": results}
