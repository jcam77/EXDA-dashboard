"""Backend application entrypoint for the EXDA Flask API."""

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

def _env_flag(name, default=False):
    """Parse a boolean-like environment variable."""
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}

def _cors_origins():
    """Build allowed CORS origins from environment or defaults."""
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
    debug_enabled = _env_flag("EXDA_BACKEND_DEBUG", default=False)
    app.run(debug=debug_enabled, use_reloader=debug_enabled, port=port)
