# 🚀 ARC — Amazon Review Classifier  
### Hybrid Neuro-Symbolic Fraud Detection for Amazon Reviews

ARC is a hybrid neuro-symbolic AI system that detects deceptive, bot-generated, and AI-written Amazon reviews in **real-time**.  
It powers a Chrome Extension that overlays trust signals directly onto Amazon product pages.

---

## 🌟 Why ARC?

Traditional spam filters rely on keyword matching. ARC goes deeper using:

- **Neural Embeddings (Transformers)**  
- **Ensemble Classification (Gradient Boosting)**  
- **Symbolic Logic Rules**

Result: **92% accuracy**, **0.94 precision**, **0.89 recall**, and real interpretability.

---

# 🔥 Key Features

### 🧠 Neuro-Symbolic Core
Combines SentenceTransformers + GradientBoosting + deterministic logic gates.

### 🤖 AI Hallucination Detection
Trained on adversarial AI-generated review templates.

### 🛑 Trust Ceiling Logic
Hard rule:
```
IF Verified_Purchase == False → Max_Score = 45
```

### 🔍 Real-Time Forensics
Glassmorphism UI overlay showing:
- Suspicious syntax
- Reviewer patterns
- Consistency checks

### 🔒 Privacy-First
All inference is local or self-hosted.

---

# 🧱 System Architecture

```
┌───────────────────────────────┐
│ L1: Transformer Embeddings     │
└───────────────────────────────┘
                 ↓
┌───────────────────────────────┐
│ L2: Ensemble Classifier        │
└───────────────────────────────┘
                 ↓
┌───────────────────────────────┐
│ L3: Symbolic Trust Ceiling     │
└───────────────────────────────┘
```

---

# ⚙️ Installation 

## *Prerequisite - From the UCSD Amazon Dataset download atleast appliances.jsonl.gz file and extract it to the ARC folder. 

## 1️⃣ Backend Setup
```bash
git clone https://github.com/kayshaah/ARC.git
cd ARC

python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate

pip install fastapi uvicorn pandas scikit-learn sentence-transformers
```

### Train Model (first run)
```bash
python train_model.py
```

### Start Server
```bash
uvicorn app:app --reload --port 8001
```

---

## 2️⃣ Chrome Extension Setup
1. Open Chrome → `chrome://extensions/`
2. Enable Developer Mode
3. Load Unpacked → select `ARC-main/`

---

# 🎮 Usage

- Open Amazon product page  
- Scroll to reviews  
- ARC injects trust pill overlay  
- Hover to view forensic breakdown  

### Bot Simulation
ALT + Double Click → injects fake review.

---

# 📊 Performance Metrics

| Metric | Value |
|-------|-------|
| Accuracy | **92%** |
| Precision | **0.94** |
| Recall | **0.89** |
| Latency | **<200ms** |

---

# 📦 Project Structure

```
ARC/
│── app.py
│── train_model.py
│── model.pkl
│── chrome-extension/
│── data/
```

---

# 🙌 Acknowledgments
- UCSD Amazon Dataset
- HuggingFace
- Scikit-Learn

---

# 🏁 Future Enhancements
- Chain-of-thought explainability  
- Reviewer graph anomaly detection  
- Federated local inference  

