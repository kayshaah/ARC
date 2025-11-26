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
SAMPLE_SIZE = 15000 

def load_data():
    data = []
    print(f"📂 Reading file: {os.path.abspath(UCSD_FILE_PATH)}")

    if not os.path.exists(UCSD_FILE_PATH):
        print("❌ ERROR: File not found! Check the filename.")
        return pd.DataFrame()

    with open(UCSD_FILE_PATH, 'r') as f:
        for i, line in enumerate(f):
            if i >= SAMPLE_SIZE: break
            
            row = None
            # Tactic 1: Try Standard JSON
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                # Tactic 2: Try Python Dictionary (Common in UCSD data)
                try:
                    row = ast.literal_eval(line)
                except:
                    pass

            if row:
                # DEBUG: Print keys for the first row found
                if i == 0:
                    print(f"🔎 First row keys detected: {list(row.keys())}")

                # Tactic 3: Find the text field automatically
                text = row.get("reviewText") or row.get("text") or row.get("body") or ""
                
                if len(str(text)) > 20:
                    data.append({"text": str(text), "label": 1})
            
            if i % 1000 == 0 and i > 0:
                print(f"   ...processed {i} lines")

    print(f"✅ SUCCESSFULLY LOADED {len(data)} REAL REVIEWS.")
    
    # EMERGENCY FALLBACK: If 0 rows, generate dummy data so script doesn't crash
    if len(data) == 0:
        print("⚠️  WARNING: Could not extract data. Using DUMMY data to prevent crash.")
        print("   (Check if your file is empty or has different column names)")
        data = [{"text": "Great product.", "label": 1}, {"text": "Bad product.", "label": 1}]

    df_real = pd.DataFrame(data)

    # Generate Fake Data
    print(f"🤖 Generating {len(df_real)} synthetic fake reviews...")
    fake_templates = ["Good.", "Nice.", "I like it.", "Fast shipping.", "Five stars."]
    fake_data = []
    for _ in range(len(df_real)):
        t = random.choice(fake_templates) + " " + random.choice(fake_templates)
        fake_data.append({"text": t, "label": 0})

    return pd.concat([df_real, pd.DataFrame(fake_data)], ignore_index=True)

if __name__ == "__main__":
    df = load_data()
    
    print("🧠 Training Model...")
    # Ensure 'text' column exists
    if 'text' not in df.columns:
        df['text'] = "Dummy text"
        
    X_train, X_test, y_train, y_test = train_test_split(df['text'], df['label'], test_size=0.2)
    
    model = make_pipeline(TfidfVectorizer(max_features=5000), LogisticRegression())
    model.fit(X_train, y_train)
    
    print("📊 Evaluation:\n", classification_report(y_test, model.predict(X_test)))
    
    with open(MODEL_OUTPUT, 'wb') as f:
        pickle.dump(model, f)
    print(f"💾 Model saved to {MODEL_OUTPUT}")
