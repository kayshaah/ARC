from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
import pickle
import os

# 1. Initialize the App (This must happen first!)
app = FastAPI()

# 2. Setup Permissions (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Load the Model
MODEL_PATH = "arc_model.pkl"
model = None

if os.path.exists(MODEL_PATH):
    try:
        with open(MODEL_PATH, 'rb') as f:
            model = pickle.load(f)
        print("✅ Model Loaded Successfully")
    except Exception as e:
        print(f"❌ Error loading pickle file: {e}")
else:
    print("⚠️ Model not found. Make sure to run train_model.py first.")

# 4. Define Data Structures
class ReviewIn(BaseModel):
    review_title: Optional[str] = ""
    review_body: Optional[str] = ""
    verified_purchase: bool = False

class ScoreReq(BaseModel):
    reviews: List[ReviewIn]

# 5. Define Endpoints
@app.post("/score")
def score(req: ScoreReq):
    if not req.reviews: return {"scores": []}
    
    texts = [(r.review_title or "") + " " + (r.review_body or "") for r in req.reviews]
    scores = []

    # Get ML Score
    if model:
        try:
            # predict_proba returns [prob_fake, prob_genuine]
            probs = model.predict_proba(texts)[:, 1]
            scores = [int(p * 100) for p in probs]
        except Exception as e:
            print(f"Prediction Error: {e}")
            scores = [50] * len(texts)
    else:
        scores = [50] * len(texts)

    # Post-Processing: Penalty for extremely short text only
    final_scores = []
    for i, s in enumerate(scores):
        text_len = len(texts[i])
        
        # If text is suspiciously short (< 25 chars), cap the score
        if text_len < 25:
            s = min(s, 45) 
            
        final_scores.append(s)

    return {"scores": final_scores}

@app.post("/ingest")
def ingest(req: ScoreReq):
    # Placeholder to prevent 404 errors if extension calls this
    return {"status": "ok"}
