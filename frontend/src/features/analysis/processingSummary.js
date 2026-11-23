// Human-readable lines for a pressure result's processing record
// (EXDA-Check B1-B4: every result states how it was computed).

const fmtNumber = (value, digits = 6) => {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '-';
  return String(Number(n.toPrecision(digits)));
};

export const describeProcessing = (processing) => {
  if (!processing || typeof processing !== 'object') return [];
  const lines = [];
  const src = processing.source || {};
  if (src.file || src.channelName) {
    const parts = [src.relativePath || src.file, src.channelName && `channel ${src.channelName}`, src.run && `run ${src.run}`];
    lines.push(`Source: ${parts.filter(Boolean).join(', ')}`);
  }
  lines.push(
    `Samples analysed: ${processing.samplesAnalysed ?? '-'} at fs = ${fmtNumber(processing.fsHz)} Hz` +
      (src.fullResolution ? ' (full resolution, no decimation)' : '')
  );
  if (processing.window) {
    lines.push(`Time window: ${fmtNumber(processing.window.start)} .. ${fmtNumber(processing.window.end)} s`);
  }
  if (processing.unit) {
    lines.push(`Unit: ${processing.unit.input} (${processing.unit.origin}) -> ${processing.unit.output}. ${processing.unit.note || ''}`.trim());
  }
  if (processing.reference) lines.push(processing.reference.note || `Reference: ${processing.reference.reference}`);
  if (processing.baseline) lines.push(processing.baseline.note || 'Baseline: not applied');
  const f = processing.filter || {};
  if (f.applied) {
    lines.push(`Filter: ${f.type}, order ${f.order}, cutoff ${fmtNumber(f.cutoffHz)} Hz, fs ${fmtNumber(f.fsHz)} Hz`);
    lines.push(f.resampled ? `Resampled: yes. ${f.resamplingNote || ''}`.trim() : 'Resampled: no');
  } else {
    lines.push(`Filter: not applied${f.note ? ` (${f.note})` : ''}`);
  }
  if (processing.impulseEndFraction !== undefined) {
    lines.push(`Impulse end threshold: ${fmtNumber(processing.impulseEndFraction * 100, 4)}% of Pmax`);
  }
  (processing.warnings || []).forEach((w) => lines.push(`Warning: ${w}`));
  if (processing.plot) lines.push(`Plot: ${processing.plot}`);
  return lines;
};

export const resultUnitLabel = (results) => {
  const units = Array.from(
    new Set((results || []).map((item) => item?.metrics?.pressureUnit).filter(Boolean))
  );
  if (units.length === 0) return '';
  if (units.length === 1) return units[0];
  return `mixed: ${units.join(', ')}`;
};
