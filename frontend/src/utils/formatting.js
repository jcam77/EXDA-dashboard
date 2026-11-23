// Output formatting for screens (EXDA-Check item 8). Mirrors
// backend/modules/output_format.py. Stored values are never rewritten; this is
// applied only at display time to hide floating-point noise such as
// 295.34999999999997 K or 13.670800000000002 g.
//
// Precision: T 2 decimals in K / 1 decimal in °C, P whole Pa,
// H2 mass 3 decimals (g), fill time 1 decimal (s).
// Blank stays blank; a non-numeric value is shown unchanged.

export const formatFixed = (value, decimals) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const numeric = Number(text.replace(',', '.'));
  if (!Number.isFinite(numeric)) return text;
  const formatted = numeric.toFixed(decimals);
  return Number(formatted) === 0 ? formatted.replace(/^-/, '') : formatted;
};

export const formatTempK = (value) => formatFixed(value, 2);
export const formatTempC = (value) => formatFixed(value, 1);
export const formatPressurePa = (value) => formatFixed(value, 0);
export const formatMassG = (value) => formatFixed(value, 3);
export const formatTimeS = (value) => formatFixed(value, 1);
