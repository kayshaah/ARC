@app.post("/score")
def score(req: ScoreReq):
    if not req.reviews: return {"scores": []}
    
    texts = [(r.review_title or "") + " " + (r.review_body or "") for r in req.reviews]
    scores = []

    # 1. Get Base ML Score
    if model:
        try:
            # predict_proba returns [prob_fake, prob_genuine]
            probs = model.predict_proba(texts)[:, 1]
            scores = [int(p * 100) for p in probs]
        except:
            scores = [50] * len(texts)
    else:
        scores = [50] * len(texts)

    # 2. NO MANUAL BONUS - Let the model decide!
    # We only apply a penalty if it's extremely short (which is suspicious)
    final_scores = []
    for i, s in enumerate(scores):
        text_len = len(texts[i])
        
        # Only penalty: If it's suspiciously short (< 25 chars), cap the score
        if text_len < 25:
            s = min(s, 45) # Cap at 45% (Likely Fake)
            
        final_scores.append(s)

    return {"scores": final_scores}
