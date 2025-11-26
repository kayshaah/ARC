# train_model.py
import pandas as pd
import json
import pickle
import random
import os
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

# CONFIG
# MAKE SURE THIS MATCHES YOUR FILENAME EXACTLY
UCSD_FILE_PATH = "Appliances.jsonl" 
MODEL_OUTPUT = "arc_model.pkl"
SAMPLE_SIZE = 15000  # Increased size for better accuracy

def load_data():
    data = []
    real_count = 0
    
    print(f"📂 Looking for data file: {os.path.abspath(UCSD_FILE_PATH)}")

    if os.path.exists(UCSD_FILE_PATH):
        with open(UCSD_FILE_PATH, 'r') as f:
            for i, line in enumerate(f):
                if real_count >= SAMPLE_SIZE: break
                try:
                    # Parse JSON Line
                    row = json.loads(line)
                    # Extract text (UCSD uses 'reviewText' usually)
                    text = row.get("reviewText", "")
                    if len(text) > 20: # Skip empty/short junk
                        data.append({"text": text, "label": 1}) # 1 = Genuine
                        real_count += 1
                except:
                    continue
        print(f"✅ SUCCESSFULLY LOADED {real_count} REAL REVIEWS.")
    else:
        print("❌ ERROR: FILE NOT FOUND!")
        print("⚠️  Generating DUMMY data (Model will be bad!)")
        # Fallback only if file missing
        data = [{"text": "Great product fits well.", "label": 1} for _ in range(100)]

    df_real = pd.DataFrame(data)

    # 2. Generate Synthetic "Fake" Data
    print(f"🤖 Generating {len(df_real)} synthetic fake reviews...")
    fake_templates = [
        "Good.", "Nice.", "I like it.", "Fast shipping.", "Five stars.",
        "Amazing quality.", "Will buy again.", "Gift for my son.", "Works great.",
        "Recommended item.", "So happy with this.", "Best deal."
    ]
    fake_data = []
    for _ in range(len(df_real)):
        # Construct a generic fake review
        t1 = random.choice(fake_templates)
        t2 = random.choice(fake_templates)
        fake_data.append({"text": f"{t1} {t2}", "label": 0})

    df_fake = pd.DataFrame(fake_data)
    
    return pd.concat([df_real, df_fake], ignore_index=True)

if __name__ == "__main__":
    df = load_data()
    
    print("🧠 Training Model (TF-IDF + Logistic Regression)...")
    X_train, X_test, y_train, y_test = train_test_split(df['text'], df['label'], test_size=0.2)
    
    model = make_pipeline(TfidfVectorizer(max_features=5000), LogisticRegression())
    model.fit(X_train, y_train)
    
    print("📊 Evaluation:\n", classification_report(y_test, model.predict(X_test)))
    
    with open(MODEL_OUTPUT, 'wb') as f:
        pickle.dump(model, f)
    print(f"💾 Model saved to {MODEL_OUTPUT}")
