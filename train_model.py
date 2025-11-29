import pandas as pd
import json
import pickle
import random
import os
import ast
import numpy as np
from xgboost import XGBClassifier  # <--- The Pro Upgrade
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
from sentence_transformers import SentenceTransformer

# --- CONFIG ---
UCSD_FILE_PATH = "Appliances.jsonl"
MODEL_OUTPUT = "arc_model.pkl"
SAMPLE_SIZE = 15000 

# --- LOAD DATA ---
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
            try: row = json.loads(line)
            except: 
                try: row = ast.literal_eval(line)
                except: continue

            if row:
                text = row.get("reviewText") or row.get("text") or row.get("body") or ""
                text_len = len(str(text))
                
                # 1. Detailed Real Reviews
                if text_len > 150:
                    real_detailed.append({"text": str(text), "label": 1})
                # 2. Short but SPECIFIC Real Reviews
                elif text_len < 80 and text_len > 15:
                    real_short.append({"text": str(text), "label": 1})
    
    print(f"✅ Loaded {len(real_detailed)} Detailed & {len(real_short)} Short REAL reviews.")

    # --- FAKE DATA GENERATION ---
    print("🤖 Generating sophisticated fakes...")
    
    generic_templates = ["Good.", "Nice.", "I like it.", "Fast shipping.", "Five stars."]
    
    ai_templates = [
        "This product is absolutely game-changing and I cannot recommend it enough for everyone.",
        "The design is sleek and modern, fitting perfectly into my home decor without any issues.",
        "I was skeptical at first but after using it for a week I am completely sold on its quality.",
        "It arrived in perfect condition and the packaging was very secure and professional.",
        "The customer service team was very responsive and helped me with all my questions immediately."
    ]

    fake_data = []
    total_real = len(real_detailed) + len(real_short)
    
    for _ in range(total_real):
        if random.random() > 0.5:
            fake_text = random.choice(generic_templates) + " " + random.choice(generic_templates)
        else:
            fake_text = random.choice(ai_templates) + " " + random.choice(ai_templates)
        
        fake_data.append({"text": fake_text, "label": 0})

    all_data = real_detailed + real_short + fake_data
    return pd.DataFrame(all_data)

if __name__ == "__main__":
    df = load_data()
    print(f"🧠 Encoding {len(df)} reviews using SentenceTransformers...")
    
    # 1. Load Transformer
    encoder = SentenceTransformer('all-MiniLM-L6-v2')
    
    # 2. Vectorize
    embeddings = encoder.encode(df['text'].tolist(), show_progress_bar=True)
    
    # 3. Train XGBoost (Gradient Boosting)
    print("🔥 Training XGBoost Classifier...")
    X_train, X_test, y_train, y_test = train_test_split(embeddings, df['label'], test_size=0.2)
    
    # XGBoost configuration for binary classification
    classifier = XGBClassifier(
        n_estimators=100, 
        learning_rate=0.1, 
        max_depth=6, 
        use_label_encoder=False, 
        eval_metric='logloss'
    )
    classifier.fit(X_train, y_train)
    
    print("📊 Evaluation:\n", classification_report(y_test, classifier.predict(X_test)))
    
    # 4. Save Bundle
    model_bundle = {
        "encoder": encoder,
        "classifier": classifier
    }
    
    with open(MODEL_OUTPUT, 'wb') as f:
        pickle.dump(model_bundle, f)
    print(f"💾 XGBoost Model saved to {MODEL_OUTPUT}")
