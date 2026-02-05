"""
AiRa-MultiAgents: Experimental multi-agent version of AiRA
- Sends the same prompt to multiple Ollama models in parallel
- Aggregates responses for further discussion or voting
- Designed to be kept separate from the main AiRA logic
"""
import asyncio
import os
import requests
from typing import List, Dict, Tuple


Client = None
HAS_OLLAMA = False


# Use the same dynamic Ollama host logic as main AiRA
"""
AiRa-MultiRole: Experimental multi-role version of AiRA
- Sends the same prompt to multiple Ollama models in parallel
- Aggregates responses for further discussion or voting
- Designed to be kept separate from the main AiRA logic
"""
import asyncio
import os
import requests
from typing import List, Dict, Tuple
CLIENT_HOST = 'http://localhost:11434'
def test_multi_agents():
    """
    Test running 3 models in parallel and print/compare their results.
    """
    # You can adjust these model names to match those available in your Ollama instance
    models = [
        'deepseek-v3.1:671b-cloud',
        'deepseek-v3.1:671b-cloud',
        'deepseek-v3.1:671b-cloud',
    ]
    user_query = "Summarize the main challenges in hydrogen explosion research."
    project_path = "/path/to/project"  # Adjust as needed
    results = run_multi_agents(user_query, project_path, models)
    print("\n=== Multi-Agent Results ===")
    for model, response in results.items():
        print(f"\n--- {model} ---\n{response}\n")

if __name__ == "__main__":
    test_multi_agents()

# Helper to get project context (reuse from ai.py if needed)
def get_project_context(project_path: str) -> str:
    # Placeholder: You can import or copy the real implementation
    return f"Project context for {project_path} (implement as needed)"

async def query_model_async(client, model: str, system_content: str, user_query: str) -> str:
    try:
        response = client.chat(model=model, messages=[
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_query}
        ])
        return response['message']['content']
    except Exception as e:
        return f"[Error from {model}: {e}]"


def detect_ollama_ports(num_agents=3, base_port=11434, max_port=11500) -> List[int]:
    """
    Scan for running Ollama servers on localhost from base_port up to max_port.
    Returns a list of ports with active Ollama servers (up to num_agents).
    """
    found_ports = []
    for port in range(base_port, max_port):
        try:
            r = requests.get(f"http://localhost:{port}/api/tags", timeout=1)
            if r.status_code == 200:
                found_ports.append(port)
                if len(found_ports) >= num_agents:
                    break
        except Exception:
            continue
    return found_ports

def run_multi_agents(
    user_query: str,
    project_path: str,
    models: List[str],
    investigator: str = 'the researcher',
    institution: str = 'the institute',
    objective: str = 'hydrogen explosion research',
    plan_desc: str = '',
    app_context: str = ''
) -> Dict[str, str]:
    """
    Runs the same prompt on multiple models in parallel and returns their responses.
    Each agent uses a different Ollama port, auto-detected.
    """
    if not HAS_OLLAMA:
        return {m: '[Ollama not available]' for m in models}
    ports = detect_ollama_ports(num_agents=len(models))
    if len(ports) < len(models):
        return {f"agent_{i+1}": f"[No Ollama server found for agent {i+1}]" for i in range(len(models))}
    system_content = (
        f"You are AiRA, a specialised research assistant for {investigator} at {institution}. "
        f"Project: {os.path.basename(project_path)}. "
        f"Experiment Objective: {objective}. "
        f"Context: {plan_desc}. "
        f"\n--- APP CONTEXT ---\n{app_context}\n"
        f"\n--- PROJECT CONTEXT ---\n{get_project_context(project_path)}\n"
        "Provide PhD-level technical insights.\n"
        "CRITICAL FORMATTING INSTRUCTIONS:\n"
        "1. ALWAYS use Markdown for structure (bullet points, bold text, headers).\n"
        "2. When listing files or papers, use a bulleted list with hyphens (- ), one item per line.\n"
        "3. Use bolding (**Title**) for document names.\n"
        "4. Ensure there is a double line break between different items in a list.\n"
        "5. If a user asks for a list, DO NOT write a paragraph; provide a clean, vertical list.\n"
        "6. If multiple expert personas are active, begin with an 'Active Experts:' line listing every role,\n"
        "   then provide short role-labeled sections with 2-4 bullets each."
    )
    async def gather_all():
        tasks = []
        for i, m in enumerate(models):
            client = Client(host=f"http://localhost:{ports[i]}")
            tasks.append(query_model_async(client, m, system_content, user_query))
        return await asyncio.gather(*tasks)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    results = loop.run_until_complete(gather_all())
    return {f"agent_{i+1}": results[i] for i in range(len(models))}

# Remove multi-model/port logic and focus on multi-role (expert personas roles)
class HydrogenResearchAgents:
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.model = "deepseek-v3.1:671b-cloud"
        # CONSOLIDATED ROLES FOR HYDROGEN SAFETY RESEARCH
        self.agent_roles = {
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
                "Academic advisor focusing on research rigor, methodology clarity, and thesis structure."
            ),
            "project_coordinator": (
                "Project management specialist for timelines, milestones, dependencies, and cross-team coordination."
            )
        }
        self.conversation_history: Dict[str, List[str]] = {role: [] for role in self.agent_roles}
        self.deactivated_roles = set()

    def deactivate_role(self, role: str):
        self.deactivated_roles.add(role)

    def activate_role(self, role: str):
        self.deactivated_roles.discard(role)

    def generate(self, agent_role: str, prompt: str, use_history: bool = True) -> str:
        """Generate response with conversation history"""
        if agent_role in self.deactivated_roles:
            return f"Role '{agent_role}' is deactivated."
        if use_history and self.conversation_history[agent_role]:
            context = "\n".join(self.conversation_history[agent_role][-3:])
            full_prompt = f"Context:\n{context}\n\nNew task: {prompt}"
        else:
            full_prompt = prompt
        try:
            response = requests.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": full_prompt,
                    "system": self.agent_roles[agent_role],
                    "stream": False,
                    "options": {"temperature": 0.7}
                },
                timeout=60
            )
            if response.status_code == 200:
                result = response.json()
                response_text = result["response"]
                self.conversation_history[agent_role].append(f"Q: {prompt}")
                self.conversation_history[agent_role].append(f"A: {response_text}")
                return response_text
            else:
                return f"Error: HTTP {response.status_code}"
        except Exception as e:
            return f"Error: {str(e)}"

    def full_research_workflow(self, research_topic: str):
        """Complete research workflow using all specialists"""
        print(f"🔬 Starting comprehensive research: {research_topic}")
        results = {}
        # Phase 1: Literature & Background
        print("📚 Phase 1: Literature Review")
        results["literature"] = self.generate("literature_reviewer", f"Conduct literature review for: {research_topic}")
        # Phase 2: Theoretical Foundation
        print("⚛️ Phase 2: Theoretical Analysis")
        results["combustion_dynamics"] = self.generate("combustion_dynamics_expert", f"Combustion dynamics analysis for: {research_topic}")
        results["dispersion_cfd"] = self.generate("dispersion_cfd_expert", f"Dispersion and CFD analysis for: {research_topic}")
        # Phase 3: Engineering & Safety
        print("🛡️ Phase 3: Safety Engineering")
        results["risk_safety"] = self.generate("risk_safety_engineer", f"Risk and safety analysis for: {research_topic}")
        results["structural_analysis"] = self.generate("structural_analyst", f"Structural analysis for: {research_topic}")
        # Phase 4: Experimental & Simulation
        print("🧪 Phase 4: Experimental Design")
        results["experimental_instrumentation"] = self.generate("experimental_instrumentation_analyst", f"Experimental and instrumentation analysis for: {research_topic}")
        # Phase 5: Academic & Collaboration
        print("🤝 Phase 5: Academic Integration")
        results["regulatory_analysis"] = self.generate("regulatory_specialist", f"Regulatory analysis for: {research_topic}")
        # Final: Synthesis
        print("📝 Phase 6: Synthesis")
        synthesis_prompt = f"Synthesize all previous analyses into a cohesive research plan:\n"
        for phase, content in results.items():
            synthesis_prompt += f"\n{phase}: {content[:500]}"
        results["research_synthesis"] = self.generate("thesis_advisor", synthesis_prompt)
        results["project_plan"] = self.generate("project_coordinator", f"Create project plan based on: {results['research_synthesis']}")
        return results

    def rapid_expert_consultation(self, specific_question: str, expert_roles: List[str]):
        """Consult specific experts on a focused question"""
        print(f"🎯 Expert consultation: {specific_question}")
        opinions = {}
        for role in expert_roles:
            opinion = self.generate(role, specific_question, use_history=False)
            opinions[role] = opinion
            print(f"   ✅ {role}: consulted")
        return opinions

# Usage examples
# research_team = HydrogenResearchAgents()
# research_results = research_team.full_research_workflow("Hydrogen explosion mitigation in confined spaces")
# safety_question = "Best practices for hydrogen leak detection in industrial facilities"
# safety_experts = ["risk_safety_engineer", "regulatory_specialist"]
# safety_opinions = research_team.rapid_expert_consultation(safety_question, safety_experts)
