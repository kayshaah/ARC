ARC: Amazon Review Classifier (Neuro-Symbolic Fraud Detection)ARC is a hybrid neuro-symbolic system designed to detect deceptive and AI-generated product reviews in real-time. Unlike traditional classifiers that rely on keyword frequency, ARC combines Deep Learning (Transformers) for semantic analysis with Symbolic Logic for behavioral verification, deployed directly into the browser via a Chrome Extension.(Optional: Upload your diagram here)
🚀 Key Features 
Neuro-Symbolic Core: Fuses SentenceTransformers (Neural) with Gradient Boosting (Ensemble) and deterministic guardrails (Symbolic).AI Hallucination Detection: Specifically trained on adversarial data to catch "smooth" AI-generated text that bypasses traditional spam filters.Trust Ceiling Protocol: Enforces rigid penalties for unverified purchases, preventing metadata fraud regardless of text quality.Real-Time Forensics: Injects a "Glassmorphism" overlay into the Amazon DOM, providing explainable AI insights (e.g., "Generic Syntax," "Suspicious Profile").Privacy-First: Reviews are processed locally or via a self-hosted API; no data is sent to third-party cloud services.🛠️ System ArchitectureARC operates on a three-layer pipeline:Layer 1: Semantic Vectorization (The "Neuro" Brain)Model: all-MiniLM-L6-v2 (HuggingFace Transformer).Function: Maps review text to a 384-dimensional dense vector space to capture semantic meaning and context.Layer 2: Ensemble ClassificationModel: Scikit-Learn GradientBoostingClassifier (500 Estimators).Function: Predicts the probability of "Human" vs. "AI/Spam" authorship based on vector embeddings.Layer 3: The Trust Ceiling (Symbolic Logic)Mechanism: Deterministic Python logic gates.Rule: IF Verified_Purchase == False THEN Max_Score = 45.Result: Hard-stops "Brushing" scams where bot accounts post high-quality text without purchase history.

📦 Installation Prerequisites 
Python 3.9+Google Chrome (or Chromium-based browser)1. Backend Setup (The Brain)# Clone the repository
git clone [https://github.com/kayshaah/ARC.git](https://github.com/kayshaah/ARC.git)
cd ARC

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies (ML + API)
pip install fastapi uvicorn pandas scikit-learn sentence-transformers

# Download the UCSD Dataset and put it in the ARC Directory. 

# Train the Neuro-Symbolic Model (First Run Only - This step will take atleast 8 hours.) 
# This downloads the Transformer and fine-tunes Gradient Boosting (~2 hours)
python train_model.py
2. Start the Serveruvicorn app:app --reload --port 8001
You should see: Uvicorn running on http://127.0.0.1:80013. Frontend Setup (The Interface)Open Chrome and navigate to chrome://extensions.Enable "Developer mode" (top right).Click "Load unpacked".Select the ARC-main folder.🎮 Usage Guide Activate: Ensure the server is running (uvicorn ...).Browse: Go to any Amazon product page (e.g., Appliances, Tech).Analyze: Scroll down to the reviews. ARC will inject a color-coded "Trust Pill."
Inspect: Hover over the pill to see the forensic breakdown.
🧪 Live Demo Features (For Testing)Simulate Bot Attack: Hold Alt + Double Click anywhere on the page. ARC will inject a fake "Amazon Customer" review and immediately flag it as Spam (Red).

📊 Performance Metrics
Metric Value Description Accuracy 92% On held-out test set (UCSD Appliances + Adversarial Fakes)
Precision 0.94 Minimal false alarms on genuine reviews
Recall 0.89 High detection rate for AI-generated "Hallucinations" Latency<200ms End-to-end inference time per batch📝.

🤝 Acknowledgments
UCSD Amazon Dataset: Justifying and McAuley (2018).
HuggingFace: For the pre-trained sentence-transformers models.
