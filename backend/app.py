"""Backend application entrypoint for the EXDA Flask API."""

from flask import Flask
from flask_cors import CORS
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from routes.projects import projects_bp
from routes.state import state_bp
from routes.calculation_api_routes import calculation_api_bp
from routes.ai import ai_bp
from routes.literature import literature_bp

app = Flask(__name__)

_DEFAULTS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "config",
    "exda-defaults.env",
)


def _load_defaults():
    """Read shared EXDA defaults from config/exda-defaults.env."""
    defaults = {}
    try:
        with open(_DEFAULTS_FILE, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                defaults[key.strip()] = value.strip()
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    return defaults


_DEFAULTS = _load_defaults()


def _setting(name):
    """Resolve env var first, then shared default file."""
    value = os.environ.get(name)
    if value is not None and str(value).strip():
        return str(value).strip()
    fallback_name = f"EXDA_DEFAULT_{name.removeprefix('EXDA_')}"
    fallback = _DEFAULTS.get(fallback_name)
    if fallback:
        return fallback
    raise RuntimeError(
        f"Missing runtime setting '{name}'. Set it via env var or define '{fallback_name}' in {_DEFAULTS_FILE}."
    )

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
    frontend_host = _setting("EXDA_FRONTEND_HOST")
    frontend_port = _setting("EXDA_FRONTEND_PORT")
    return [
        f"http://{frontend_host}:{frontend_port}",
        f"http://localhost:{frontend_port}",
        f"http://127.0.0.1:{frontend_port}",
    ]

CORS(app, resources={r"/*": {"origins": _cors_origins()}})

app.register_blueprint(projects_bp)
app.register_blueprint(state_bp)
app.register_blueprint(calculation_api_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(literature_bp)

if __name__ == '__main__':
    print("🚀 EXDA DASHBOARD ENGINE READY")
    host = _setting("EXDA_BACKEND_HOST")
    port = int(_setting("EXDA_BACKEND_PORT"))
    debug_enabled = _env_flag("EXDA_BACKEND_DEBUG", default=False)
    app.run(host=host, debug=debug_enabled, use_reloader=debug_enabled, port=port)
