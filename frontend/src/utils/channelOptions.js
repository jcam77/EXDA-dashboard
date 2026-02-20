const MAX_SCAN_LINES = 120;
const MAX_CHANNEL_OPTIONS = 64;

const splitTokens = (line) => {
  if (!line) return [];
  if (line.includes(';')) return line.split(';').map((t) => t.trim());
  if (line.includes(',')) return line.split(',').map((t) => t.trim());
  return line.trim().split(/\s+/).map((t) => t.trim());
};

const isNumericToken = (token) => {
  if (token === null || token === undefined) return false;
  const text = String(token).trim();
  if (!text) return false;
  const parsed = Number(text);
  return Number.isFinite(parsed);
};

const looksLikeTimeToken = (token) => {
  const text = String(token || '').trim();
  if (!text) return false;
  if (isNumericToken(text)) return true;
  if (text.includes(':')) return true;
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(text)) return true;
  return false;
};

const inferFromContent = (content) => {
  const text = String(content || '');
  if (!text.trim()) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_SCAN_LINES);
  if (!lines.length) return [];

  let dataIdx = -1;
  let dataTokens = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const tokens = splitTokens(lines[idx]);
    if (tokens.length < 2) continue;
    const firstLooksLikeTime = looksLikeTimeToken(tokens[0]);
    const restNumeric = tokens.slice(1).every(isNumericToken);
    if (firstLooksLikeTime && restNumeric) {
      dataIdx = idx;
      dataTokens = tokens;
      break;
    }
  }
  if (dataIdx < 0 || dataTokens.length < 2) return [];

  let headers = null;
  if (dataIdx > 0) {
    const candidate = splitTokens(lines[dataIdx - 1]);
    const hasText = candidate.some((token) => !isNumericToken(token));
    if (hasText && candidate.length === dataTokens.length) {
      headers = candidate;
    }
  }

  const signalCols = Math.min(MAX_CHANNEL_OPTIONS, Math.max(0, dataTokens.length - 1));
  const options = [];
  for (let idx = 0; idx < signalCols; idx += 1) {
    const labelToken = headers?.[idx + 1];
    const label = labelToken ? `${labelToken} (Ch ${idx + 1})` : `Ch ${idx + 1}`;
    options.push({ value: idx, label });
  }
  return options;
};

export const deriveChannelOptionsFromCases = (cases = []) => {
  const list = Array.isArray(cases) ? cases : [];
  let best = [];
  for (const item of list) {
    const inferred = inferFromContent(item?.content);
    if (inferred.length > best.length) best = inferred;
  }
  return best;
};

export const deriveChannelOptionsFromCase = (item) => inferFromContent(item?.content);
