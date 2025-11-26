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

# Load Model on Startup
if os.path.exists(MODEL_PATH):
    with open(MODEL_PATH, 'rb') as f:
        model = pickle.load(f)
    print("✅ Model Loaded")
else:
    print("⚠️ Model not found. Run train_model.py first.")

class ReviewIn(BaseModel):
    review_title: Optional[str] = ""
    review_body: Optional[str] = ""

class ScoreReq(BaseModel):
    reviews: List[ReviewIn]

@app.post("/score")
def score(req: ScoreReq):
    if not req.reviews: return {"scores": []}
    
    texts = [(r.review_title or "") + " " + (r.review_body or "") for r in req.reviews]
    scores = []

    if model:
        # Get probability of Class 1 (Genuine)
        probs = model.predict_proba(texts)[:, 1]
        scores = [int(p * 100) for p in probs]
    else:
        # Fallback if no model
        scores = [50] * len(texts)

    return {"scores": scores}
