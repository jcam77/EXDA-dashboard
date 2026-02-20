
"""AiRA routes and helpers for model listing, SSE chat, and repo context snapshots."""

from flask import Blueprint, jsonify, request, Response
import json
import os
import re
import socket
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from urllib.parse import urlparse

from modules import project_manager

ai_bp = Blueprint("ai", __name__)

APP_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO_CONTEXT_MAX_CHARS = int(os.environ.get("EXDA_REPO_CONTEXT_MAX_CHARS", "7000"))
REPO_CONTEXT_TTL_SECONDS = int(os.environ.get("EXDA_REPO_CONTEXT_TTL", "120"))
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
}
REPO_SCAN_ALLOW_HIDDEN_DIRS = {".github"}
REPO_SCAN_IGNORE_PREFIXES = ("._",)
_REPO_CONTEXT_CACHE = {
    "context": "",
    "generated_at": 0.0,
}
_STRUCTURED_EXECUTOR = ThreadPoolExecutor(max_workers=2)
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
    ("frontend/src/features/workspace/WorkspacePage.jsx", "Main workspace orchestrator with navigation tabs and shared state."),
    ("frontend/src/features/workspace/hooks/useAnalysisPipeline.js", "Shared analysis orchestration for pressure/EWT/flame tabs."),
    ("frontend/src/features/analysis/PressureAnalysisWorkbench.jsx", "Shared pressure plotting/controls used by two tabs."),
    ("frontend/src/pages/PressureAnalysis.jsx", "Pressure Analysis tab page wrapper (experiments mode)."),
    ("frontend/src/pages/CFDValidation.jsx", "CFD Validation tab page wrapper (validation mode)."),
    ("frontend/src/pages/AppCalculationsVerification.jsx", "Verification page plotting clean/noisy fixtures and Python-vs-MATLAB metric comparisons."),
    ("frontend/src/pages/EwtAnalysis.jsx", "Empirical Wavelet Transform (EWT) analysis page."),
    ("frontend/src/pages/FlameSpeedAnalysis.jsx", "Flame speed analysis page."),
    ("frontend/src/pages/ImportData.jsx", "Import Data tab page."),
    ("frontend/src/pages/GasMixing.jsx", "Gas Mixing tab page."),
    ("frontend/src/pages/AiRA.jsx", "AiRA chat UI and streaming client."),
    ("backend/routes/ai.py", "AiRA backend route, prompt context, and repo snapshot generation."),
]


"""
To connect to your Ollama server running on your Mac:

Option A (recommended, dynamic IP): set your Mac hostname once
    export OLLAMA_HOSTNAME="your-mac.local"
    export OLLAMA_PORT="11434"

Option B (direct): set the full host
    export OLLAMA_HOST="http://10.7.55.183:11434"

Then start the app:
    npm run dev
    # or
    run v0.2

Note: In Parallels/VM setups, the hostname may resolve to a host-only IP
like 10.211.55.x instead of the Mac's Wi-Fi IP (en0). That's expected and OK.
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


def _read_hostname_file():
    """Read optional Ollama hostname override from .ollama_hostname."""
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


def _resolve_ollama_host():
    """Resolve Ollama host URL from env vars, hostname file, or localhost fallback."""
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

    for candidate in ("host.docker.internal", "host.internal"):
        if _hostname_resolves(candidate):
            return f"http://{candidate}:{port}"

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

    literature_dir = os.path.join(project_root, "Literature")
    if not os.path.exists(literature_dir):
        return ""

    all_pdf_data = []
    for root, dirs, files in os.walk(literature_dir):
        for filename in files:
            if filename.lower().endswith(".pdf"):
                rel_path = os.path.relpath(os.path.join(root, filename), literature_dir)
                file_path = os.path.join(root, filename)
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
    lines.append("- Full resolution mode can load all samples; fast mode may downsample large datasets for responsiveness.")
    lines.append("- Data Preprocessing is primarily inspection/QA; analysis tabs may apply different processing settings.")
    lines.append("- Unit handling combines inference, per-channel overrides, and optional pressure conversion to kPa.")
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


@ai_bp.route('/get_models', methods=['GET'])
def get_models():
    """List available Ollama models (or fallback default)."""
    if not HAS_OLLAMA:
        return jsonify({"success": True, "models": ['deepseek-v3.1:671b-cloud']})
    try:
        models_list = client.list()
        names = [m['name'] for m in models_list.get('models', [])]
        if not names:
            names = ['deepseek-v3.1:671b-cloud']
        return jsonify({"success": True, "models": names})
    except Exception:
        return jsonify({"success": True, "models": ['deepseek-v3.1:671b-cloud']})


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
    selected_model = request.args.get('model', 'deepseek-v3.1:671b-cloud')
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
    pdf_context = get_pdf_context(project_path)
    improvement_mode = _is_improvement_request(user_query)

    def generate():
        try:
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
                "VALIDATOR-LITE CHECKS:\n"
                "Before finalizing, self-check for unit consistency, contradictory statements, "
                "and unsupported claims. If uncertain, explicitly mark uncertainty."
            )

            system_content = (
                f"You are AiRA, a specialised research assistant for {investigator} at {institution}. "
                f"Project: {os.path.basename(project_path)}. "
                f"Experiment Objective: {objective}. "
                f"Context: {plan_desc}. "
                f"Primary Expert Role: {primary_role or 'general'}. "
                f"Active Expert Personas:\n{expert_block}\n"
                f"\n--- APP CONTEXT ---\n{app_context}\n"
                f"\n--- APPLICATION CODEBASE CONTEXT ---\n{repo_context}\n"
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
                "   in the APPLICATION CODEBASE CONTEXT and cite concrete repository paths.\n"
                "8. STRICT MARKDOWN LAYOUT: every heading must be on its own line, add a blank line between sections,\n"
                "   and never concatenate separators/headings (avoid patterns like '---##' or 'Inputs###').\n"
                "9. Scope discipline: answer only the user's current question; do not append unrelated sections.\n"
                "10. Standards certainty rule: do not invent clause numbers. If a specific clause is not present in\n"
                "    ATTACHED LITERATURE CONTEXT, explicitly mark it as '[Needs verification]'."
                f"\n\n{response_template}\n{validator_lite}"
            )
            if improvement_mode:
                system_content += f"\n\n{IMPROVEMENT_REPORT_INSTRUCTIONS}"

            if structured_mode:
                # Temporary fail-safe: keep strict-format toggle non-blocking.
                # We intentionally bypass non-stream structured generation to guarantee responsiveness.
                yield "data: [Strict format currently using fast streaming mode]\n\n"

            # Fallback: legacy stream mode if structured mode is disabled or parsing fails.
            stream = client.chat(model=selected_model, messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_query}
            ], stream=True)

            for chunk in stream:
                content = chunk.get('message', {}).get('content', '')
                if not content:
                    continue
                yield f"data: {content}\n\n"
        except Exception:
            yield "data: [Error: AI service unreachable]\n\n"

    return Response(generate(), mimetype='text/event-stream')
