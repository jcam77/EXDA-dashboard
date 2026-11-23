"""Output formatting for screens and exports (EXDA-Check item 8).

Stored values are never rewritten; these helpers are applied only when values
are displayed or exported, to hide binary floating-point noise such as
295.34999999999997 K (22.2 + 273.15) or 13.670800000000002 g.

Precision:
  temperature  K: 2 decimals, °C: 1 decimal
  pressure     Pa: whole numbers
  H2 mass      g: 3 decimals
  fill time    s: 1 decimal

Blank stays blank, and a non-numeric value is passed through unchanged
(so nothing that was recorded is hidden).
"""

from __future__ import annotations


def fmt_fixed(value, decimals: int) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    try:
        number = float(text.replace(",", "."))
    except ValueError:
        return text
    if number != number or number in (float("inf"), float("-inf")):
        return text
    formatted = f"{number:.{decimals}f}"
    # Avoid "-0.00" for values that round to zero.
    if formatted.startswith("-") and float(formatted) == 0:
        formatted = formatted[1:]
    return formatted


def fmt_temp_k(value) -> str:
    return fmt_fixed(value, 2)


def fmt_temp_c(value) -> str:
    return fmt_fixed(value, 1)


def fmt_pressure_pa(value) -> str:
    return fmt_fixed(value, 0)


def fmt_mass_g(value) -> str:
    return fmt_fixed(value, 3)


def fmt_time_s(value) -> str:
    return fmt_fixed(value, 1)
