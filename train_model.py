import pandas as pd
import json
import pickle
import random
import os
import ast
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

# CONFIG
UCSD_FILE_PATH = "Appliances.jsonl"
MODEL_OUTPUT = "arc_model.pkl"
SAMPLE_SIZE = 20000 

def load_data():
    real_detailed = []
    real_short = []
    
    print(f"📂 Reading file: {os.path.abspath(UCSD_FILE_PATH)}")

    if not os.path.exists(UCSD_FILE_PATH):
        print("❌ ERROR: File not found!")
        return pd.DataFrame()

    with open(UCSD_FILE_PATH, 'r') as f:
        for i, line in enumerate(f):
            if i >= SAMPLE_SIZE: break
            try:
                row = json.loads(line)
            except:
                try: row = ast.literal_eval(line)
                except: continue

            if row:
                text = row.get("reviewText") or row.get("text") or row.get("body") or ""
                text_len = len(str(text))
                
                # STRATEGY: Split Real Data into "High Quality" and "Low Quality"
                if text_len > 150:
                    # Class 1: Detailed, long reviews
                    real_detailed.append({"text": str(text), "label": 1})
                elif text_len < 60 and text_len > 10:
                    # Class 0: Real but SHORT reviews (treat as Low Trust)
                    real_short.append({"text": str(text), "label": 0})
    
    print(f"✅ Loaded {len(real_detailed)} Detailed reviews (Class 1)")
    print(f"✅ Loaded {len(real_short)} Short/Generic reviews (Class 0)")

    # 2. Add Synthetic "Spam" to Class 0 to make it robust
    print("🤖 Generating synthetic spam...")
    fake_templates = [
        "Good product.", "Nice.", "I like it.", "Fast shipping.", "Five stars.",
        "Amazing quality.", "Will buy again.", "Gift for my son.", "Works great.",
        "Recommended item.", "So happy with this.", "Best deal."
    ]
    synthetic_fakes = []
    # Generate enough fakes to balance the dataset
    target_fakes = len(real_detailed) - len(real_short)
    if target_fakes < 1000: target_fakes = 1000

    for _ in range(target_fakes):
        t = random.choice(fake_templates) + " " + random.choice(fake_templates)
        synthetic_fakes.append({"text": t, "label": 0})

    # Combine all
    all_data = real_detailed + real_short + synthetic_fakes
    return pd.DataFrame(all_data)

if __name__ == "__main__":
    df = load_data()
    
    print(f"🧠 Training on {len(df)} total rows...")
    
    if 'text' not in df.columns: df['text'] = "Dummy"

    X_train, X_test, y_train, y_test = train_test_split(df['text'], df['label'], test_size=0.2)
    
    # We reduce max_features to 2000 to force the model to generalize 
    # (prevents memorizing specific long sentences)
    model = make_pipeline(TfidfVectorizer(max_features=2000, stop_words='english'), LogisticRegression(C=0.5))
    model.fit(X_train, y_train)
    
    print("📊 Evaluation:\n", classification_report(y_test, model.predict(X_test)))
    
    with open(MODEL_OUTPUT, 'wb') as f:
        pickle.dump(model, f)
    print(f"💾 Model saved to {MODEL_OUTPUT}")
