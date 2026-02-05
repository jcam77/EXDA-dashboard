

from flask import Blueprint, jsonify, request, Response
import os
import socket
from urllib.parse import urlparse

from modules import project_manager

ai_bp = Blueprint("ai", __name__)


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
    if not hostname:
        return False
    try:
        socket.gethostbyname(hostname)
        return True
    except OSError:
        return False


def _read_hostname_file():
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
}


def _parse_expert_roles(raw_roles):
    if not raw_roles:
        return []
    if isinstance(raw_roles, list):
        parts = []
        for item in raw_roles:
            if not item:
                continue
            if isinstance(item, str):
                parts.extend([p.strip() for p in item.split(",") if p.strip()])
        return parts
    if isinstance(raw_roles, str):
        parts = [p.strip() for p in raw_roles.split(",")]
        return [p for p in parts if p]
    return []


@ai_bp.route('/get_models', methods=['GET'])
def get_models():
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


@ai_bp.route('/ai_research_stream')
def ai_research_stream():
    if not HAS_OLLAMA:
        def generate_unavailable():
            yield "data: [Error: AI service unavailable]\n\n"
        return Response(generate_unavailable(), mimetype='text/event-stream')
    user_query = request.args.get('query', '')
    project_path = request.args.get('projectPath', 'Unknown')
    selected_model = request.args.get('model', 'deepseek-v3.1:671b-cloud')
    primary_role = (request.args.get('expert_role') or '').strip()
    active_roles_raw = request.args.getlist('expert_roles')
    if not active_roles_raw:
        active_roles_raw = request.args.get('expert_roles') or ''
    active_roles = _parse_expert_roles(active_roles_raw)
    if primary_role and primary_role not in active_roles:
        active_roles = [primary_role] + active_roles
    investigator = request.args.get('investigator') or 'the researcher'
    institution = request.args.get('institution') or 'the institute'
    objective = request.args.get('objective') or 'hydrogen explosion research'
    plan_desc = request.args.get('plan_desc') or ''
    app_context = request.args.get('app_context') or ''
    pdf_context = get_pdf_context(project_path)

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
                        expert_lines.append(f"- {role}: {desc}")
            expert_block = "\n".join(expert_lines) if expert_lines else "None specified."

            system_content = (
                f"You are AiRA, a specialised research assistant for {investigator} at {institution}. "
                f"Project: {os.path.basename(project_path)}. "
                f"Experiment Objective: {objective}. "
                f"Context: {plan_desc}. "
                f"Primary Expert Role: {primary_role or 'general'}. "
                f"Active Expert Personas:\n{expert_block}\n"
                f"\n--- APP CONTEXT ---\n{app_context}\n"
                f"\n--- ATTACHED LITERATURE CONTEXT ---\n{pdf_context}\n"
                "Provide PhD-level technical insights.\n"
                "CRITICAL FORMATTING INSTRUCTIONS:\n"
                "1. ALWAYS use Markdown for structure (bullet points, bold text, headers).\n"
                "2. When listing files or papers, use a bulleted list with hyphens (- ), one item per line.\n"
                "3. Use bolding (**Title**) for document names.\n"
                "4. Ensure there is a double line break between different items in a list.\n"
                "5. If a user asks for a list, DO NOT write a paragraph; provide a clean, vertical list.\n"
                "6. If more than one Active Expert Persona is listed above, begin with an 'Active Experts:' line\n"
                "   listing every role, then provide short role-labeled sections with 2-4 bullets each."
            )

            if len(active_roles) > 1:
                preface_lines = ["## Active Experts", ""]
                for role in active_roles:
                    desc = EXPERT_ROLE_DESCRIPTIONS.get(role, "")
                    if desc:
                        preface_lines.append(f"- **{role}** — {desc}")
                    else:
                        preface_lines.append(f"- **{role}**")
                preface_lines.extend(["", "---", ""])
                yield from emit_sse("\n".join(preface_lines))

            stream = client.chat(model=selected_model, messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_query}
            ], stream=True)
            for chunk in stream:
                content = chunk.get('message', {}).get('content', '')
                if content:
                    yield f"data: {content}\n\n"
        except Exception:
            yield "data: [Error: AI service unreachable]\n\n"

    return Response(generate(), mimetype='text/event-stream')
