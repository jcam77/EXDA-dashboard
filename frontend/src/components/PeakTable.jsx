import React, { useMemo, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { formatPeakValue, stripUnitSuffix, unitSuffix } from '../utils/peakFormat';
import { convertValueByUnit, isVoltageOrTrigger } from '../utils/units';

const INPUT = 'w-28 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary/60';


// Max and time of max per selected channel inside a time range, calculated by the
// backend from every sample of the file (not from the plot preview). Screen only.
const PeakTable = ({
  apiBaseUrl,
  projectPath,
  filePath,
  channels,
  unitTokenFor,
  convertToKpa,
  range,
  onRangeChange,
  included,
  onIncludedChange,
  plotWindow,
}) => {
  const [result, setResult] = useState(null);  // { request, channels }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const start = String(range?.start ?? '');
  const end = String(range?.end ?? '');
  const startNumber = start.trim() === '' ? NaN : Number(start);
  const endNumber = end.trim() === '' ? NaN : Number(end);
  const rangeSet = Number.isFinite(startNumber) && Number.isFinite(endNumber);
  const rangeProblem = !rangeSet
    ? 'Set a time range (start and end, in s) to calculate the peaks.'
    : endNumber <= startNumber ? 'The end of the time range must be after its start.' : '';

  const selectedIndices = useMemo(
    () => channels.filter((channel) => included[channel.key]).map((channel) => channel.index).sort((a, b) => a - b),
    [channels, included],
  );
  const requestKey = JSON.stringify({ filePath, start: startNumber, end: endNumber, selectedIndices });
  // Values are only shown while they match the current range and ticks.
  const stale = Boolean(result) && result.request !== requestKey;
  const resultByIndex = useMemo(
    () => new Map((stale ? [] : (result?.channels || [])).map((row) => [row.index, row])),
    [result, stale],
  );

  const calculate = async () => {
    if (rangeProblem || !selectedIndices.length) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/channel_peaks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          path: filePath,
          windowStart: startNumber,
          windowEnd: endNumber,
          channelIndices: selectedIndices,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not calculate the peaks');
      setResult({ request: requestKey, channels: data.channels || [] });
    } catch (err) {
      setError(err.message || 'Could not calculate the peaks');
    } finally {
      setLoading(false);
    }
  };

  const plotWindowSet = Number.isFinite(Number(plotWindow?.start)) && Number.isFinite(Number(plotWindow?.end))
    && String(plotWindow?.start ?? '').trim() !== '' && String(plotWindow?.end ?? '').trim() !== '';

  return (
    <div className="mt-4 rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-primary" />
          <div>
            <div className="text-sm font-bold text-foreground">Peak pressures</div>
            <div className="text-[11px] text-muted-foreground">
              From every sample of the file inside the time range (shaded in the plot). Raw values: no filter, no baseline correction.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1 text-muted-foreground">
            Start (s)
            <input aria-label="Peak range start (s)" className={INPUT} value={start} inputMode="decimal"
              onChange={(event) => onRangeChange({ start: event.target.value, end })} placeholder="e.g. 0" />
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            End (s)
            <input aria-label="Peak range end (s)" className={INPUT} value={end} inputMode="decimal"
              onChange={(event) => onRangeChange({ start, end: event.target.value })} placeholder="e.g. 0.5" />
          </label>
          {plotWindowSet && (
            <button type="button" onClick={() => onRangeChange({ start: String(plotWindow.start), end: String(plotWindow.end) })}
              className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground">
              Use plot window
            </button>
          )}
          <button
            type="button"
            onClick={calculate}
            disabled={loading || Boolean(rangeProblem) || !selectedIndices.length}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-1 font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {loading ? 'Calculating…' : 'Calculate peaks'}
          </button>
        </div>
      </div>

      {(rangeProblem || error || stale || !selectedIndices.length) && (
        <div className={`mb-2 text-[11px] ${error ? 'text-destructive' : 'text-[hsl(var(--warning))]'}`}>
          {error
            || rangeProblem
            || (!selectedIndices.length ? 'Tick at least one channel.' : '')
            || 'Range or channel selection changed: values cleared, click Calculate peaks.'}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-10 py-1.5 pr-2">Use</th>
              <th className="py-1.5 pr-4">Channel</th>
              <th className="py-1.5 pr-4 text-right">Max</th>
              <th className="py-1.5 pr-4 text-right">Time of max</th>
              <th className="py-1.5 text-right">Samples in range</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => {
              const unitToken = unitTokenFor(channel);
              const use = Boolean(included[channel.key]);
              const row = use ? resultByIndex.get(channel.index) : null;
              const convert = isVoltageOrTrigger(channel, unitToken) ? (v) => v : (v) => convertValueByUnit(v, unitToken, convertToKpa);
              const max = row && row.max !== null ? convert(row.max) : NaN;
              const unit = channel.unit && channel.unit !== 'raw' ? channel.unit : 'raw';
              const recorded = unitSuffix(channel.label) || channel.sourceUnit || '';
              const name = stripUnitSuffix(channel.label) || `Channel ${channel.index + 1}`;
              return (
                <tr key={channel.key} className={`border-b border-border/50 ${use ? '' : 'opacity-50'}`}>
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={use}
                      onChange={(event) => onIncludedChange(channel.key, event.target.checked)}
                      aria-label={`Use ${channel.label || `channel ${channel.index + 1}`} for the peak table`}
                      className="h-3.5 w-3.5 ![accent-color:hsl(var(--primary))]"
                    />
                  </td>
                  <td className="py-1.5 pr-4">
                    <span className="font-semibold text-foreground">{name}</span>
                    {recorded && recorded.toLowerCase() !== unit.toLowerCase() && (
                      <span className="ml-2 text-[11px] text-muted-foreground">recorded in {recorded}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {use && row && Number.isFinite(max) ? (
                      <>
                        <span className="text-foreground">{formatPeakValue(max, unit)}</span>
                        <span className="ml-1 text-muted-foreground">{unit}</span>
                      </>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {use && row && Number.isFinite(row.tMax) ? (
                      <>
                        <span className="text-foreground">{(row.tMax * 1000).toFixed(3)}</span>
                        <span className="ml-1 text-muted-foreground">ms</span>
                      </>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 text-right font-mono text-muted-foreground">
                    {use && row ? (row.samples ? row.samples.toLocaleString() : 'no samples in range') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PeakTable;
