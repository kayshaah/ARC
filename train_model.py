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
# ⚠️ REPLACE THIS WITH YOUR ACTUAL UCSD FILENAME
UCSD_FILE_PATH = "Clothing_Shoes_and_Jewelry_5.json" 
MODEL_OUTPUT = "arc_model.pkl"
SAMPLE_SIZE = 2000 

def load_data():
    data = []
    # 1. Try loading real data
    if os.path.exists(UCSD_FILE_PATH):
        print(f"Loading real data from {UCSD_FILE_PATH}...")
        with open(UCSD_FILE_PATH, 'r') as f:
            for i, line in enumerate(f):
                if i >= SAMPLE_SIZE: break
                try:
                    row = json.loads(line)
                    data.append({"text": row.get("reviewText", ""), "label": 1}) # 1 = Genuine
                except: continue
    else:
        print("⚠️ Data file not found. Generating DUMMY real data for testing.")
        data = [{"text": "Great fit and good material.", "label": 1} for _ in range(100)]

    df_real = pd.DataFrame(data)

    # 2. Generate Synthetic "Fake" Data (Class 0)
    print("Generating synthetic fake data...")
    fake_templates = [
        "Good product.", "Nice.", "I like it.", "Fast shipping.", "Five stars.",
        "Amazing quality for the price.", "Will buy again.", "Gift for my son."
    ]
    fake_data = []
    for _ in range(len(df_real)):
        text = random.choice(fake_templates) + " " + random.choice(fake_templates)
        fake_data.append({"text": text, "label": 0}) # 0 = Fake/Low Effort

    df_fake = pd.DataFrame(fake_data)
    
    return pd.concat([df_real, df_fake], ignore_index=True)

if __name__ == "__main__":
    df = load_data()
    
    print("Training Model...")
    X_train, X_test, y_train, y_test = train_test_split(df['text'], df['label'], test_size=0.2)
    
    # Simple Pipeline: Text -> Numbers -> Logistic Regression
    model = make_pipeline(TfidfVectorizer(max_features=5000), LogisticRegression())
    model.fit(X_train, y_train)
    
    print("Evaluation:\n", classification_report(y_test, model.predict(X_test)))
    
    with open(MODEL_OUTPUT, 'wb') as f:
        pickle.dump(model, f)
    print(f"✅ Model saved to {MODEL_OUTPUT}")
