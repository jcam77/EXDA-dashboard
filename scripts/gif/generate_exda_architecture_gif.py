#!/usr/bin/env python3
"""Generate a dark-mode EXDA architecture GIF with smooth flow transitions."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image, ImageDraw, ImageFont

W, H = 640, 360
SCALE = 2
RW, RH = W * SCALE, H * SCALE
FPS = 10
DURATION_S = 20
FRAMES = FPS * DURATION_S
PHASE_COUNT = 5
PHASE_FRAMES = FRAMES // PHASE_COUNT
FADE_FRAMES = 8

COLORS = {
    "bg": "#0b0e14",
    "primary": "#5ac7e2",
    "accent": "#92eafc",
    "muted": "#2a3140",
    "muted_fg": "#a7b2be",
    "fg": "#f1f5f8",
    "border": "#3a4251",
    "warning": "#996214",
}

Node = Dict[str, object]
Edge = Tuple[str, str]


def hex_to_rgb(c: str) -> Tuple[int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def blend(c1: str, c2: str, t: float) -> Tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    a = hex_to_rgb(c1)
    b = hex_to_rgb(c2)
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def load_fonts():
    reg = Path("frontend/public/fonts/Inter/static/Inter_18pt-Regular.ttf")
    sem = Path("frontend/public/fonts/Inter/static/Inter_18pt-SemiBold.ttf")
    try:
        return (
            ImageFont.truetype(str(sem), 16 * SCALE),
            ImageFont.truetype(str(reg), 11 * SCALE),
            ImageFont.truetype(str(reg), 10 * SCALE),
        )
    except Exception:
        d = ImageFont.load_default()
        return d, d, d


def get_nodes() -> List[Node]:
    return [
        {"id": "user", "label": "User", "x": 42, "y": 180},
        {"id": "plan", "label": "Plan", "x": 108, "y": 180},
        {"id": "meta", "label": "Run meta", "x": 186, "y": 180},
        {"id": "raw", "label": "Raw data", "x": 270, "y": 122},
        {"id": "clean", "label": "Clean data", "x": 270, "y": 180},
        {"id": "cfd", "label": "CFD data", "x": 270, "y": 238},
        {"id": "api", "label": "API", "x": 358, "y": 180},
        {"id": "pressure", "label": "Pressure", "x": 450, "y": 122},
        {"id": "ewt", "label": "EWT", "x": 450, "y": 180},
        {"id": "verify", "label": "Verify", "x": 450, "y": 238},
        {"id": "decision", "label": "Decision", "x": 556, "y": 180},
    ]


def get_edges() -> List[Edge]:
    return [
        ("user", "plan"),
        ("plan", "meta"),
        ("meta", "raw"),
        ("meta", "clean"),
        ("meta", "cfd"),
        ("raw", "api"),
        ("clean", "api"),
        ("cfd", "api"),
        ("api", "pressure"),
        ("api", "ewt"),
        ("api", "verify"),
        ("pressure", "decision"),
        ("ewt", "decision"),
        ("verify", "decision"),
    ]


def get_phases() -> List[Dict[str, object]]:
    return [
        {
            "title": "Phase 1: Plan and run definition",
            "edges": [("user", "plan"), ("plan", "meta")],
        },
        {
            "title": "Phase 2: Data organization per test",
            "edges": [("meta", "raw"), ("meta", "clean"), ("meta", "cfd")],
        },
        {
            "title": "Phase 3: Frontend to backend pipeline",
            "edges": [("raw", "api"), ("clean", "api"), ("cfd", "api")],
        },
        {
            "title": "Phase 4: Results and verification outputs",
            "edges": [("api", "pressure"), ("api", "ewt"), ("api", "verify")],
        },
        {
            "title": "Phase 5: Fast engineering decision support",
            "edges": [("pressure", "decision"), ("ewt", "decision"), ("verify", "decision")],
        },
    ]


def edge_activity(frame_idx: int, phases: List[Dict[str, object]]) -> Dict[Edge, float]:
    p = min(PHASE_COUNT - 1, frame_idx // PHASE_FRAMES)
    local = frame_idx - p * PHASE_FRAMES
    prev_p = max(0, p - 1)
    out: Dict[Edge, float] = {}

    for e in phases[prev_p]["edges"]:  # type: ignore[index]
        out[e] = 0.15
    for e in phases[p]["edges"]:  # type: ignore[index]
        out[e] = 1.0

    if local < FADE_FRAMES and p > 0:
        t = local / max(1, FADE_FRAMES - 1)
        for e in phases[prev_p]["edges"]:  # type: ignore[index]
            out[e] = max(out.get(e, 0.0), 1.0 - t)
        for e in phases[p]["edges"]:  # type: ignore[index]
            out[e] = max(out.get(e, 0.0), t)

    return out


def draw_edge(draw: ImageDraw.ImageDraw, a: Node, b: Node, act: float):
    ax, ay = int(a["x"]) * SCALE, int(a["y"]) * SCALE
    bx, by = int(b["x"]) * SCALE, int(b["y"]) * SCALE
    color = blend(COLORS["border"], COLORS["primary"], act)
    draw.line((ax, ay, bx, by), fill=color, width=1 * SCALE)


def draw_flow_dot(draw: ImageDraw.ImageDraw, a: Node, b: Node, t: float):
    ax, ay = int(a["x"]) * SCALE, int(a["y"]) * SCALE
    bx, by = int(b["x"]) * SCALE, int(b["y"]) * SCALE
    x = int(ax + (bx - ax) * t)
    y = int(ay + (by - ay) * t)
    r = 2 * SCALE
    draw.ellipse((x - r, y - r, x + r, y + r), fill=hex_to_rgb(COLORS["accent"]))


def draw_node(draw: ImageDraw.ImageDraw, node: Node, act: float, text_font):
    x, y = int(node["x"]) * SCALE, int(node["y"]) * SCALE
    r = 12 * SCALE
    fill = blend(COLORS["muted"], COLORS["primary"], act)
    out = blend(COLORS["border"], COLORS["accent"], act)
    draw.ellipse((x - r, y - r, x + r, y + r), fill=fill, outline=out, width=1 * SCALE)
    # Subtle inner highlight ring for cleaner "modern" node look.
    inner = r - 3 * SCALE
    draw.ellipse((x - inner, y - inner, x + inner, y + inner), outline=blend(COLORS["muted"], COLORS["accent"], act * 0.65), width=1 * SCALE)
    lbl = str(node["label"])
    tw = draw.textlength(lbl, font=text_font)
    draw.text((x - tw / 2, y + 18 * SCALE), lbl, fill=hex_to_rgb(COLORS["muted_fg"]), font=text_font)


def main():
    title_font, text_font, caption_font = load_fonts()
    nodes = get_nodes()
    nmap = {str(n["id"]): n for n in nodes}
    edges = get_edges()
    phases = get_phases()
    frames: List[Image.Image] = []

    for i in range(FRAMES):
        phase_idx = min(PHASE_COUNT - 1, i // PHASE_FRAMES)
        local = i - phase_idx * PHASE_FRAMES
        phase_t = local / max(1, PHASE_FRAMES - 1)
        activity = edge_activity(i, phases)

        img = Image.new("RGB", (RW, RH), color=hex_to_rgb(COLORS["bg"]))
        d = ImageDraw.Draw(img)
        # Keep canvas clean like the reference style (no card container).

        title = "EXDA workflow architecture"
        tw = d.textlength(title, font=title_font)
        d.text(((RW - tw) / 2, 16 * SCALE), title, fill=hex_to_rgb(COLORS["fg"]), font=title_font)

        # Draw baseline network first, then active overlays.
        for e in edges:
            a, b = nmap[e[0]], nmap[e[1]]
            draw_edge(d, a, b, activity.get(e, 0.08))

        # Flow dots on active phase edges.
        active_edges = phases[phase_idx]["edges"]  # type: ignore[index]
        for idx, e in enumerate(active_edges):
            a, b = nmap[e[0]], nmap[e[1]]
            dot_t = (phase_t + idx * 0.23) % 1.0
            draw_flow_dot(d, a, b, dot_t)

        # Node activity from incident edges.
        node_act: Dict[str, float] = {str(n["id"]): 0.08 for n in nodes}
        for (a, b), v in activity.items():
            node_act[a] = max(node_act.get(a, 0.08), v)
            node_act[b] = max(node_act.get(b, 0.08), v)

        # Decision node gets warning tint in last phase.
        if phase_idx == 4:
            node_act["decision"] = max(node_act["decision"], 1.0)

        for n in nodes:
            act = node_act[str(n["id"])]
            draw_node(d, n, act, text_font)

        # Caption with subtle fade-in per phase.
        cap = str(phases[phase_idx]["title"])  # type: ignore[index]
        ct = min(1.0, local / max(1, FADE_FRAMES))
        cap_color = blend(COLORS["border"], COLORS["muted_fg"], ct)
        cw = d.textlength(cap, font=caption_font)
        d.text(((RW - cw) / 2, RH - 16 * SCALE), cap, fill=cap_color, font=caption_font)

        frames.append(img.resize((W, H), Image.Resampling.LANCZOS))

    out = Path("frontend/public/EXDAArchitectureFlow.gif")
    out.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        out,
        save_all=True,
        append_images=frames[1:],
        duration=int(1000 / FPS),
        loop=0,
        optimize=False,
    )
    print(f"Created: {out}")


if __name__ == "__main__":
    main()
