// Display helpers for the screening peak table.

// Fixed decimals per display unit, so a column of values lines up.
const DECIMALS = { kPa: 3, bar: 5, mbar: 2, hPa: 2, Pa: 1, MPa: 6, V: 3, mV: 1 };

export const formatPeakValue = (value, unit) => {
  if (!Number.isFinite(value)) return '—';
  const decimals = DECIMALS[unit];
  if (decimals !== undefined) return value.toFixed(decimals);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return value.toExponential(4);
  return value.toPrecision(5);
};

// "A1 (0.A1) [bar]" -> "A1 (0.A1)": the unit is shown with the value instead.
export const stripUnitSuffix = (label) => String(label || '').replace(/\s*\[[^[\]]*\]\s*$/, '').trim();

// Unit as recorded in the file, from a label like "A1 (0.A1) [bar]" ('' if none).
export const unitSuffix = (label) => {
  const match = String(label || '').match(/\[([^[\]]+)\]\s*$/);
  return match ? match[1].trim() : '';
};
