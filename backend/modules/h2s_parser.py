"""Parser for H2S hydrogen sensor logs (EXDA-Check B6).

Format (tab-separated, Latin-1, CRLF):

    Device address<TAB>Device ID<TAB>Factory Device ID<TAB>...<TAB>Temp_Cal (°C)
    FF46<TAB>D2<TAB>12J692<TAB>...                      <- device metadata
    Iteration<TAB>Time<TAB>Output (%)<TAB>...            <- column header
    0<TAB>16:18:45.67<TAB>0.0460<TAB>...                 <- rows, time of day

A file can hold several recordings, each starting with a new
"Device address" header. Recordings are returned separately and are never
concatenated. The logged time stamps are kept as recorded; elapsed time is
computed per recording (a midnight roll-over adds 24 h, nothing else).
"""

from __future__ import annotations

import hashlib
import re

HEADER_MARKER = "device address"
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$")


class H2SParseError(ValueError):
    pass


def looks_like_h2s(text_or_lines) -> bool:
    if isinstance(text_or_lines, str):
        first = text_or_lines.lstrip("﻿").split("\n", 1)[0]
    else:
        first = text_or_lines[0] if text_or_lines else ""
    return first.strip().lower().startswith(HEADER_MARKER)


def _cells(line):
    cells = [cell.strip() for cell in line.rstrip("\r\n").split("\t")]
    while cells and cells[-1] == "":
        cells.pop()
    return cells


def _split_unit(label):
    match = re.match(r"^(.*?)\s*\(([^()]*)\)\s*$", label)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return label.strip(), ""


def _seconds_of_day(token):
    match = TIME_RE.match(token.strip())
    if not match:
        return None
    hours, minutes, seconds = int(match.group(1)), int(match.group(2)), float(match.group(3))
    return hours * 3600 + minutes * 60 + seconds


def _to_float(token):
    try:
        return float(token.replace(",", "."))
    except (AttributeError, ValueError):
        return None


def read_text(path):
    with open(path, "rb") as handle:
        raw = handle.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def parse_h2s_text(text):
    """Return a list of recordings (dicts). Raises H2SParseError if not an H2S log."""
    lines = text.lstrip("﻿").splitlines()
    if not looks_like_h2s(lines):
        raise H2SParseError("Not an H2S sensor log (first line is not a 'Device address' header).")

    starts = [i for i, line in enumerate(lines) if line.strip().lower().startswith(HEADER_MARKER)]
    blocks = []
    for number, start in enumerate(starts):
        end = starts[number + 1] if number + 1 < len(starts) else len(lines)
        chunk = lines[start:end]
        device_keys = _cells(chunk[0])
        device_vals = _cells(chunk[1]) if len(chunk) > 1 else []
        device = {}
        for idx, key in enumerate(device_keys):
            if key:
                device[key] = device_vals[idx] if idx < len(device_vals) else ""
        header = _cells(chunk[2]) if len(chunk) > 2 else []
        columns = []
        for label in header:
            name, unit = _split_unit(label)
            columns.append({"label": label, "name": name, "unit": unit})

        time_col = next((i for i, c in enumerate(columns) if c["name"].lower() == "time"), None)
        iter_col = next((i for i, c in enumerate(columns) if c["name"].lower() == "iteration"), None)
        value_cols = [i for i in range(len(columns)) if i not in (time_col, iter_col)]

        rows_time_tokens, rows_seconds, rows_iter, rows_values = [], [], [], []
        skipped = 0
        for line in chunk[3:]:
            cells = _cells(line)
            if not cells:
                continue
            if time_col is None or time_col >= len(cells):
                skipped += 1
                continue
            seconds = _seconds_of_day(cells[time_col])
            values = [_to_float(cells[i]) if i < len(cells) else None for i in value_cols]
            if seconds is None or any(v is None for v in values):
                skipped += 1
                continue
            rows_time_tokens.append(cells[time_col])
            rows_seconds.append(seconds)
            rows_iter.append(_to_float(cells[iter_col]) if iter_col is not None and iter_col < len(cells) else None)
            rows_values.append(values)

        elapsed = []
        day_offset = 0.0
        previous = None
        for seconds in rows_seconds:
            if previous is not None and seconds + 12 * 3600 < previous:
                day_offset += 86400.0  # midnight roll-over
            elapsed.append(seconds + day_offset - (rows_seconds[0] if rows_seconds else 0.0))
            previous = seconds

        digest = hashlib.sha1()
        for token, values in zip(rows_time_tokens, rows_values):
            digest.update((token + "|" + ",".join(f"{v:.9g}" for v in values) + "\n").encode())

        blocks.append({
            "index": number,
            "device": device,
            "columns": [columns[i] for i in value_cols],
            "timeColumn": columns[time_col]["label"] if time_col is not None else None,
            "rowCount": len(rows_seconds),
            "skippedRows": skipped,
            "timeStart": rows_time_tokens[0] if rows_time_tokens else None,
            "timeEnd": rows_time_tokens[-1] if rows_time_tokens else None,
            "durationS": elapsed[-1] if elapsed else 0.0,
            "fingerprint": digest.hexdigest()[:16] if rows_seconds else None,
            "elapsed": elapsed,
            "values": rows_values,
            "iterations": rows_iter,
            "timeTokens": rows_time_tokens,
        })
    return blocks


def block_summaries(blocks):
    """Block metadata without the sample arrays; flags empty and duplicate recordings."""
    seen = {}
    summaries = []
    for block in blocks:
        summary = {k: v for k, v in block.items() if k not in ("elapsed", "values", "iterations", "timeTokens")}
        summary["empty"] = block["rowCount"] == 0
        fp = block["fingerprint"]
        summary["duplicateOf"] = seen.get(fp) if fp else None
        if fp and fp not in seen:
            seen[fp] = block["index"]
        summaries.append(summary)
    return summaries


def select_block(blocks, block_index=None):
    """Pick a recording. Without an index, only an unambiguous file is accepted."""
    if block_index is not None:
        try:
            idx = int(block_index)
        except (TypeError, ValueError):
            raise H2SParseError(f"Invalid recording number: {block_index!r}") from None
        if idx < 0 or idx >= len(blocks):
            raise H2SParseError(f"Recording {idx + 1} does not exist (file has {len(blocks)}).")
        return blocks[idx]
    non_empty = [b for b in blocks if b["rowCount"] > 0]
    if len(non_empty) == 1:
        return non_empty[0]
    if not non_empty:
        raise H2SParseError("H2S file has no data rows.")
    raise H2SParseError(
        f"H2S file contains {len(non_empty)} recordings; choose one. Recordings are never joined."
    )


def block_to_content(block):
    """CSV text (time in s from the recording start, units in the header)."""
    header = ["time [s]"] + [
        f"{c['name']} [{c['unit']}]" if c["unit"] else c["name"] for c in block["columns"]
    ]
    lines = [",".join(header)]
    for t, values in zip(block["elapsed"], block["values"]):
        lines.append(f"{t:.6g}," + ",".join(f"{v:.9g}" for v in values))
    return "\n".join(lines)
