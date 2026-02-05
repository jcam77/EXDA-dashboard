import io
import numpy as np
import re


def parse_data_content(content):
    try:
        f = io.StringIO(content)
        lines = [line.strip() for line in f if not line.strip().startswith("#")]
        if not lines:
            return None, None
        data = np.loadtxt(io.StringIO("\n".join(lines).replace(",", " ")))
        if data.ndim == 1:
            data = data.reshape(1, -1)
        t, y = data[:, 0], data[:, 1]
        idx = np.argsort(t)
        return t[idx], y[idx]
    except Exception as e:
        print(f"Parser Error: {e}")
        return None, None


def parse_header_coords(content):
    coords = []
    try:
        for line in content.splitlines():
            if line.strip().startswith("# Probe"):
                match = re.search(r"Probe\s+\d+\s+\(\s*([\d\.-]+)", line)
                if match:
                    coords.append(float(match.group(1)))
            if not line.startswith("#") and len(coords) > 0:
                break
    except Exception:
        pass
    return np.array(coords)


def calculate_flame_speed(content):
    x_coords = parse_header_coords(content)
    if len(x_coords) == 0:
        x, v = parse_data_content(content)
        return (x, v) if x is not None else ([], [])

    ignition_loc = 2.4
    x_coords = x_coords - ignition_loc
    t, _ = parse_data_content(content)

    f = io.StringIO(content)
    lines = [l.strip() for l in f if not l.strip().startswith("#")]
    data = np.loadtxt(io.StringIO("\n".join(lines).replace(",", " ")))
    if data.size == 0:
        return [], []

    time = data[:, 0]
    values = data[:, 1:]

    detected = []
    for i in range(min(len(x_coords), values.shape[1])):
        trace = values[:, i]
        crossings = np.where((trace[:-1] >= 0.5) & (trace[1:] < 0.5))[0]
        if len(crossings) == 0:
            crossings = np.where((trace[:-1] <= 0.5) & (trace[1:] > 0.5))[0]
        if len(crossings) > 0:
            idx = crossings[0]
            t_arr = time[idx] + (time[idx + 1] - time[idx]) * (0.5 - trace[idx]) / (trace[idx + 1] - trace[idx])
            detected.append({"x": x_coords[i], "t": t_arr})

    if len(detected) < 2:
        return [], []
    probes = sorted(detected, key=lambda k: k["x"])

    final_x, final_v = [], []
    for i in range(1, len(probes)):
        dx = probes[i]["x"] - probes[i - 1]["x"]
        dt = probes[i]["t"] - probes[i - 1]["t"]
        if abs(dt) > 1e-5 and abs(dx) > 0.01:
            final_x.append(probes[i]["x"])
            final_v.append(abs(dx / dt))

    return final_x, final_v
