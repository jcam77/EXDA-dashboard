export const DEFAULT_INPUT_UNIT = 'bar';

export const UNIT_OPTIONS = [
  { value: 'bar', label: 'bar' },
  { value: 'kPa', label: 'kPa' },
  { value: 'Pa', label: 'Pa' },
  { value: 'V', label: 'V (trigger)' },
];

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
  if (unit === 'pa' || unit === 'pascal' || unit === 'pascals') return (y - 101325.0) / 1000.0;
  return y;
};

export const getChannelDisplayUnit = (channel, selectedInputUnit, convertToKpa) => {
  const explicit = normalizeUnitToken(selectedInputUnit);
  const inferred = normalizeUnitToken(channel?.unit);
  const role = normalizeUnitToken(channel?.role);
  const base = explicit || inferred;
  if (base === 'v' || role === 'trigger') return 'V';
  if (base === 'kpa' || base === 'kpag') return 'kPa';
  if (base === 'pa' || base === 'pascal' || base === 'pascals') return convertToKpa ? 'kPa' : 'Pa';
  if (base === 'bar' || base === 'barg') return convertToKpa ? 'kPa' : 'bar';
  return convertToKpa ? (role === 'pressure' ? 'kPa' : (channel?.unit || 'raw')) : (channel?.unit || 'raw');
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
