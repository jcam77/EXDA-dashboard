
"""AiRA routes and helpers for model listing, SSE chat, and repo context snapshots."""

from flask import Blueprint, jsonify, request, Response
import json
import os
import re
import socket
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from urllib import error as urllib_error
from urllib.parse import urlparse
from urllib.request import urlopen

from modules import project_manager

ai_bp = Blueprint("ai", __name__)

APP_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO_CONTEXT_MAX_CHARS = int(os.environ.get("EXDA_REPO_CONTEXT_MAX_CHARS", "7000"))
REPO_CONTEXT_TTL_SECONDS = int(os.environ.get("EXDA_REPO_CONTEXT_TTL", "120"))
RELEVANT_REPO_CONTEXT_MAX_CHARS = int(os.environ.get("EXDA_RELEVANT_REPO_CONTEXT_MAX_CHARS", "24000"))
RELEVANT_REPO_CONTEXT_MAX_FILES = int(os.environ.get("EXDA_RELEVANT_REPO_CONTEXT_MAX_FILES", "8"))
RELEVANT_REPO_FILE_READ_MAX_CHARS = int(os.environ.get("EXDA_RELEVANT_REPO_FILE_READ_MAX_CHARS", "80000"))
RELEVANT_REPO_EXCERPT_MAX_CHARS = int(os.environ.get("EXDA_RELEVANT_REPO_EXCERPT_MAX_CHARS", "2200"))
RELEVANT_REPO_DOC_EXCERPT_MAX_CHARS = int(os.environ.get("EXDA_RELEVANT_REPO_DOC_EXCERPT_MAX_CHARS", "7000"))
DYNAMIC_CITED_PATH_CONTEXT_MAX_CHARS = int(os.environ.get("EXDA_DYNAMIC_CITED_PATH_CONTEXT_MAX_CHARS", "12000"))
REPO_SCAN_IGNORE_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "dist",
    "build",
    "dist-electron",
    "playwright-report",
    "test-results",
    "test-report-results",
    "Projects",
    "Demo Projects",
    "appsTestEnvironment",
    "appsTestEnviroment",
}
REPO_SCAN_ALLOW_HIDDEN_DIRS = {".github"}
REPO_SCAN_IGNORE_PREFIXES = ("._",)
REPO_RETRIEVAL_SUFFIXES = (
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".css",
    ".md",
    ".json",
    ".sh",
    ".ps1",
    ".yml",
    ".yaml",
    ".txt",
)
REPO_RETRIEVAL_SKIP_FILES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
}
REPO_QUERY_STOP_WORDS = {
    "about", "above", "after", "again", "also", "and", "any", "are", "because",
    "been", "but", "can", "could", "does", "for", "from", "have", "how", "into",
    "its", "just", "like", "max", "more", "not", "now", "only", "our", "please", "point", "points", "show",
    "that", "the", "then", "there", "this", "use", "using", "was", "what", "when",
    "where", "which", "who", "why", "with", "would", "you", "your",
}
REPO_QUERY_TERM_EXPANSIONS = {
    "downsampling": ("downsample", "downsampled", "decimation", "maxpoints", "max_points", "max_samples", "linspace", "read_project_file", "preview_multichannel"),
    "downsample": ("downsampling", "downsampled", "decimation", "maxpoints", "max_points", "max_samples", "linspace", "read_project_file", "preview_multichannel"),
    "downsampled": ("downsample", "downsampling", "decimation", "maxpoints", "max_points", "max_samples", "linspace", "read_project_file", "preview_multichannel"),
    "visualisation": ("visualization", "plot", "preview", "chart", "screening"),
    "visualization": ("visualisation", "plot", "preview", "chart", "screening"),
    "optimise": ("optimize", "performance", "preview", "plot"),
    "optimize": ("optimise", "performance", "preview", "plot"),
    "plotting": ("plot", "preview", "chart"),
    "plots": ("plot", "preview", "chart"),
}
UNSUPPORTED_IMPLEMENTATION_CLAIM_PATTERNS = (
    (
        re.compile(r"\b(?:minimum[-\s]*maximum|min[-\s]*max|max[-\s]*min)\b", re.IGNORECASE),
        "min-max/bucket envelope downsampling",
    ),
    (
        re.compile(r"\bbuckets?\b|\bbucketing\b", re.IGNORECASE),
        "bucket-based downsampling",
    ),
    (
        re.compile(r"\bmedian\b", re.IGNORECASE),
        "median downsampling",
    ),
    (
        re.compile(r"\binterpolat(?:e|ed|es|ion|ing)\b|\bnp\.interp\b|\bnumpy(?:'s|’s)?\s+interp\b", re.IGNORECASE),
        "interpolation-based downsampling",
    ),
    (
        re.compile(r"\bresampl(?:e|ed|es|ing)\b|\blower,\s*uniformly\s*spaced\s*grid\b", re.IGNORECASE),
        "resampling-to-grid downsampling",
    ),
    (
        re.compile(r"\bmean\b|\baverage(?:d|s|ing)?\b", re.IGNORECASE),
        "mean/average downsampling",
    ),
    (
        re.compile(r"\blttb\b|\blargest[-\s]*triangle\b", re.IGNORECASE),
        "LTTB downsampling",
    ),
    (
        re.compile(r"\bpoints?\s*per\s*pixel\b|\bpixel\s*width\b", re.IGNORECASE),
        "pixel-width/points-per-pixel target",
    ),
    (
        re.compile(r"(?:~|≈|about|around|commonly)?\s*\b5\s*,?\s*000\b", re.IGNORECASE),
        "5,000-point visualization default",
    ),
    (
        re.compile(
            r"\bbuilt[-\s]*in.{0,40}\bdownsample\b|\buplot(?:'s|’s)?\s+built[-\s]*in\b|\buplot\b.{0,80}\bdownsample\b|\bsamples\s+option\b|\binternal\s+point[-\s]*reduction\b|\bnative\s+sampling\s+options?\b",
            re.IGNORECASE,
        ),
        "chart-library sampling/downsampling speculation",
    ),
    (
        re.compile(r"\brecharts\b", re.IGNORECASE),
        "Recharts plotting/downsampling path",
    ),
    (
        re.compile(r"\bpressureanalysisworkbench(?:\.jsx)?\b|\bflamespeedanalysis(?:\.jsx)?\b", re.IGNORECASE),
        "unsupported analysis component path",
    ),
    (
        re.compile(r"\bconfig/visuali[sz]ation\.json\b|\bsettings dialog\b", re.IGNORECASE),
        "unsupported visualization configuration source",
    ),
    (
        re.compile(r"\bmvp mode\b.{0,120}\bdown[-\s]*sampling\b|\bmvp mode\b.{0,120}\bheavy[-\s]*duty\b", re.IGNORECASE),
        "unsupported MVP-mode/downsampling behavior",
    ),
)
FALSE_MISSING_EVIDENCE_PATTERNS = (
    (
        re.compile(
            r"\b(?:does\s+not\s+expose|not\s+exposed|not\s+present|not\s+shown|cannot\s+be\s+confirmed|without\s+concrete\s+code\s+references|lack\s+of\s+source\s+evidence)\b",
            re.IGNORECASE,
        ),
        "selected source/docs were ignored or described as unavailable",
    ),
    (
        re.compile(
            r"\b(?:review|inspect|search|locate)\b.{0,80}\b(?:documentation|docs/|repository|source|frontend|backend)\b",
            re.IGNORECASE,
        ),
        "speculative next step asks to search sources that were already retrieved",
    ),
)
_REPO_CONTEXT_CACHE = {
    "context": "",
    "generated_at": 0.0,
}
_STRUCTURED_EXECUTOR = ThreadPoolExecutor(max_workers=2)
DEFAULT_AI_MODEL = os.environ.get("EXDA_DEFAULT_AI_MODEL", "").strip()
PREFERRED_AI_MODELS = tuple(
    model for model in [
        DEFAULT_AI_MODEL,
        "gpt-oss:20b-cloud",
        "gpt-oss:120b-cloud",
        "minimax-m3:cloud",
        "nemotron-3-super:cloud",
    ]
    if model
)
IMPROVEMENT_QUERY_HINTS = (
    "improve",
    "improvement",
    "improvements",
    "review",
    "refactor",
    "optimize",
    "bug",
    "issue",
    "fix",
    "tech debt",
    "technical debt",
    "architecture review",
    "code quality",
    "how can",
)
IMPROVEMENT_REPORT_INSTRUCTIONS = (
    "IMPROVEMENT REPORT MODE:\n"
    "If the user asks about app quality, improvements, architecture risks, or what should be changed, "
    "respond using this exact structure.\n"
    "1) Start with a heading: ## Improvement Findings.\n"
    "2) List findings ordered by severity: Critical, High, Medium, Low.\n"
    "3) For each finding, use this block:\n"
    "### [Severity] Short Title\n"
    "- File: `<repo/path>` (required)\n"
    "- Issue: concise defect/risk statement\n"
    "- Impact: what can break or degrade\n"
    "- Recommendation: concrete fix direction\n"
    "- Suggested Patch:\n"
    "```diff\n"
    "--- a/<repo/path>\n"
    "+++ b/<repo/path>\n"
    "@@\n"
    "- old line(s)\n"
    "+ new line(s)\n"
    "```\n"
    "4) Include only findings you can justify from APPLICATION CODEBASE CONTEXT.\n"
    "5) If evidence is insufficient, say exactly what file/context is missing.\n"
    "6) After findings, include: ## Quick Wins with up to 5 bullet items."
)
MAIN_CALCULATION_FILES = [
    ("backend/modules/pressure_analysis.py", "Pressure metrics pipeline (pMax, tMax, impulse, vent timing, filtering)."),
    ("backend/modules/flame_analysis.py", "Flame-speed computation from probe crossings and dx/dt."),
    ("backend/modules/ewt_analysis.py", "EWT modal decomposition, energy spectrum, and cutoff suggestion."),
    ("backend/modules/plot_interpolation.py", "Interpolation/aggregation for cross-case comparison plots."),
    ("backend/routes/calculation_api_routes.py", "Calculation API dispatcher and numeric parameter plumbing."),
    ("backend/tests/test_calculations_reference.py", "Reference verification tests for calculation/API parity and filtering behavior."),
    ("backend/tests/scripts/comparison/octave/verify_ewt_peak_metrics_octave.m", "Octave script comparing EWT mode peak frequencies against Python reference."),
]
APP_STRUCTURE_FILES = [
    ("frontend/src/main.jsx", "Frontend entry point that mounts AppShell."),
    ("frontend/src/app/AppShell.jsx", "Router shell selecting BrowserRouter/HashRouter for desktop packaging."),
    ("frontend/src/features/workspace/WorkspacePage.jsx", "Main workspace orchestrator with navigation tabs, MVP mode gating, project open/save, and shared state."),
    ("frontend/src/features/workspace/hooks/useAnalysisPipeline.js", "Shared analysis orchestration for pressure/EWT/flame tabs."),
    ("frontend/src/features/analysis/PressureAnalysisWorkbench.jsx", "Shared pressure plotting/controls used by two tabs."),
    ("frontend/src/pages/PressureAnalysis.jsx", "Pressure Analysis tab page wrapper (experiments mode)."),
    ("frontend/src/pages/CFDValidation.jsx", "CFD Validation tab page wrapper (validation mode)."),
    ("frontend/src/pages/AppCalculationsVerification.jsx", "Verification page plotting clean/noisy fixtures and Python-vs-MATLAB metric comparisons."),
    ("frontend/src/pages/EwtAnalysis.jsx", "Empirical Wavelet Transform (EWT) analysis page."),
    ("frontend/src/pages/FlameSpeedAnalysis.jsx", "Flame speed analysis page."),
    ("frontend/src/pages/ImportData.jsx", "Import Data tab page."),
    ("frontend/src/pages/SensorsMapping.jsx", "Sensors Mapping tab for group-based DAQ/sensor location and calibration metadata."),
    ("frontend/src/pages/CamerasMapping.jsx", "Cameras Mapping tab for group-based camera hardware metadata, optical method, exposure settings, coordinates, trigger mode/sync, emissivity, and temperature range."),
    ("frontend/src/pages/GasMixing.jsx", "Gas Mixing tab page."),
    ("frontend/src/pages/Report.jsx", "Report tab that exports consolidated project metadata reports."),
    ("backend/routes/state.py", "Project state, metadata persistence, report exports, and mapping artifact routes."),
    ("frontend/src/pages/AiRA.jsx", "AiRA chat UI and streaming client."),
    ("backend/routes/ai.py", "AiRA backend route, prompt context, and repo snapshot generation."),
]


"""
AiRA Ollama host resolution strategy (portable defaults):

1) OLLAMA_HOST (full URL) if explicitly set.
2) OLLAMA_IP (+ OLLAMA_PORT) if set.
3) OLLAMA_HOSTNAME / MAC_HOSTNAME (+ OLLAMA_PORT) if set and resolvable.
4) Optional local override file `.ollama_hostname` if present and resolvable.
5) Auto-probe common local/VM hosts (localhost, Docker host aliases,
   default Linux gateway, and common VM host-only addresses).
6) localhost fallback: http://localhost:11434

For normal user installs (EXDA + Ollama on the same machine), no extra
configuration is needed; localhost is the intended default.
"""

def _hostname_resolves(hostname):
    """Return True when hostname resolves via local DNS lookup."""
    if not hostname:
        return False
    try:
        socket.gethostbyname(hostname)
        return True
    except OSError:
        return False


def _read_linux_default_gateway():
    """Return Linux default-gateway IP from /proc/net/route when available."""
    route_path = "/proc/net/route"
    if not os.path.exists(route_path):
        return None

    try:
        with open(route_path, "r", encoding="utf-8") as route_file:
            for line in route_file.readlines()[1:]:
                fields = line.strip().split()
                if len(fields) < 3:
                    continue
                destination_hex = fields[1]
                gateway_hex = fields[2]
                if destination_hex != "00000000":
                    continue
                gateway_raw = bytes.fromhex(gateway_hex)
                return socket.inet_ntoa(gateway_raw[::-1])
    except Exception:
        return None

    return None


def _read_hostname_file():
    """Read optional advanced hostname override from local .ollama_hostname."""
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    hostname_path = os.path.join(project_root, ".ollama_hostname")
    try:
        with open(hostname_path, "r", encoding="utf-8") as f:
            hostname = f.read().strip()
        return hostname or None
    except FileNotFoundError:
        return None
    except Exception as exc:
        print(f"[WARN] Could not read .ollama_hostname: {exc}")
        return None


def _probe_ollama_host(host_url, timeout_seconds=0.45):
    """Return True if an Ollama API endpoint appears reachable at host_url."""
    try:
        probe_url = f"{host_url.rstrip('/')}/api/tags"
        with urlopen(probe_url, timeout=timeout_seconds) as response:
            return 200 <= int(getattr(response, "status", 200)) < 300
    except (urllib_error.URLError, ValueError, OSError):
        return False


def _unique_preserve_order(values):
    """Return values without duplicates while preserving input order."""
    unique_values = []
    seen = set()
    for value in values:
        if not value:
            continue
        if value in seen:
            continue
        unique_values.append(value)
        seen.add(value)
    return unique_values


def _resolve_ollama_host():
    """Resolve Ollama host URL from env vars, hostname file, or reachable defaults."""
    port = os.environ.get("OLLAMA_PORT", "11434")
    env_host = os.environ.get("OLLAMA_HOST")
    if env_host:
        return env_host

    env_ip = os.environ.get("OLLAMA_IP")
    if env_ip:
        return f"http://{env_ip}:{port}"

    env_hostname = os.environ.get("OLLAMA_HOSTNAME") or os.environ.get("MAC_HOSTNAME")
    if env_hostname and _hostname_resolves(env_hostname):
        return f"http://{env_hostname}:{port}"

    file_hostname = _read_hostname_file()
    if file_hostname and _hostname_resolves(file_hostname):
        return f"http://{file_hostname}:{port}"

    autodiscovery_hosts = [
        "localhost",
        "127.0.0.1",
        "host.docker.internal",
        "host.internal",
        _read_linux_default_gateway(),
        "10.211.55.2",  # Parallels host-only default
        "10.0.2.2",     # VirtualBox NAT host default
    ]
    for candidate in _unique_preserve_order(autodiscovery_hosts):
        if "." in candidate and not candidate.replace(".", "").isdigit():
            if not _hostname_resolves(candidate):
                continue
        host_url = f"http://{candidate}:{port}"
        if _probe_ollama_host(host_url):
            return host_url

    return f"http://localhost:{port}"


def _log_resolved_ip(host_url):
    """Log resolved host IP for easier VM/network diagnostics."""
    try:
        parsed = urlparse(host_url)
        hostname = parsed.hostname
        if not hostname:
            return
        ip = socket.gethostbyname(hostname)
        print(f"[INFO] Ollama host resolved to: {ip}")
        if ip.startswith("10.211.55."):
            print("[INFO] VM note: 10.211.55.x is the Parallels host-only network (expected).")
    except Exception:
        return

try:
    from ollama import Client
    ollama_host = _resolve_ollama_host()
    print(f"[INFO] Using Ollama host: {ollama_host}")
    _log_resolved_ip(ollama_host)
    client = Client(host=ollama_host)
    HAS_OLLAMA = True
except ImportError:
    client = None
    HAS_OLLAMA = False
    print("⚠️ WARNING: 'ollama' not installed. AI endpoints will be limited.")

# --- FAIL-SAFE PDF IMPORT ---
try:
    import fitz  # PyMuPDF
    HAS_PDF_LIB = True
except ImportError:
    HAS_PDF_LIB = False
    print("⚠️ WARNING: 'pymupdf' not installed. Project will load, but AI cannot read PDF content.")


def get_pdf_context(project_path):
    """Extract truncated text context from project Literature PDFs."""
    if not HAS_PDF_LIB or not project_path or project_path == 'Unknown':
        return ""

    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return ""

    literature_dir = os.path.realpath(os.path.join(project_root, "Literature"))
    if not os.path.exists(literature_dir):
        return ""
    if not project_manager.is_path_within(project_root, literature_dir):
        return ""

    all_pdf_data = []
    for root, dirs, files in os.walk(literature_dir):
        dirs[:] = [
            directory
            for directory in dirs
            if not directory.startswith(".")
            and project_manager.is_path_within(literature_dir, os.path.join(root, directory))
            and project_manager.is_path_within(project_root, os.path.join(root, directory))
        ]
        for filename in files:
            if filename.lower().endswith(".pdf"):
                rel_path = os.path.relpath(os.path.join(root, filename), literature_dir)
                file_path = os.path.realpath(os.path.join(root, filename))
                if (
                    not project_manager.is_path_within(literature_dir, file_path)
                    or not project_manager.is_path_within(project_root, file_path)
                ):
                    continue
                try:
                    with fitz.open(file_path) as doc:
                        text = ""
                        for page in doc[:3]:
                            text += page.get_text()
                        all_pdf_data.append({
                            "name": rel_path,
                            "content": text
                        })
                except Exception as e:
                    print(f"Error reading PDF {rel_path}: {e}")

    manifest = f"SYSTEM MESSAGE: Your library contains {len(all_pdf_data)} PDF files across categories: "
    manifest += ", ".join([p['name'] for p in all_pdf_data])

    context_text = manifest + "\n\n"
    for item in all_pdf_data:
        context_text += f"\n--- CONTENT START: {item['name']} ---\n{item['content']}\n--- CONTENT END: {item['name']} ---\n"

    return context_text[:15000]


def _should_skip_dir(name):
    """Return True when directory should be excluded from repository scans."""
    if not name:
        return True
    if name in REPO_SCAN_ALLOW_HIDDEN_DIRS:
        return False
    if name in REPO_SCAN_IGNORE_DIRS:
        return True
    if name.startswith("."):
        return True
    if name.startswith(REPO_SCAN_IGNORE_PREFIXES):
        return True
    return False


def _should_skip_file(name):
    """Return True when file should be excluded from repository scans."""
    if not name:
        return True
    if name.startswith(REPO_SCAN_IGNORE_PREFIXES):
        return True
    if name.startswith("."):
        return True
    return False


def _collect_files(base_rel, suffixes, max_depth=3, max_items=80):
    """Collect repository file paths with depth, suffix, and item limits."""
    base_abs = os.path.join(APP_ROOT, base_rel)
    if not os.path.isdir(base_abs):
        return []
    suffixes = tuple(s.lower() for s in suffixes) if suffixes else ()
    collected = []
    for current, dirs, files in os.walk(base_abs):
        rel_from_base = os.path.relpath(current, base_abs)
        depth = 0 if rel_from_base == "." else rel_from_base.count(os.sep) + 1
        if depth > max_depth:
            dirs[:] = []
            continue
        dirs[:] = [d for d in sorted(dirs) if not _should_skip_dir(d)]
        for filename in sorted(files):
            if _should_skip_file(filename):
                continue
            if suffixes and not filename.lower().endswith(suffixes):
                continue
            rel_file = os.path.relpath(os.path.join(current, filename), APP_ROOT).replace("\\", "/")
            collected.append(rel_file)
            if len(collected) >= max_items:
                return collected
    return collected


def _top_level_entries(max_items=40):
    """Return visible top-level repository entries."""
    try:
        names = sorted(os.listdir(APP_ROOT))
    except Exception:
        return []
    entries = []
    for name in names:
        if _should_skip_file(name):
            continue
        full = os.path.join(APP_ROOT, name)
        suffix = "/" if os.path.isdir(full) else ""
        entries.append(f"{name}{suffix}")
        if len(entries) >= max_items:
            break
    return entries


def _extract_backend_endpoints(max_items=80):
    """Parse Flask route decorators and return endpoint summaries."""
    routes_dir = os.path.join(APP_ROOT, "backend", "routes")
    if not os.path.isdir(routes_dir):
        return []
    route_pattern = re.compile(
        r"@\w+\.route\(\s*['\"]([^'\"]+)['\"](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?"
    )
    method_pattern = re.compile(r"['\"]([A-Z]+)['\"]")
    found = []
    for filename in sorted(os.listdir(routes_dir)):
        if not filename.endswith(".py") or filename.startswith("."):
            continue
        file_path = os.path.join(routes_dir, filename)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                text = f.read()
        except Exception:
            continue
        rel = os.path.relpath(file_path, APP_ROOT).replace("\\", "/")
        for match in route_pattern.finditer(text):
            path = match.group(1)
            raw_methods = match.group(2) or ""
            methods = method_pattern.findall(raw_methods) or ["GET"]
            found.append(f"{','.join(methods)} {path} ({rel})")
            if len(found) >= max_items:
                break
        if len(found) >= max_items:
            break
    return sorted(set(found))


def _read_npm_scripts(max_items=24):
    """Read and format package.json scripts for prompt context."""
    package_path = os.path.join(APP_ROOT, "package.json")
    try:
        with open(package_path, "r", encoding="utf-8") as f:
            pkg = json.load(f)
    except Exception:
        return []
    scripts = pkg.get("scripts") or {}
    items = []
    for name in sorted(scripts.keys()):
        cmd = " ".join(str(scripts[name]).split())
        if len(cmd) > 92:
            cmd = f"{cmd[:89]}..."
        items.append(f"{name}: {cmd}")
        if len(items) >= max_items:
            break
    return items


def _main_calculation_file_lines():
    """Return labeled lines for the main backend calculation files."""
    return [f"- {path}: {description}" for path, description in MAIN_CALCULATION_FILES]


def _app_structure_file_lines():
    """Return labeled lines for key frontend/backend structure files."""
    return [f"- {path}: {description}" for path, description in APP_STRUCTURE_FILES]


def _read_repo_text(relative_path, max_chars=RELEVANT_REPO_FILE_READ_MAX_CHARS):
    """Read a bounded text file from the repository."""
    safe_path = os.path.normpath(relative_path).lstrip(os.sep)
    safe_rel_path = safe_path.replace("\\", "/")
    if safe_rel_path == "backend/routes/state.py":
        max_chars = max(max_chars, 220000)
    file_path = os.path.join(APP_ROOT, safe_path)
    if not project_manager.is_path_within(APP_ROOT, file_path):
        return ""
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            content = handle.read()
    except Exception:
        return ""
    if len(content) > max_chars:
        return f"{content[:max_chars]}\n\n[File truncated for prompt size.]"
    return content


def _is_retrievable_repo_path(relative_path):
    """Return True when a referenced repo path exists and is safe to read."""
    if not relative_path:
        return False
    rel_path = os.path.normpath(str(relative_path).strip()).lstrip(os.sep).replace("\\", "/")
    filename = os.path.basename(rel_path)
    if not filename or _should_skip_file(filename):
        return False
    if filename in REPO_RETRIEVAL_SKIP_FILES:
        return False
    if not filename.lower().endswith(REPO_RETRIEVAL_SUFFIXES):
        return False
    abs_path = os.path.join(APP_ROOT, rel_path)
    if not project_manager.is_path_within(APP_ROOT, abs_path):
        return False
    return os.path.isfile(abs_path)


def _expand_repo_query_terms(terms, max_terms=24):
    """Add conservative source-code synonyms so retrieval finds real implementation files."""
    expanded = []
    for term in terms:
        if term not in expanded:
            expanded.append(term)
        for extra in REPO_QUERY_TERM_EXPANSIONS.get(term, ()):
            if extra not in expanded:
                expanded.append(extra)
        if len(expanded) >= max_terms:
            break
    return expanded[:max_terms]


def _tokenize_repo_query(text, max_terms=16):
    """Extract search terms for repository retrieval."""
    raw_terms = re.findall(r"[a-zA-Z0-9_./%-]+", (text or "").lower())
    terms = []
    for term in raw_terms:
        cleaned = term.strip("._/%-")
        if len(cleaned) < 3:
            continue
        if cleaned in REPO_QUERY_STOP_WORDS:
            continue
        if cleaned not in terms:
            terms.append(cleaned)
        if len(terms) >= max_terms:
            break
    return _expand_repo_query_terms(terms)


def _iter_retrievable_repo_files():
    """Yield text/code files that AiRA is allowed to inspect for app answers."""
    for current, dirs, files in os.walk(APP_ROOT):
        dirs[:] = [d for d in sorted(dirs) if not _should_skip_dir(d)]
        for filename in sorted(files):
            if _should_skip_file(filename):
                continue
            if filename in REPO_RETRIEVAL_SKIP_FILES:
                continue
            if not filename.lower().endswith(REPO_RETRIEVAL_SUFFIXES):
                continue
            abs_path = os.path.join(current, filename)
            if not project_manager.is_path_within(APP_ROOT, abs_path):
                continue
            rel_path = os.path.relpath(abs_path, APP_ROOT).replace("\\", "/")
            yield rel_path


def _is_repo_doc_path(rel_path):
    """Return True for repository documentation files that should be read first."""
    return str(rel_path or "").startswith("docs/") and str(rel_path or "").lower().endswith(".md")


def _score_repo_file(rel_path, content, query_terms):
    """Score a repository file against the user's question."""
    if not query_terms:
        return 0
    if rel_path == "backend/routes/ai.py":
        ai_terms = {"aira", "ai", "ollama", "model", "models", "assistant", "chat", "prompt"}
        if not any(term in ai_terms for term in query_terms):
            return 0
    rel_lower = rel_path.lower()
    content_lower = content.lower()
    score = 0
    for term in query_terms:
        if term in rel_lower:
            score += 25
        count = content_lower.count(term)
        if count:
            score += min(count, 12)
            if content_lower.find(term) < 1200:
                score += 4
    if score > 0 and _is_repo_doc_path(rel_path):
        # Documentation is the intended workflow overview; source still verifies implementation details.
        score += 35
    return score


def _extract_referenced_repo_paths(content, max_paths=12):
    """Extract literal repo paths from a retrieved source/doc excerpt."""
    if not content:
        return []
    pattern = re.compile(
        r"\b((?:backend|frontend|docs|electron|config|scripts)/"
        r"[A-Za-z0-9_./-]+\.(?:py|js|jsx|ts|tsx|css|md|json|sh|ps1|yml|yaml|txt))\b"
    )
    paths = []
    for match in pattern.finditer(content):
        rel_path = os.path.normpath(match.group(1)).replace("\\", "/")
        if rel_path not in paths and _is_retrievable_repo_path(rel_path):
            paths.append(rel_path)
        if len(paths) >= max_paths:
            break
    return paths


def _excerpt_repo_content(rel_path, content, query_terms):
    """Return a focused excerpt around the first relevant match."""
    max_chars = (
        RELEVANT_REPO_DOC_EXCERPT_MAX_CHARS
        if str(rel_path).startswith("docs/")
        else RELEVANT_REPO_EXCERPT_MAX_CHARS
    )
    if len(content) <= max_chars:
        return content
    content_lower = content.lower()
    match_positions = [
        content_lower.find(term)
        for term in query_terms
        if term and content_lower.find(term) >= 0
    ]
    if not match_positions:
        return f"{content[:max_chars]}\n\n[Excerpt truncated.]"
    route_source_terms = {
        "preview_multichannel",
        "read_project_file",
    }
    primary_source_terms = {
        "maxpoints",
        "max_points",
        "linspace",
    }
    secondary_source_terms = {
        "max_samples",
        "downsampling",
        "downsample",
        "downsampled",
        "decimation",
    }
    prioritized_positions = []
    for term in query_terms:
        if not term:
            continue
        pos = content_lower.find(term)
        if pos < 0:
            continue
        if term in route_source_terms:
            priority = 0
        elif term in primary_source_terms:
            priority = 1
        elif term in secondary_source_terms:
            priority = 2
        else:
            priority = 3
        prioritized_positions.append((priority, pos))
    center = min(prioritized_positions or [(3, min(match_positions))])[1]
    start = max(0, center - max_chars // 3)
    end = min(len(content), start + max_chars)
    if end - start < max_chars:
        start = max(0, end - max_chars)
    excerpt = content[start:end]
    prefix = "[Excerpt starts mid-file]\n" if start > 0 else ""
    suffix = "\n[Excerpt ends mid-file]" if end < len(content) else ""
    return f"{prefix}{excerpt}{suffix}"


def _get_relevant_repo_context(user_query):
    """Search app source/docs and attach the most relevant evidence for this question."""
    query_terms = _tokenize_repo_query(user_query)
    if not query_terms:
        return ""

    scored_files = []
    for rel_path in _iter_retrievable_repo_files():
        content = _read_repo_text(rel_path)
        if not content.strip():
            continue
        score = _score_repo_file(rel_path, content, query_terms)
        if score <= 0:
            continue
        scored_files.append((score, rel_path, content))

    if not scored_files:
        return (
            "Repository retrieval found no matching source/documentation excerpts for this question. "
            "Use the repository map, and state clearly if evidence is insufficient."
        )

    scored_files.sort(key=lambda item: (-item[0], item[1]))
    doc_files = [item for item in scored_files if _is_repo_doc_path(item[1])]
    source_files = [item for item in scored_files if not _is_repo_doc_path(item[1])]
    doc_seed_count = min(len(doc_files), 2, RELEVANT_REPO_CONTEXT_MAX_FILES)
    source_seed_count = max(0, min(3, RELEVANT_REPO_CONTEXT_MAX_FILES) - doc_seed_count)
    seed_files = doc_files[:doc_seed_count] + source_files[:source_seed_count]
    selected_by_path = {
        rel_path: (score, rel_path, content)
        for score, rel_path, content in seed_files
    }

    # Docs often contain the best overview and exact source references.
    # Pull those referenced source files too, so AiRA can verify details directly.
    referenced_any = False
    for score, rel_path, content in seed_files:
        for referenced_path in _extract_referenced_repo_paths(content):
            referenced_any = True
            referenced_content = _read_repo_text(referenced_path)
            if not referenced_content.strip():
                continue
            referenced_score = max(1, score // 2)
            existing = selected_by_path.get(referenced_path)
            if existing and existing[0] >= referenced_score:
                continue
            selected_by_path[referenced_path] = (referenced_score, referenced_path, referenced_content)

    if not referenced_any:
        for score, rel_path, content in scored_files:
            if len(selected_by_path) >= RELEVANT_REPO_CONTEXT_MAX_FILES:
                break
            selected_by_path.setdefault(rel_path, (score, rel_path, content))

    selected = list(selected_by_path.values())
    selected.sort(key=lambda item: (0 if _is_repo_doc_path(item[1]) else 1, -item[0], item[1]))
    selected = selected[:RELEVANT_REPO_CONTEXT_MAX_FILES]
    selected_docs = [rel_path for _, rel_path, _ in selected if _is_repo_doc_path(rel_path)]
    sections = [
        "Relevant repository excerpts selected by lexical retrieval over EXDA source/docs.",
        f"Search terms: {', '.join(query_terms)}",
        "Documentation files checked first:",
        *([f"- {rel_path}" for rel_path in selected_docs] if selected_docs else ["- None matched this question."]),
        "Allowed cited source files for this answer:",
        *[f"- {rel_path}" for _, rel_path, _ in selected],
        "Use documentation as the workflow overview, then verify implementation details in source code.",
        "If documentation and direct source conflict, cite both and prefer source code for current behavior.",
        "Use these excerpts as evidence. Cite file paths. If they are insufficient, say what is missing.",
    ]
    for score, rel_path, content in selected:
        excerpt = _excerpt_repo_content(rel_path, content, query_terms)
        section = (
            f"\n--- SOURCE FILE: {rel_path} | score={score} ---\n"
            f"{excerpt}\n"
            f"--- END SOURCE FILE: {rel_path} ---"
        )
        if len("\n".join(sections)) + len(section) > RELEVANT_REPO_CONTEXT_MAX_CHARS:
            sections.append("\n[Relevant repository context truncated for prompt size.]")
            break
        sections.append(section)
    return "\n".join(sections)


def _extract_allowed_source_paths(relevant_repo_context):
    """Return source file paths explicitly included in the retrieved context."""
    if not relevant_repo_context:
        return set()
    allowed = set()
    source_pattern = re.compile(r"--- SOURCE FILE:\s*([^|\n]+)")
    list_pattern = re.compile(r"^\s*-\s+((?:backend|frontend|docs|electron|config|scripts)/\S+)\s*$")
    for match in source_pattern.finditer(relevant_repo_context):
        allowed.add(match.group(1).strip())
    for line in relevant_repo_context.splitlines():
        match = list_pattern.match(line)
        if match:
            allowed.add(match.group(1).strip())
    return allowed


def _extract_repo_paths_from_text(text):
    """Extract repository-like paths mentioned in model output."""
    if not text:
        return []
    path_pattern = re.compile(
        r"\b((?:backend|frontend|docs|electron|config|scripts)/"
        r"[A-Za-z0-9_./-]+(?:\.[A-Za-z0-9]+)?)"
    )
    paths = []
    for match in path_pattern.finditer(text):
        rel_path = match.group(1).rstrip(".,;:)`]}'\"")
        rel_path = os.path.normpath(rel_path).replace("\\", "/")
        if rel_path not in paths:
            paths.append(rel_path)

    # Models often cite a source file by basename only. Resolve unique filenames
    # dynamically instead of relying on a hand-written list of known files.
    full_path_basenames = {os.path.basename(path) for path in paths}
    basename_pattern = re.compile(
        r"(?<!/)\b([A-Za-z0-9_-]+\.(?:py|js|jsx|ts|tsx|css|md|json|sh|ps1|yml|yaml|txt))\b"
    )
    for match in basename_pattern.finditer(text):
        basename = match.group(1).rstrip(".,;:)`]}'\"")
        if basename in full_path_basenames:
            continue
        matches = [
            rel_path for rel_path in _iter_retrievable_repo_files()
            if os.path.basename(rel_path) == basename
        ]
        if len(matches) == 1:
            rel_path = matches[0]
        else:
            rel_path = basename
        if rel_path not in paths:
            paths.append(rel_path)
    return paths


def _repo_path_exists(relative_path):
    """Return True when a model-cited repo path exists in this checkout."""
    if not relative_path:
        return False
    rel_path = os.path.normpath(str(relative_path).strip()).lstrip(os.sep)
    abs_path = os.path.join(APP_ROOT, rel_path)
    return project_manager.is_path_within(APP_ROOT, abs_path) and os.path.exists(abs_path)


def _replace_unsupported_claims_line(text, unsupported_paths):
    """Prevent a model from saying unsupported claims are none after a failed source check."""
    if not unsupported_paths:
        return text
    replacement = (
        "- Unsupported claims: mentioned repository paths that were not validated for this answer: "
        + ", ".join(f"`{path}`" for path in unsupported_paths)
    )
    lines = []
    replaced = False
    for line in text.splitlines():
        if "unsupported claims" in line.lower() and re.search(r"\bnone\b", line, flags=re.IGNORECASE):
            lines.append(replacement)
            replaced = True
        else:
            lines.append(line)
    result = "\n".join(lines)
    if not replaced:
        result = f"{result.rstrip()}\n\n## Validation Notes\n{replacement}"
    return result


def _repo_source_guard_issues(text, relevant_repo_context):
    """Return cited path issues for a model response."""
    allowed_paths = _extract_allowed_source_paths(relevant_repo_context)
    cited_paths = _extract_repo_paths_from_text(text)
    invalid_paths = [path for path in cited_paths if not _repo_path_exists(path)]
    outside_context_paths = [
        path for path in cited_paths
        if path not in invalid_paths and allowed_paths and path not in allowed_paths
    ]
    return allowed_paths, invalid_paths, outside_context_paths


def _build_dynamic_cited_path_context(user_query, relevant_repo_context, cited_paths):
    """Append real excerpts for existing repo paths mentioned by a draft answer."""
    if not cited_paths:
        return relevant_repo_context, []

    allowed_paths = _extract_allowed_source_paths(relevant_repo_context)
    query_terms = _tokenize_repo_query(user_query)
    sections = []
    loaded_paths = []
    used_chars = 0

    for rel_path in cited_paths:
        if rel_path in allowed_paths or rel_path in loaded_paths:
            continue
        if not _repo_path_exists(rel_path) or not _is_retrievable_repo_path(rel_path):
            continue
        content = _read_repo_text(rel_path)
        if not content.strip():
            continue
        excerpt = _excerpt_repo_content(rel_path, content, query_terms)
        section = (
            f"\n--- DRAFT-CITED FILE CHECK: {rel_path} ---\n"
            f"{excerpt}\n"
            f"--- END DRAFT-CITED FILE CHECK: {rel_path} ---"
        )
        if used_chars + len(section) > DYNAMIC_CITED_PATH_CONTEXT_MAX_CHARS:
            break
        sections.append(section)
        loaded_paths.append(rel_path)
        used_chars += len(section)

    if not sections:
        return relevant_repo_context, []

    intro = (
        "\n\nDYNAMIC PATH CHECK:\n"
        "The previous draft mentioned these existing repository paths even though they were not selected as evidence. "
        "Their real contents are included below only for verification, not as automatically approved evidence. "
        "If a file was not selected as relevant evidence for the question, the corrected answer should normally "
        "remove that claim/path instead of guessing."
    )
    return f"{relevant_repo_context}{intro}{''.join(sections)}", loaded_paths


def _is_negated_claim_context(text, start_index):
    """Return True when a matched implementation claim is explicitly negated nearby."""
    before = text[max(0, start_index - 70):start_index].lower()
    negators = (
        "not ",
        "no ",
        "without ",
        "rather than ",
        "instead of ",
        "does not ",
        "do not ",
        "is not ",
        "isn't ",
        "are not ",
        "aren't ",
        "never ",
    )
    return any(negator in before for negator in negators)


def _context_supports_claim(pattern, relevant_repo_context):
    """Return True only when the evidence contains a non-negated implementation claim."""
    for match in pattern.finditer(relevant_repo_context or ""):
        if not _is_negated_claim_context(relevant_repo_context, match.start()):
            return True
    return False


def _repo_claim_guard_issues(text, relevant_repo_context):
    """Return unsupported implementation claims not present in selected evidence."""
    if not text or not relevant_repo_context:
        return []

    unsupported_claims = []
    for pattern, label in UNSUPPORTED_IMPLEMENTATION_CLAIM_PATTERNS:
        if _context_supports_claim(pattern, relevant_repo_context):
            continue
        for match in pattern.finditer(text):
            if _is_negated_claim_context(text, match.start()):
                continue
            if label not in unsupported_claims:
                unsupported_claims.append(label)
            break
    if _extract_allowed_source_paths(relevant_repo_context):
        for pattern, label in FALSE_MISSING_EVIDENCE_PATTERNS:
            if pattern.search(text) and label not in unsupported_claims:
                unsupported_claims.append(label)
    return unsupported_claims


def _apply_repo_source_guard(text, relevant_repo_context, strict=False):
    """Mark model-cited repo paths that do not exist or were not retrieved as evidence."""
    if not text:
        return ""

    allowed_paths, invalid_paths, outside_context_paths = _repo_source_guard_issues(text, relevant_repo_context)
    unsupported_claims = _repo_claim_guard_issues(text, relevant_repo_context) if strict else []
    unsupported_paths = invalid_paths + outside_context_paths if strict else invalid_paths

    guarded = text
    for path in invalid_paths:
        guarded = re.sub(
            rf"(?<!`)({re.escape(path)})(?!`|\s*\[Not found in repository\])",
            rf"`\1` [Not found in repository]",
            guarded,
        )
    if strict:
        for path in outside_context_paths:
            guarded = re.sub(
                rf"(?<!`)({re.escape(path)})(?!`|\s*\[Not in selected source context\])",
                rf"`\1` [Not in selected source context]",
                guarded,
            )
    guarded = _replace_unsupported_claims_line(guarded, unsupported_paths)

    notices = []
    if invalid_paths:
        notices.append(
            "- AiRA mentioned repository paths that do not exist in this checkout: "
            + ", ".join(f"`{path}`" for path in invalid_paths)
        )
    if outside_context_paths:
        notices.append(
            "- AiRA mentioned existing paths that were not part of the selected evidence for this question: "
            + ", ".join(f"`{path}`" for path in outside_context_paths)
        )
    if unsupported_claims:
        notices.append(
            "- AiRA made implementation claims not present in the selected evidence: "
            + ", ".join(unsupported_claims)
        )
    if notices:
        source_check = "## Source Check\n" + "\n".join(notices) + (
            "\n- Treat those details as unsupported unless you verify them manually."
        )
        guarded = f"{source_check}\n\n{guarded.lstrip()}"
    return guarded


def _build_source_guard_failure_response(
    relevant_repo_context,
    invalid_paths,
    outside_context_paths,
    unsupported_claims=None,
):
    """Fail closed when a model continues to cite unsupported implementation sources."""
    unsupported_claims = unsupported_claims or []
    allowed_paths = sorted(_extract_allowed_source_paths(relevant_repo_context))
    lines = [
        "## Source Check",
        "- AiRA blocked the generated answer because it still contained unsupported implementation details.",
    ]
    if invalid_paths:
        lines.append(
            "- Paths not found in this checkout: " + ", ".join(f"`{path}`" for path in invalid_paths)
        )
    if outside_context_paths:
        lines.append(
            "- Paths not selected as evidence for this question: "
            + ", ".join(f"`{path}`" for path in outside_context_paths)
        )
    if unsupported_claims:
        lines.append(
            "- Unsupported implementation claims: " + ", ".join(unsupported_claims)
        )
    if allowed_paths:
        lines.append("")
        lines.append("## Verified Source Files Selected")
        lines.extend([f"- `{path}`" for path in allowed_paths])
    lines.append("")
    lines.append("## Answer Not Accepted")
    lines.append(
        "- The previous model response mixed verified source context with speculation. "
        "Please retry the question; AiRA will re-query using only the verified source files above."
    )
    return "\n".join(lines)


def _extract_chat_content(response):
    """Extract assistant text from Ollama chat response shapes."""
    if isinstance(response, dict):
        message = response.get("message") or {}
        if isinstance(message, dict):
            return str(message.get("content") or "")
        return str(response.get("content") or "")
    message = getattr(response, "message", None)
    if isinstance(message, dict):
        return str(message.get("content") or "")
    content = getattr(message, "content", None)
    if content is not None:
        return str(content)
    return str(getattr(response, "content", "") or "")


def _retry_source_grounded_response(
    model,
    system_content,
    user_query,
    relevant_repo_context,
    invalid_paths,
    outside_context_paths,
    unsupported_claims=None,
    dynamically_checked_paths=None,
):
    """Ask the model once more to rewrite from evidence only after source validation fails."""
    unsupported_claims = unsupported_claims or []
    dynamically_checked_paths = dynamically_checked_paths or []
    allowed_paths = sorted(_extract_allowed_source_paths(relevant_repo_context))
    correction_prompt = (
        f"{system_content}\n\n"
        "SOURCE CHECK FAILED FOR THE PREVIOUS DRAFT.\n"
        "Rewrite the answer from scratch using ONLY the RELEVANT SOURCE/DOC EXCERPTS above.\n"
        "A deterministic pre-screen checked repository paths mentioned by the previous draft. "
        "Nonexistent paths must be removed. Existing draft-cited paths were loaded below only when they "
        "could be verified inside the app checkout.\n"
        f"\n--- UPDATED VERIFIED SOURCE/DOC EXCERPTS FOR RETRY ---\n{relevant_repo_context}\n"
        "--- END UPDATED VERIFIED SOURCE/DOC EXCERPTS FOR RETRY ---\n"
        "Do not mention implementation files, hooks, utility modules, routes, constants, algorithms, "
        "cache behavior, chart pixel width, points-per-pixel rules, min/max envelopes, averages, medians, "
        "benchmarks, or random-access reads unless they are explicitly visible in the SOURCE FILE excerpts.\n"
        "Do not include speculative 'Assumptions' or broad 'Next Steps' for app implementation questions.\n"
        "Every concrete implementation statement must cite one of these selected source files:\n"
        + "\n".join(f"- {path}" for path in allowed_paths)
        + "\nRejected paths from previous draft:\n"
        + "\n".join(f"- {path}" for path in [*invalid_paths, *outside_context_paths])
        + "\nExisting draft-cited paths dynamically checked before retry:\n"
        + "\n".join(f"- {path}" for path in dynamically_checked_paths)
        + "\nRejected implementation claims from previous draft:\n"
        + "\n".join(f"- {claim}" for claim in unsupported_claims)
    )
    try:
        response = client.chat(
            model=model,
            messages=[
                {"role": "system", "content": correction_prompt},
                {"role": "user", "content": user_query},
            ],
            stream=False,
        )
        return _extract_chat_content(response)
    except Exception:
        return ""


def _build_repo_context():
    """Build a bounded-size repository context snapshot for AiRA prompts."""
    lines = [
        "Local repository context snapshot for application-level Q&A and code improvement guidance.",
    ]

    lines.append("")
    lines.append("Important app behavior notes:")
    lines.append("- Import Data tab queues selected files/paths; heavy parsing happens when downstream tabs consume content.")
    lines.append("- Data Preprocessing preview requests file content via /read_project_file and then calls /preview_multichannel.")
    lines.append("- Time-window controls (windowStart/windowEnd) are supported for CSV/TXT/DAT/ASC/ASCII/MF4/TPC5 in /read_project_file.")
    lines.append("- Technical documentation in docs/ and relevant source files are retrieved dynamically for detailed app questions.")
    lines.append("- Data Preprocessing is primarily inspection/QA; analysis tabs may apply different processing settings.")
    lines.append("- Unit handling combines inference, per-channel overrides, and optional pressure conversion to kPa.")
    lines.append("- Workspace supports MVP mode, which gates selected advanced tabs behind the MVP toggle/password flow while keeping core metadata and analysis workflows available.")
    lines.append("- Metadata modules save into Reports/*.json: DAQ Systems, Sensors Mapping, Cameras Mapping, Gas Mixing, and Checklist state.")
    lines.append("- Cameras Mapping is group-based and records camera ID/type/model/serial, optical method used (for example BOS or Schlieren), FPS, resolution, lens, exposure settings (shutter speed, iris/aperture F-number, ISO, white balance), coordinates/origin, mounting description, FOV/target region, trigger mode/sync notes, active state, calibration reference, IR emissivity, and temperature range.")
    lines.append("- Consolidated metadata report exports include Plan, DAQ Systems, Sensors Mapping, Cameras Mapping, and Gas Mixing; CSV keeps full metadata while PDF prioritizes compact readable summaries.")
    lines.append("- Pressure/flame/simulation flows are not identical and use different endpoints/data paths.")
    lines.append("- Optional dependencies gate features (e.g., asammdf for MF4, h5py for TPC5, Ollama availability for AI).")
    lines.append("- Mixed chart stack is used across tabs (Recharts and uPlot), so interaction behavior can differ.")
    lines.append("- Project state is filesystem-driven; saved plan/status files influence rehydrated UI state.")
    lines.append("- Demo mode disables AiRA and changes expected assistant behavior.")

    top = _top_level_entries()
    if top:
        lines.append("")
        lines.append("Top-level entries:")
        lines.extend([f"- {entry}" for entry in top])

    scripts = _read_npm_scripts()
    if scripts:
        lines.append("")
        lines.append("NPM scripts:")
        lines.extend([f"- {entry}" for entry in scripts])

    lines.append("")
    lines.append("Primary app structure files:")
    lines.extend(_app_structure_file_lines())

    lines.append("")
    lines.append("Primary calculation files (verify first):")
    lines.extend(_main_calculation_file_lines())

    sections = [
        ("Documentation files", _collect_files("docs", (".md", ".txt"), max_depth=3, max_items=40)),
        ("Electron files", _collect_files("electron", (".cjs", ".js", ".json"), max_depth=2, max_items=30)),
        ("Frontend app files", _collect_files("frontend/src", (".jsx", ".js", ".tsx", ".ts", ".css"), max_depth=4, max_items=120)),
        ("Backend route files", _collect_files("backend/routes", (".py",), max_depth=2, max_items=80)),
        ("Backend module files", _collect_files("backend/modules", (".py",), max_depth=3, max_items=80)),
        ("Backend core files", _collect_files("backend", (".py", ".txt", ".md", ".spec", ".sh", ".ps1"), max_depth=2, max_items=40)),
    ]

    for title, items in sections:
        if not items:
            continue
        lines.append("")
        lines.append(f"{title}:")
        lines.extend([f"- {item}" for item in items])

    endpoints = _extract_backend_endpoints()
    if endpoints:
        lines.append("")
        lines.append("Backend HTTP endpoints:")
        lines.extend([f"- {entry}" for entry in endpoints])

    context = "\n".join(lines)
    if len(context) > REPO_CONTEXT_MAX_CHARS:
        context = f"{context[:REPO_CONTEXT_MAX_CHARS]}\n\n[Context truncated for prompt size.]"
    return context


def get_repo_context(force_refresh=False):
    """Return cached repo context, rebuilding when cache is stale or forced."""
    now = time.time()
    cached = _REPO_CONTEXT_CACHE.get("context") or ""
    generated_at = float(_REPO_CONTEXT_CACHE.get("generated_at") or 0.0)
    if not force_refresh and cached and (now - generated_at) <= REPO_CONTEXT_TTL_SECONDS:
        return cached
    context = _build_repo_context()
    _REPO_CONTEXT_CACHE["context"] = context
    _REPO_CONTEXT_CACHE["generated_at"] = now
    return context


def _is_improvement_request(text):
    """Detect whether user query asks for improvements/review style output."""
    if not text:
        return False
    lower = str(text).lower()
    return any(hint in lower for hint in IMPROVEMENT_QUERY_HINTS)


EXPERT_ROLE_DESCRIPTIONS = {
    "combustion_dynamics_expert": (
        "Expert in hydrogen combustion dynamics covering deflagration, detonation, flame acceleration, "
        "pressure wave coupling, and DDT risk. Provides physics-grounded interpretations of pressure and flame data."
    ),
    "dispersion_cfd_expert": (
        "Specialist in hydrogen dispersion behavior and CFD modeling. Advises on leak scenarios, cloud formation, "
        "turbulence, boundary conditions, and simulation validation against experiments."
    ),
    "experimental_instrumentation_analyst": (
        "Expert in experimental design and instrumentation for hydrogen tests. Focuses on pressure transducers, "
        "calibration, sampling, signal conditioning, uncertainty, and data QA/QC."
    ),
    "risk_safety_engineer": (
        "Safety engineer combining quantitative risk assessment with safety system design. Covers hazard analysis, "
        "mitigation strategies, venting, detection, and safety-case arguments."
    ),
    "structural_analyst": (
        "Analyst for blast/impulse effects on structures, enclosure integrity, and material response under "
        "hydrogen explosion loads."
    ),
    "literature_reviewer": (
        "Synthesizes literature, identifies consensus and gaps, and summarizes relevant findings with traceable citations."
    ),
    "regulatory_specialist": (
        "Expert in hydrogen standards and regulatory frameworks (ISO, IEC, NFPA, EN). Advises on compliance, "
        "test methods, and reporting expectations."
    ),
    "thesis_advisor": (
        "Academic advisor focusing on research rigor, methodology clarity, and thesis structure guidance."
    ),
    "project_coordinator": (
        "Project management specialist for timelines, milestones, dependencies, and cross-team coordination."
    ),
    "it_engineer": (
        "Software and IT engineering specialist for architecture, APIs, deployment, performance, reliability, "
        "maintainability, and operational robustness."
    ),
    "computational_data_scientist": (
        "Computational data science specialist for signal processing, numerical methods, statistics, "
        "model validation, uncertainty analysis, and reproducible analytical workflows."
    ),
}

ROLE_DISPLAY_NAMES = {
    "combustion_dynamics_expert": "Combustion Dynamics Expert",
    "dispersion_cfd_expert": "Dispersion CFD Expert",
    "experimental_instrumentation_analyst": "Experimental Instrumentation Analyst",
    "risk_safety_engineer": "Risk Safety Engineer",
    "structural_analyst": "Structural Analyst",
    "literature_reviewer": "Literature Reviewer",
    "regulatory_specialist": "Regulatory Specialist",
    "thesis_advisor": "Thesis Advisor",
    "project_coordinator": "Project Coordinator",
    "it_engineer": "IT Engineer",
    "computational_data_scientist": "Computational Data Scientist",
}

ROLE_ALIASES = {
    "computational_it_engineer": "it_engineer",
}

ROLE_ROUTING_RULES = {
    "combustion_dynamics_expert": (
        "combustion",
        "ddt",
        "deflagration",
        "detonation",
        "flame acceleration",
        "flame arrival",
        "flame speed",
        "pressure spike",
        "pressure trace",
        "pressure transducer",
        "pressure wave",
        "explosion dynamics",
    ),
    "dispersion_cfd_expert": (
        "cfd",
        "mesh",
        "boundary condition",
        "turbulence",
        "dispersion",
        "simulation",
        "openfoam",
    ),
    "experimental_instrumentation_analyst": (
        "sensor",
        "instrument",
        "channel",
        "calibration",
        "sampling",
        "signal",
        "qa",
        "qc",
    ),
    "risk_safety_engineer": (
        "risk",
        "safety",
        "mitigation",
        "hazard",
        "barrier",
        "safeguard",
        "incident",
    ),
    "structural_analyst": (
        "structure",
        "structural",
        "load",
        "impulse",
        "integrity",
        "enclosure",
        "stress",
    ),
    "literature_reviewer": (
        "literature",
        "paper",
        "publication",
        "review",
        "citation",
        "related work",
    ),
    "regulatory_specialist": (
        "standard",
        "regulation",
        "compliance",
        "nfpa",
        "iso",
        "iec",
        "en ",
        "astm",
        "clause",
        "reporting requirement",
    ),
    "thesis_advisor": (
        "thesis",
        "methodology",
        "reviewer",
        "chapter",
        "academic",
        "defense",
    ),
    "project_coordinator": (
        "milestone",
        "timeline",
        "schedule",
        "dependency",
        "coordination",
        "deliverable",
    ),
    "it_engineer": (
        "refactor",
        "architecture",
        "api",
        "performance",
        "pipeline",
        "bug",
        "maintainability",
        "modular",
        "codebase",
        "deployment",
        "backend",
        "frontend",
        "infrastructure",
    ),
    "computational_data_scientist": (
        "signal processing",
        "ewt",
        "wavelet",
        "statistics",
        "uncertainty",
        "numerical",
        "time series",
        "validation",
        "modeling",
        "inference",
    ),
}


def _infer_expert_roles(query_text, max_roles=2):
    """Infer expert roles from user query intent."""
    text = (query_text or "").lower()
    scored = []
    for role, keywords in ROLE_ROUTING_RULES.items():
        score = 0
        for kw in keywords:
            if kw in text:
                score += 1
        if score > 0:
            scored.append((score, role))
    if not scored:
        return ["it_engineer"]
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [role for _, role in scored[:max_roles]]


def _normalize_role_id(role):
    if not role:
        return role
    clean = role.strip()
    return ROLE_ALIASES.get(clean, clean)


def _parse_expert_roles(raw_roles):
    """Normalize expert role selections from query parameters."""
    if not raw_roles:
        return []
    if isinstance(raw_roles, list):
        parts = []
        for item in raw_roles:
            if not item:
                continue
            if isinstance(item, str):
                parts.extend([_normalize_role_id(p.strip()) for p in item.split(",") if p.strip()])
        return parts
    if isinstance(raw_roles, str):
        parts = [_normalize_role_id(p.strip()) for p in raw_roles.split(",")]
        return [p for p in parts if p]
    return []


def _role_label(role):
    return ROLE_DISPLAY_NAMES.get(role, role.replace("_", " ").title())


def _normalize_markdown_response(text):
    """Repair common markdown artifacts from streamed model output."""
    if not text:
        return ""

    value = text.replace("\r\n", "\n")

    # Break concatenated separators/headings and stacked headings on one line.
    value = re.sub(r"---\s*(?=#{2,6}\s)", "---\n\n", value)
    value = re.sub(r"([^\n])\s*(#{2,6}\s+)", r"\1\n\n\2", value)
    value = re.sub(r"(#{2,6}\s+[^\n#]+)\s*(#{2,6}\s+)", r"\1\n\n\2", value)

    # Normalize malformed bullet starts and heading+bold mashups.
    value = re.sub(r"(^|\n)\s*\*\s*(?=\S)", r"\1- ", value)
    value = re.sub(r"(^|\n)##\s*Active Experts\s*\*\*([^\n*]+)\*\*", r"\1## Active Experts\n- **\2**", value)

    # Ensure list markers are on new lines.
    value = re.sub(r"([^\n])\s*-\s+(?=\S)", r"\1\n- ", value)
    value = re.sub(r"([^\n])\s*(\d+\.)\s+(?=\S)", r"\1\n\2 ", value)

    # Encourage structured section spacing.
    value = re.sub(r"\n{3,}", "\n\n", value).strip()

    # Keep only one "Active Experts" heading if model duplicates it.
    first = value.find("## Active Experts")
    if first != -1:
        second = value.find("## Active Experts", first + len("## Active Experts"))
        if second != -1:
            value = value[:second] + value[second:].replace("## Active Experts", "", 1)

    return value


def _mark_unverified_standards_claims(text):
    """
    Mark granular standards references as needing verification unless already tagged.
    This reduces overconfident clause-level claims.
    """
    if not text:
        return ""

    lines = text.splitlines()
    tagged = []
    pattern = re.compile(
        r"\b(ISO|IEC|NFPA|EN|ASTM)\b.*\b(Section|Clause|Chapter|Annex)\b",
        re.IGNORECASE,
    )
    for line in lines:
        if pattern.search(line) and "[Needs verification]" not in line:
            tagged.append(f"{line} [Needs verification]")
        else:
            tagged.append(line)
    return "\n".join(tagged)


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        txt = value.strip()
        return [txt] if txt else []
    return [str(value).strip()]


def _strip_json_fence(value):
    text = (value or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _parse_structured_payload(raw_text):
    text = _strip_json_fence(raw_text)
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    # Fallback: try extracting largest JSON object.
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            return None
    return None


def _render_structured_markdown(payload, active_roles):
    if not isinstance(payload, dict):
        return ""

    lines = []
    experts = _as_list(payload.get("experts_used"))
    if experts:
        lines.append(f"Experts used: {', '.join(experts)}")
        lines.append("")
    elif len(active_roles) > 1:
        lines.append(f"Experts used: {', '.join(_role_label(r) for r in active_roles)}")
        lines.append("")

    role_inputs = payload.get("role_inputs")
    if isinstance(role_inputs, list):
        for entry in role_inputs:
            if not isinstance(entry, dict):
                continue
            role_name = str(entry.get("role") or "").strip()
            points = _as_list(entry.get("points"))
            if role_name:
                lines.append(f"### {role_name}")
            for point in points:
                lines.append(f"- {point}")
            if role_name or points:
                lines.append("")
    elif isinstance(role_inputs, dict):
        for role_name, points_raw in role_inputs.items():
            role_name = str(role_name).strip()
            points = _as_list(points_raw)
            if role_name:
                lines.append(f"### {role_name}")
            for point in points:
                lines.append(f"- {point}")
            if role_name or points:
                lines.append("")

    answer = _as_list(payload.get("answer"))
    if answer:
        lines.append("## Answer")
        lines.extend([f"- {item}" for item in answer])
        lines.append("")

    integrated = _as_list(payload.get("integrated_recommendation"))
    if integrated:
        lines.append("## Integrated Recommendation")
        lines.extend([f"- {item}" for item in integrated])
        lines.append("")

    assumptions = _as_list(payload.get("assumptions"))
    validation = payload.get("validation_notes") if isinstance(payload.get("validation_notes"), dict) else {}
    if validation or assumptions:
        lines.append("## Validation Notes")
        unit_consistency = str(validation.get("unit_consistency") or "").strip()
        unsupported_claims = str(validation.get("unsupported_claims") or "").strip()
        key_assumptions = _as_list(validation.get("key_assumptions")) or assumptions
        if unit_consistency:
            lines.append(f"- Unit consistency: {unit_consistency}")
        if unsupported_claims:
            lines.append(f"- Unsupported claims: {unsupported_claims}")
        if key_assumptions:
            lines.append("- Key assumptions:")
            lines.extend([f"- {item}" for item in key_assumptions])
        lines.append("")

    next_steps = _as_list(payload.get("next_steps"))
    if next_steps:
        lines.append("## Next Steps")
        lines.extend([f"- {item}" for item in next_steps])
        lines.append("")

    ewt_locations = _as_list(payload.get("ewt_calculation_location"))
    if ewt_locations:
        lines.append("## EWT Calculation Location")
        lines.extend([f"- {item}" for item in ewt_locations])
        lines.append("")

    return "\n".join(lines).strip()


def _run_structured_chat(model, system_content, user_query, timeout_seconds=18):
    """Run non-stream structured call with timeout so UI is never stuck."""
    def _invoke():
        return client.chat(
            model=model,
            messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_query}
            ],
            stream=False,
        )

    future = _STRUCTURED_EXECUTOR.submit(_invoke)
    try:
        return future.result(timeout=timeout_seconds), None
    except FutureTimeoutError:
        future.cancel()
        return None, "timeout"
    except Exception as exc:
        return None, str(exc)


def _extract_model_name(model_entry):
    """Handle both old dict-style and new object-style Ollama model entries."""
    if isinstance(model_entry, dict):
        return str(model_entry.get("name") or model_entry.get("model") or "").strip()
    return str(
        getattr(model_entry, "name", "")
        or getattr(model_entry, "model", "")
        or ""
    ).strip()


def _list_ollama_models():
    """Return available model names and an error string when Ollama is unavailable."""
    if not HAS_OLLAMA:
        return [], "ollama python package is not installed"
    try:
        models_response = client.list()
        raw_models = []
        if isinstance(models_response, dict):
            raw_models = models_response.get("models", []) or []
        else:
            raw_models = getattr(models_response, "models", []) or []
        detected_names = [_extract_model_name(model) for model in raw_models]
        names = _unique_preserve_order([*PREFERRED_AI_MODELS, *detected_names])
        if not names:
            return [], "Ollama responded, but no models are installed or visible"
        return names, ""
    except Exception as exc:
        return [], str(exc)


@ai_bp.route('/get_models', methods=['GET'])
def get_models():
    """List available Ollama models and report real reachability."""
    names, err = _list_ollama_models()
    if err:
        return jsonify({
            "success": False,
            "online": False,
            "models": list(PREFERRED_AI_MODELS),
            "error": err,
            "ollama_host": ollama_host if HAS_OLLAMA else "",
        })
    return jsonify({"success": True, "online": True, "models": names, "ollama_host": ollama_host})


@ai_bp.route('/ai_health', methods=['GET'])
def ai_health():
    """Lightweight health endpoint used by the AiRA badge."""
    names, err = _list_ollama_models()
    return jsonify({
        "success": not bool(err),
        "online": not bool(err),
        "models": names if names else list(PREFERRED_AI_MODELS),
        "error": err,
        "ollama_host": ollama_host if HAS_OLLAMA else "",
    })


@ai_bp.route('/app_repo_context', methods=['GET'])
def app_repo_context():
    """Return repository context used by AiRA prompts."""
    refresh = (request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes', 'on'}
    return jsonify({"success": True, "context": get_repo_context(force_refresh=refresh)})


@ai_bp.route('/ai_research_stream')
def ai_research_stream():
    """Stream AI responses as server-sent events with context-aware prompting."""
    if not HAS_OLLAMA:
        def generate_unavailable():
            yield "data: [Error: AI service unavailable]\n\n"
        return Response(generate_unavailable(), mimetype='text/event-stream')
    user_query = request.args.get('query', '')
    project_path = request.args.get('projectPath', 'Unknown')
    selected_model = (request.args.get('model') or DEFAULT_AI_MODEL).strip()
    available_models, models_error = _list_ollama_models()
    model_warning = ""
    if models_error:
        model_warning = f"[Error: AI service unavailable at {ollama_host} - {models_error}]"
    elif not selected_model and available_models:
        selected_model = available_models[0]
        model_warning = f"[AiRA notice: no model was selected; using '{selected_model}'.]"
    elif not selected_model:
        model_warning = f"[Error: no Ollama model is available from {ollama_host}. Install/select a model or check Ollama sign-in.]"
    elif available_models and selected_model not in available_models:
        fallback_model = available_models[0]
        model_warning = f"[AiRA notice: selected model '{selected_model}' is not available; using '{fallback_model}'.]"
        selected_model = fallback_model
    primary_role = _normalize_role_id((request.args.get('expert_role') or '').strip())
    active_roles_raw = request.args.getlist('expert_roles')
    if not active_roles_raw:
        active_roles_raw = request.args.get('expert_roles') or ''
    active_roles = _parse_expert_roles(active_roles_raw)
    auto_role = (request.args.get('auto_role') or '').strip().lower() in {'1', 'true', 'yes', 'on'}
    if auto_role or (not active_roles and not primary_role):
        active_roles = _infer_expert_roles(user_query)
        primary_role = active_roles[0] if active_roles else primary_role
    if primary_role and primary_role not in active_roles:
        active_roles = [primary_role] + active_roles
    # Remove unknown/duplicate roles while preserving order.
    seen = set()
    normalized_roles = []
    for role in active_roles:
        role = _normalize_role_id(role)
        if not role or role in seen:
            continue
        if role not in EXPERT_ROLE_DESCRIPTIONS:
            continue
        seen.add(role)
        normalized_roles.append(role)
    active_roles = normalized_roles
    investigator = request.args.get('investigator') or 'the researcher'
    institution = request.args.get('institution') or 'the institute'
    objective = request.args.get('objective') or 'hydrogen explosion research'
    plan_desc = request.args.get('plan_desc') or ''
    app_context = request.args.get('app_context') or ''
    include_repo_context = (request.args.get('include_repo_context') or '1').strip().lower() not in {'0', 'false', 'no', 'off'}
    structured_mode = (request.args.get('structured') or '0').strip().lower() in {'1', 'true', 'yes', 'on'}
    repo_context = get_repo_context() if include_repo_context else ''
    relevant_repo_context = _get_relevant_repo_context(user_query) if include_repo_context else ''
    pdf_context = get_pdf_context(project_path)
    improvement_mode = _is_improvement_request(user_query)

    def generate():
        try:
            if model_warning:
                yield f"data: {model_warning}\n\n"
                if model_warning.startswith("[Error:"):
                    yield "event: done\ndata: [DONE]\n\n"
                    return

            def emit_sse(text):
                for line in text.splitlines():
                    yield f"data: {line}\n"
                yield "\n"

            expert_lines = []
            if active_roles:
                for role in active_roles:
                    desc = EXPERT_ROLE_DESCRIPTIONS.get(role, "")
                    if desc:
                        expert_lines.append(f"- {_role_label(role)}: {desc}")
            expert_block = "\n".join(expert_lines) if expert_lines else "None specified."
            if len(active_roles) > 1:
                response_template = (
                    "RESPONSE TEMPLATE (MULTI-ROLE):\n"
                    "Experts used: <Role Name 1>, <Role Name 2>\n"
                    "### <Role Name 1>\n"
                    "- 2-4 bullets\n"
                    "### <Role Name 2>\n"
                    "- 2-4 bullets\n"
                    "## Integrated Recommendation\n"
                    "- 3-6 bullets\n"
                    "## Validation Notes\n"
                    "- Unit consistency: pass/fail + short note\n"
                    "- Unsupported claims: none/list\n"
                    "- Key assumptions: 1-3 bullets\n"
                    "## Next Steps\n"
                    "- 2-5 concrete actions\n"
                )
            else:
                response_template = (
                    "RESPONSE TEMPLATE (SINGLE-ROLE):\n"
                    "## Answer\n"
                    "- Direct answer in 3-8 bullets\n"
                    "## Assumptions\n"
                    "- 1-3 bullets\n"
                    "## Validation Notes\n"
                    "- Unit consistency: pass/fail + short note\n"
                    "- Unsupported claims: none/list\n"
                    "## Next Steps\n"
                    "- 2-5 concrete actions\n"
                )
            validator_lite = (
                "SOURCE-GROUNDING AND VALIDATOR CHECKS:\n"
                "For questions about EXDA app behavior, defaults, endpoints, algorithms, or file locations, "
                "prioritize RELEVANT SOURCE/DOC EXCERPTS over general knowledge and over the broad repo map.\n"
                "If the relevant excerpts include any docs/*.md file, read that documentation first as the workflow "
                "overview before inferring behavior from source code.\n"
                "Only cite a repo path as evidence when it appears in the 'Allowed cited source files for this answer' "
                "list or in a SOURCE FILE block. Do not invent file names, hooks, modules, routes, constants, or defaults.\n"
                "If a detail is not present in the relevant excerpts, write '[Not found in provided app context]' or "
                "'[Needs verification]' instead of guessing.\n"
                "If docs and direct source code conflict, say so and prefer direct source code for current behavior.\n"
                "Before finalizing, self-check for unit consistency, contradictory statements, and unsupported claims. "
                "Never write 'Unsupported claims: none' unless every concrete path/default/algorithm in the answer is "
                "supported by the relevant excerpts. For app implementation answers, each concrete behavior/default/"
                "algorithm claim must cite an allowed source file path. Do not add speculative Next Steps asking the "
                "user to locate files when source excerpts are already provided; answer from the provided evidence or "
                "state that the evidence is insufficient."
            )

            system_content = (
                f"You are AiRA, a specialised research assistant for {investigator} at {institution}. "
                f"Project: {os.path.basename(project_path)}. "
                f"Experiment Objective: {objective}. "
                f"Context: {plan_desc}. "
                f"Primary Expert Role: {primary_role or 'general'}. "
                f"Active Expert Personas:\n{expert_block}\n"
                f"\n--- APP CONTEXT ---\n{app_context}\n"
                f"\n--- RELEVANT SOURCE/DOC EXCERPTS FOR THIS QUESTION ---\n{relevant_repo_context or 'None.'}\n"
                f"\n--- APPLICATION CODEBASE CONTEXT (BACKGROUND ONLY, NOT CONCRETE EVIDENCE) ---\n{repo_context}\n"
                f"\n--- ATTACHED LITERATURE CONTEXT ---\n{pdf_context}\n"
                "Provide PhD-level technical insights.\n"
                "CRITICAL FORMATTING INSTRUCTIONS:\n"
                "1. ALWAYS use Markdown for structure (bullet points, bold text, headers).\n"
                "2. When listing files or papers, use a bulleted list with hyphens (- ), one item per line.\n"
                "3. Use bolding (**Title**) for document names.\n"
                "4. Ensure there is a double line break between different items in a list.\n"
                "5. If a user asks for a list, DO NOT write a paragraph; provide a clean, vertical list.\n"
                "6. If more than one Active Expert Persona is listed above, do NOT use '## Active Experts' or\n"
                "   '## Role Inputs' headers. Instead, output a single line: 'Experts used: <Role A>, <Role B>'.\n"
                "6b. Never print internal role IDs with underscores. Always use human-readable role names.\n"
                "7. When asked about this application's architecture, behavior, or improvements, ground your answer\n"
                "   in RELEVANT SOURCE/DOC EXCERPTS first, then APPLICATION CODEBASE CONTEXT, and cite concrete repository paths.\n"
                "8. STRICT MARKDOWN LAYOUT: every heading must be on its own line, add a blank line between sections,\n"
                "   and never concatenate separators/headings (avoid patterns like '---##' or 'Inputs###').\n"
                "9. Scope discipline: answer only the user's current question; do not append unrelated sections.\n"
                "10. Standards certainty rule: do not invent clause numbers. If a specific clause is not present in\n"
                "    ATTACHED LITERATURE CONTEXT, explicitly mark it as '[Needs verification]'."
                f"\n\n{response_template}\n{validator_lite}"
            )
            if improvement_mode:
                system_content += f"\n\n{IMPROVEMENT_REPORT_INSTRUCTIONS}"

            # Collect before emitting so source-guard checks can catch invented repo paths.
            stream = client.chat(model=selected_model, messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_query}
            ], stream=True)

            response_chunks = []
            for chunk in stream:
                content = chunk.get('message', {}).get('content', '')
                if not content:
                    continue
                response_chunks.append(content)

            final_response = "".join(response_chunks)
            final_response = _normalize_markdown_response(final_response)
            final_response = _mark_unverified_standards_claims(final_response)

            source_guard_failed_closed = False
            source_guard_context = relevant_repo_context
            if include_repo_context and relevant_repo_context:
                _, invalid_paths, outside_context_paths = _repo_source_guard_issues(final_response, relevant_repo_context)
                source_guard_context, dynamically_checked_paths = _build_dynamic_cited_path_context(
                    user_query,
                    relevant_repo_context,
                    outside_context_paths,
                )
                unsupported_claims = _repo_claim_guard_issues(final_response, relevant_repo_context)
                if invalid_paths or outside_context_paths or unsupported_claims:
                    retry_response = _retry_source_grounded_response(
                        selected_model,
                        system_content,
                        user_query,
                        source_guard_context,
                        invalid_paths,
                        outside_context_paths,
                        unsupported_claims,
                        dynamically_checked_paths,
                    )
                    if retry_response:
                        retry_response = _normalize_markdown_response(retry_response)
                        retry_response = _mark_unverified_standards_claims(retry_response)
                        _, retry_invalid_paths, retry_outside_context_paths = _repo_source_guard_issues(
                            retry_response,
                            source_guard_context,
                        )
                        retry_unsupported_claims = _repo_claim_guard_issues(retry_response, relevant_repo_context)
                        if retry_invalid_paths or retry_outside_context_paths or retry_unsupported_claims:
                            final_response = _build_source_guard_failure_response(
                                source_guard_context,
                                retry_invalid_paths,
                                retry_outside_context_paths,
                                retry_unsupported_claims,
                            )
                            source_guard_failed_closed = True
                        else:
                            final_response = retry_response
                    else:
                        final_response = _build_source_guard_failure_response(
                            source_guard_context,
                            invalid_paths,
                            outside_context_paths,
                            unsupported_claims,
                        )
                        source_guard_failed_closed = True

            if include_repo_context and not source_guard_failed_closed:
                final_response = _apply_repo_source_guard(
                    final_response,
                    source_guard_context,
                    strict=True,
                )
            yield from emit_sse(final_response)
            yield "event: done\ndata: [DONE]\n\n"
        except Exception as exc:
            yield f"data: [Error: AI service unreachable at {ollama_host} with model '{selected_model}' - {exc}]\n\n"
            yield "event: done\ndata: [DONE]\n\n"

    return Response(generate(), mimetype='text/event-stream')
