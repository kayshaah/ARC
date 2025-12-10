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
    # 20 GENERIC HALLUCINATED TEMPLATES
    "This product exceeded my expectations in every possible way, and I truly think everyone should try it.",
    "The quality feels premium, and I’m honestly surprised by how well it performs for the price.",
    "I can’t believe I didn’t buy this earlier; it completely changed how I do things.",
    "The build feels sturdy, durable, and very reliable overall.",
    "I’ve used many similar items before, but this one definitely stands out.",
    "Setup was quick and extremely simple, taking only a few minutes.",
    "This offers incredible value with features I didn’t even know I needed.",
    "It works quietly, smoothly, and consistently without any disruption.",
    "The product matches the description perfectly and performs as advertised.",
    "My whole family likes it, and we’ve had no issues so far.",
    "It arrived quickly and the packaging was very secure and professional.",
    "You can tell a lot of attention to detail went into the design.",
    "The interface is intuitive, clean, and easy for anyone to understand.",
    "I’ve never reviewed anything before, but this experience made me want to.",
    "The performance is stable and consistent day after day.",
    "I was initially uncertain, but it turned out to be a great purchase.",
    "It’s surprisingly lightweight yet powerful enough for regular use.",
    "I didn’t expect much at first, but it really impressed me.",
    "The product feels like it should cost much more than it does.",
    "I recommend this to anyone looking for a simple upgrade that works well.",
    # 20 DETAILED AI HALLUCINATED TEMPLATES
    "After using this product for two full weeks, including daily testing under different conditions, I can confidently say it offers consistent performance with virtually no degradation.",
    "The setup instructions were straightforward and included clear diagrams, allowing me to get everything up and running in under five minutes without external tools.",
    "I monitored the device’s performance over multiple hours and noticed that the heat levels remain well within safe operational limits.",
    "The packaging was reinforced with multiple protective layers, ensuring that even fragile internal components were not at risk during transit.",
    "I performed a side-by-side comparison with two competing models, and this product delivered noticeably smoother and more reliable output.",
    "The battery performance remained stable during repeated cycles, with only minimal drain during intensive usage.",
    "I contacted customer support to clarify a minor question, and they provided a detailed explanation within minutes.",
    "I tested the product on various surfaces, and it performed uniformly well without requiring any additional adjustments.",
    "The materials feel high-grade, and there are no manufacturing defects or loose components upon inspection.",
    "I tried integrating the product with several third-party accessories, and all of them worked flawlessly without needing adapters.",
    "The user interface includes contextual hints that guide you through each feature without needing to refer back to the manual.",
    "I tested the product under lower-light conditions, and the responsiveness remained equally accurate.",
    "Throughout multiple test scenarios, I noticed that the noise level remained significantly lower than industry averages.",
    "I ran the product through stress-testing procedures and could not identify any unusual behavior or performance drop-offs.",
    "Even after prolonged usage, the product maintains consistent output without overheating.",
    "The build includes reinforced structural points that enhance durability during repeated use.",
    "I used precise measurements to evaluate alignment and positioning, and everything was within expected tolerances.",
    "The latency is impressively low, allowing the product to operate almost instantaneously.",
    "I experimented with various settings configurations, and each one produced predictable, stable results.",
    "Overall, the product demonstrates a strong balance of efficiency, reliability, and ergonomic design.",
    # 60 MIXED-PATTERN (emotional, pseudo-technical, storytelling, AI-ish)
    "I didn’t expect to enjoy using this as much as I do; it adds a sense of convenience to my daily routine.",
    "The moment I opened the box, I could tell this was made with higher manufacturing standards.",
    "Even after accidentally dropping it, the product continued to work without any noticeable issues.",
    "I tested the product in both warm and cold environments, and it performed consistently in each scenario.",
    "It feels like the manufacturer really thought through all the small details in the design.",
    "I followed the instructions exactly as written and was able to achieve the advertised results effortlessly.",
    "This has become one of those items I didn’t realize I relied on until I started using it every day.",
    "It integrates seamlessly with my existing setup without any compatibility concerns.",
    "The ergonomic design makes it comfortable to use for extended periods.",
    "The product handled multiple back-to-back tasks without slowing down.",
    "I initially bought this as a temporary solution, but I’m considering making it my permanent choice.",
    "The device never once disconnected or malfunctioned during continuous use.",
    "I tracked performance over several days, and the variance remained extremely low.",
    "Its intuitive control layout makes it ideal even for beginners.",
    "I appreciated the detailed manual, which included diagrams and troubleshooting tips.",
    "I used it for both small and large tasks, and the performance remained consistent.",
    "The smooth finish and polished texture give it a premium look and feel.",
    "It maintained stability even when placed on uneven surfaces.",
    "The product automatically adjusted to changes without requiring manual recalibration.",
    "I’ve recommended this to several friends already because of how reliably it performs.",
    "There’s a noticeable improvement in efficiency compared to my older models.",
    "The device immediately paired with my system and required no reconfiguration.",
    "It remained cool to the touch even after extended operation.",
    "I appreciated that the manufacturer included extra accessories in the box.",
    "The product works equally well for both lightweight and heavy-duty tasks.",
    "I was pleasantly surprised to see that firmware updates were available right out of the box.",
    "The interface offers both quick-access controls and deeper customization options.",
    "It feels like a modern upgrade compared to what I used before.",
    "I tried intentionally stressing the device to find weak points, but it held up perfectly.",
    "It feels balanced in the hand and easy to maneuver.",
    "The connectors feel secure and show no signs of loose fitting.",
    "The cleaning process is extremely simple and doesn’t require special tools.",
    "I appreciate how quietly it operates compared to previous versions.",
    "The lighting indicators are clear and easy to understand at a glance.",
    "The product maintained stable output even after repeated cycles.",
    "I tested multiple speed settings, and each one responded precisely as expected.",
    "It performed reliably even when it wasn’t positioned perfectly.",
    "The materials don’t attract dust or fingerprints, which is a nice bonus.",
    "I experienced zero crashes or unexpected shutdowns throughout my testing.",
    "The product connects instantly every time without delay.",
    "It adapts well to various usage patterns without manual switching.",
    "I specially tested for lag under heavy load, and it remained smooth.",
    "The instructions included helpful best-practice tips for long-term use.",
    "The design allows for easy storage without taking up much space.",
    "It functioned exactly the same after a full week of intense usage.",
    "Even at maximum settings, it maintains strong performance.",
    "It’s clear the brand has put thought into user comfort and practicality.",
    "I compared the results with professional-grade equipment and saw minimal difference.",
    "The sensor accuracy remains consistent across multiple tests.",
    "I love how the product balances simplicity with advanced functionality.",
    "The color indicators are well-calibrated and easy to interpret.",
    "I monitored power usage and found it surprisingly energy-efficient.",
    "The product responded instantly to every input, with no noticeable delay.",
    "I tried using it with both new and older accessories, and everything worked well.",
    "It feels sturdy enough to last for years without noticeable wear.",
    "The components fit together tightly with no rattling or gaps.",
    "The results remained consistent no matter how many times I repeated the process.",
    "The product delivers a dependable experience you can rely on daily.",
    "Even after taking a break from using it, I returned and immediately remembered why it’s so convenient.",
    "It’s one of the few products I’ve bought recently that genuinely improves my workflow.",
    "Every feature behaves predictably, which makes the entire experience feel intuitive and reliable."
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
