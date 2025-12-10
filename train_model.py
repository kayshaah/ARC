import pandas as pd
import json
import pickle
import random
import os
import ast
import numpy as np
# Use Scikit-Learn GradientBoosting (Native & Reliable)
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
from sentence_transformers import SentenceTransformer

# --- CONFIG ---
# List all your dataset files here
# Ensure these files are in the same folder as this script
DATASET_FILES = [
    "Appliances.jsonl",
    "Beauty_and_Personal_Care.jsonl",
    "Toys_and_Games.jsonl",
    "Clothing_Shoes_and_Jewelry.jsonl",
    "Handmade_Products.jsonl"
]

MODEL_OUTPUT = "arc_model.pkl"

# 20,000 per file * 5 files = 100,000 training rows (Heavy Usage - Reducing it for laptop)
SAMPLE_SIZE_PER_FILE = 20000 

# --- LOAD DATA ---
def load_data():
    real_detailed = []
    real_short = []
    
    print(f"🚀 Starting Multi-File Ingestion...")
    
    for filename in DATASET_FILES:
        filepath = os.path.abspath(filename)
        
        if not os.path.exists(filepath):
            print(f"   ⚠️ File not found: {filename} (Skipping)")
            continue

        print(f"   📂 Scanning {filename}...")
        count = 0
        with open(filepath, 'r') as f:
            for i, line in enumerate(f):
                # Stop if we have enough from this category
                if count >= SAMPLE_SIZE_PER_FILE: break
                
                try: row = json.loads(line)
                except: 
                    try: row = ast.literal_eval(line)
                    except: continue

                if row:
                    text = row.get("reviewText") or row.get("text") or row.get("body") or ""
                    text_len = len(str(text))
                    
                    # Smart Filtering: Only keep useful data
                    # 1. Detailed Real Reviews (High Trust Anchors)
                    if text_len > 150:
                        real_detailed.append({"text": str(text), "label": 1})
                        count += 1
                    # 2. Short but SPECIFIC Real Reviews (Hard Negatives)
                    elif text_len < 80 and text_len > 15:
                        real_short.append({"text": str(text), "label": 1})
                        count += 1
        print(f"      -> Added {count} reviews.")
    
    total_real = len(real_detailed) + len(real_short)
    print(f"✅ TOTAL REAL DATA: {total_real} reviews across {len(DATASET_FILES)} categories.")
    
    if total_real == 0:
        print("❌ CRITICAL ERROR: No data loaded. Check your filenames!")
        return pd.DataFrame()

    # --- ADVERSARIAL DATA AUGMENTATION ---
    # We must balance the dataset with an equal number of Fakes
    print(f"🤖 Generating {total_real} adversarial fakes (AI + Spam)...")
    
    generic_templates = ["Good.", "Nice.", "I like it.", "Fast shipping.", "Five stars.", "Ok item.", "Decent quality."]
    
    # "Hallucinated" AI Fakes (High Perplexity, Low Information)
    ai_templates = [
        "This product is absolutely game-changing and I cannot recommend it enough for everyone who needs a solution like this.",
        "The design is sleek and modern, fitting perfectly into my home decor without any issues, and the build quality is top-notch.",
        "I was skeptical at first but after using it for a week I am completely sold on its utility and overall performance.",
        "It arrived in perfect condition and the packaging was very secure and professional, which I really appreciated.",
        "The customer service team was very responsive and helped me with all my questions immediately, making the process smooth."
    ]

    fake_data = []
    
    for _ in range(total_real):
        if random.random() > 0.6:
            # 60% Generic Spam (Short)
            fake_text = random.choice(generic_templates) + " " + random.choice(generic_templates)
        else:
            # 40% AI Hallucinations (Long)
            fake_text = random.choice(ai_templates) + " " + random.choice(ai_templates)
        
        fake_data.append({"text": fake_text, "label": 0})

    # Combine
    all_data = real_detailed + real_short + fake_data
    
    # SHUFFLE DATA
    # This prevents the model from learning "First 10k are appliances, last 10k are toys"
    random.shuffle(all_data)
    
    return pd.DataFrame(all_data)

if __name__ == "__main__":
    df = load_data()
    
    if not df.empty:
        print(f"🧠 Encoding {len(df)} reviews using Transformer [all-MiniLM-L6-v2]...")
        print("   (This captures semantic meaning rather than just keywords)")
        
        # 1. Load Transformer
        encoder = SentenceTransformer('all-MiniLM-L6-v2')
        
        # 2. Vectorize (Heavy Compute Step)
        embeddings = encoder.encode(df['text'].tolist(), show_progress_bar=True)
        
        # 3. Train Ensemble Classifier
        print("🔥 Training Deep Gradient Boosting Classifier (500 Estimators)...")
        X_train, X_test, y_train, y_test = train_test_split(embeddings, df['label'], test_size=0.2)
        
        # High Complexity configuration for demonstration
        classifier = GradientBoostingClassifier(
            n_estimators=500,     # High number of trees = "Heavy" training
            learning_rate=0.05,   # Slow learning = High Precision
            max_depth=8,          # Deep trees = Captures complex non-linear patterns
            verbose=1
        )
        classifier.fit(X_train, y_train)
        
        print("📊 Evaluation Results:\n", classification_report(y_test, classifier.predict(X_test)))
        
        # 4. Save Hybrid Model Bundle
        model_bundle = {
            "encoder": encoder,
            "classifier": classifier
        }
        
        with open(MODEL_OUTPUT, 'wb') as f:
            pickle.dump(model_bundle, f)
        print(f"💾 Neuro-Symbolic Model saved to {MODEL_OUTPUT}")
