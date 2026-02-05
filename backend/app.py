from flask import Flask
from flask_cors import CORS
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from routes.projects import projects_bp
from routes.state import state_bp
from routes.analysis import analysis_bp
from routes.ai import ai_bp
from routes.literature import literature_bp

app = Flask(__name__)

def _cors_origins():
    raw = os.environ.get("EXDA_CORS_ORIGINS", "")
    if raw.strip():
        return [o.strip() for o in raw.split(",") if o.strip()]
    return ["http://localhost:5173", "http://127.0.0.1:5173"]

CORS(app, resources={r"/*": {"origins": _cors_origins()}})

app.register_blueprint(projects_bp)
app.register_blueprint(state_bp)
app.register_blueprint(analysis_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(literature_bp)

if __name__ == '__main__':
    print("🚀 EXDA DASHBOARD ENGINE READY")
    port = int(os.environ.get("EXDA_BACKEND_PORT", "5000"))
    app.run(debug=True, port=port)
