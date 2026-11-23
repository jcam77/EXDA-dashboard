export const DEFAULT_INPUT_UNIT = 'bar';

// 'auto' = use the unit stored in the file header (EXDA-Check B5).
export const FROM_FILE_UNIT = 'auto';

export const UNIT_OPTIONS = [
  { value: 'bar', label: 'bar' },
  { value: 'kPa', label: 'kPa' },
  { value: 'Pa', label: 'Pa' },
  { value: 'V', label: 'V (trigger)' },
];

export const UNIT_OPTIONS_WITH_FILE = [{ value: FROM_FILE_UNIT, label: 'From file' }, ...UNIT_OPTIONS];

export const normalizeUnitToken = (value) => {
  const raw = String(value || 'raw').trim().toLowerCase();
  if (!raw) return 'raw';
  if (raw === 'raw') return raw;

  const compact = raw
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replaceAll('(', '')
    .replaceAll(')', '')
    .replace(/[\s_-]+/g, '');
  if (compact === 'mbar' || compact === 'mbarg') return 'mbar';
  if (compact === 'hpa') return 'hpa';
  if (compact === 'mpa') return 'mpa';
  if (compact === 'mv') return 'mv';
  if (compact.includes('kpa') || compact.includes('kpag')) return 'kpa';
  if (compact.includes('bar') || compact.includes('barg')) return 'bar';
  if (compact === 'pa' || compact.includes('pascal')) return 'pa';
  if (compact === 'v' || compact.includes('volt')) return 'v';

  return raw;
};

export const convertValueByUnit = (value, unit, convertToKpa) => {
  const y = Number(value);
  if (!Number.isFinite(y)) return y;
  if (!convertToKpa) return y;
  if (unit === 'bar' || unit === 'barg') return y * 100.0;
  if (unit === 'mbar' || unit === 'hpa') return y * 0.1;
  if (unit === 'mpa') return y * 1000.0;
  // Gauge: Pa -> kPa is a pure unit change. No fixed 101325 Pa offset (EXDA-Check B4).
  if (unit === 'pa' || unit === 'pascal' || unit === 'pascals') return y / 1000.0;
  return y;
};

export const getChannelDisplayUnit = (channel, selectedInputUnit, convertToKpa) => {
  const explicit = normalizeUnitToken(selectedInputUnit);
  const inferred = normalizeUnitToken(channel?.unit);
  const role = normalizeUnitToken(channel?.role);
  const base = explicit || inferred;
  if (base === 'v' || base === 'mv') return base === 'mv' ? 'mV' : 'V';
  if (base === 'kpa' || base === 'kpag') return 'kPa';
  if (base === 'pa' || base === 'pascal' || base === 'pascals') return convertToKpa ? 'kPa' : 'Pa';
  if (base === 'bar' || base === 'barg') return convertToKpa ? 'kPa' : 'bar';
  if (base === 'mbar') return convertToKpa ? 'kPa' : 'mbar';
  if (base === 'hpa') return convertToKpa ? 'kPa' : 'hPa';
  if (base === 'mpa') return convertToKpa ? 'kPa' : 'MPa';
  // Unknown unit: values are not converted, so they are not labelled kPa.
  if (role === 'trigger') return 'V';
  return channel?.unit && normalizeUnitToken(channel.unit) !== 'raw' ? channel.unit : 'raw';
};

export const getDisplayUnitFromSetting = (inputUnit, convertToKpa) => {
  if (convertToKpa !== false) return 'kPa';
  const selected = normalizeUnitToken(inputUnit || 'raw');
  if (selected === 'bar') return 'bar';
  if (selected === 'kpa') return 'kPa';
  if (selected === 'pa') return 'Pa';
  if (selected === 'v') return 'V';
  return 'raw';
};
