import pandas as pd
import json
import pickle
import random
import os
import ast
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
from sentence_transformers import SentenceTransformer

# --- CONFIG ---
UCSD_FILE_PATH = "Appliances.jsonl"
MODEL_OUTPUT = "arc_model.pkl"
SAMPLE_SIZE = 15000 

# --- LOAD DATA (Same as before) ---
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
                
                # Split Real Data:
                # 1. Detailed Real Reviews
                if text_len > 150:
                    real_detailed.append({"text": str(text), "label": 1})
                # 2. Short but SPECIFIC Real Reviews (Hardest category)
                elif text_len < 80 and text_len > 15:
                    real_short.append({"text": str(text), "label": 1})
    
    print(f"✅ Loaded {len(real_detailed)} Detailed & {len(real_short)} Short REAL reviews.")

    # --- ADVANCED FAKE DATA GENERATION ---
    print("🤖 Generating sophisticated fakes...")
    
    # 1. Generic Short Fakes (Easy to catch)
    generic_templates = ["Good.", "Nice.", "I like it.", "Fast shipping.", "Five stars."]
    
    # 2. "Hallucinated" Detailed Fakes (The "Professor" Test)
    # These sound like AI: smooth, lots of adjectives, no specific flaws.
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
        # 50% chance of Short Spam, 50% chance of "AI-Style" Spam
        if random.random() > 0.5:
            fake_text = random.choice(generic_templates) + " " + random.choice(generic_templates)
        else:
            fake_text = random.choice(ai_templates) + " " + random.choice(ai_templates)
        
        fake_data.append({"text": fake_text, "label": 0})

    all_data = real_detailed + real_short + fake_data
    return pd.DataFrame(all_data)

if __name__ == "__main__":
    df = load_data()
    print(f"🧠 Encoding {len(df)} reviews using SentenceTransformers (Deep Learning)...")
    print("   (This might take 1-2 minutes, please wait...)")

    # 1. Load SOTA Transformer Model (Downloads automatically)
    encoder = SentenceTransformer('all-MiniLM-L6-v2')
    
    # 2. Convert Text to Vectors (The "Brain" Upgrade)
    # This turns text into 384 numbers representing MEANING, not just keywords
    embeddings = encoder.encode(df['text'].tolist(), show_progress_bar=True)
    
    # 3. Train Classifier on Embeddings
    X_train, X_test, y_train, y_test = train_test_split(embeddings, df['label'], test_size=0.2)
    
    # Logistic Regression on top of BERT embeddings is a very powerful industry standard
    classifier = LogisticRegression(max_iter=1000)
    classifier.fit(X_train, y_train)
    
    print("📊 Evaluation:\n", classification_report(y_test, classifier.predict(X_test)))
    
    # 4. Save BOTH the Encoder and the Classifier
    # We need to bundle them to load them easily in app.py
    model_bundle = {
        "encoder": encoder,
        "classifier": classifier
    }
    
    with open(MODEL_OUTPUT, 'wb') as f:
        pickle.dump(model_bundle, f)
    print(f"💾 Deep Learning Model saved to {MODEL_OUTPUT}")
