import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, AudioLines, RefreshCw, Sigma } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getBackendBaseUrl } from '../utils/backendUrl';

const SERIES_ORDER = [
  { key: 'clean_raw', label: 'Clean (reference)' },
  { key: 'noisy_raw', label: 'Noisy (input)' },
  { key: 'noisy_filtered', label: 'Noisy filtered' },
];
const PRESSURE_DIGITS = 5;

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDelta = (pythonValue, referenceValue) => {
  const p = toNumber(pythonValue);
  const m = toNumber(referenceValue);
  if (p === null || m === null) return '-';
  return Math.abs(p - m).toFixed(PRESSURE_DIGITS);
};

const formatFixed = (value, digits = 3) => {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : '-';
};

const AppCalculationsVerificationPage = () => {
  const apiBaseUrl = getBackendBaseUrl();
  const [activeSection, setActiveSection] = useState('ewt');
  const [settings, setSettings] = useState({
    decayPercent: 95,
    cutoffHz: 20,
    order: 4,
    ewtNumModes: 5,
    ewtMaxPoints: 1200,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState({
    plotData: [],
    pythonMetrics: {},
    matlabMetrics: {},
    matlabMetricsAvailable: false,
    matlabMetricsFile: '',
    settings: null,
    ewtData: null,
    ewtError: null,
    ewtPeakAlignment: [],
    ewtAlignmentAvailable: false,
  });

  const fetchVerificationData = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        decayPercent: String(settings.decayPercent),
        cutoffHz: String(settings.cutoffHz),
        order: String(settings.order),
        ewtNumModes: String(settings.ewtNumModes),
        ewtMaxPoints: String(settings.ewtMaxPoints),
      });
      const response = await fetch(`${apiBaseUrl}/calculation_verification?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load verification data');
      }
      setPayload(data);
    } catch (err) {
      setError(err.message || 'Failed to load verification data');
    } finally {
      setIsLoading(false);
    }
  }, [
    apiBaseUrl,
    settings.cutoffHz,
    settings.decayPercent,
    settings.ewtMaxPoints,
    settings.ewtNumModes,
    settings.order,
  ]);

  useEffect(() => {
    fetchVerificationData();
  }, [fetchVerificationData]);

  const pressureChartData = useMemo(() => {
    if (!Array.isArray(payload.plotData)) return [];
    return payload.plotData.map((row) => ({
      ...row,
      time: Number(row?.time),
    }));
  }, [payload.plotData]);

  const ewtPlotData = useMemo(() => {
    if (!Array.isArray(payload.ewtData?.plot_data)) return [];
    return payload.ewtData.plot_data.map((row) => ({
      ...row,
      time: Number(row?.time),
    }));
  }, [payload.ewtData]);

  const ewtModeKeys = useMemo(() => {
    if (!ewtPlotData.length) return [];
    return Object.keys(ewtPlotData[0]).filter((key) => key.startsWith('mode_'));
  }, [ewtPlotData]);

  const ewtSeries = useMemo(
    () => [
      { key: 'raw', label: 'Raw Signal', color: '#ef4444' },
      ...ewtModeKeys.map((key, index) => ({
        key,
        label: `Mode ${key.replace('mode_', '')}`,
        color: `hsl(${(index * 53 + 195) % 360} 72% 56%)`,
      })),
    ],
    [ewtModeKeys]
  );

  const ewtEnergy = payload.ewtData?.energy || [];
  const ewtSummary = payload.ewtData?.summary || {};
  const ewtWarning = payload.ewtError || payload.ewtData?.warning || '';
  const ewtPeakAlignment = payload.ewtPeakAlignment || [];
  const ewtPlottedPointCount = ewtPlotData.length;
  const ewtFullSampleCount = Number.isFinite(Number(ewtSummary.samples)) ? Number(ewtSummary.samples) : null;
  const ewtMaxPlotPoints = Number.isFinite(Number(payload?.ewtSettings?.maxPoints))
    ? Number(payload.ewtSettings.maxPoints)
    : settings.ewtMaxPoints;
  const ewtDownsampleApplied =
    ewtFullSampleCount !== null &&
    Number.isFinite(Number(ewtPlottedPointCount)) &&
    ewtPlottedPointCount < ewtFullSampleCount;

  const renderPressureSection = () => (
    <div className="flex flex-col gap-6">
      <div className="bg-card/60 border border-border rounded-xl p-4 h-[530px]">
        <h3 className="text-sm font-bold text-foreground mb-3">Pressure Trace Verification</h3>
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-primary animate-pulse text-sm">
            <Activity size={16} className="mr-2" />
            Loading verification data...
          </div>
        ) : pressureChartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            {error || 'No verification data available.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pressureChartData} margin={{ top: 20, right: 20, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="time"
                type="number"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickFormatter={(value) => Number(value).toFixed(2)}
                domain={[0, 'dataMax']}
                allowDataOverflow
                label={{
                  value: 'Time (s)',
                  position: 'bottom',
                  offset: 10,
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 10,
                }}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                label={{
                  value: 'Pressure (kPa)',
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 10,
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                }}
                formatter={(value) => (value == null ? '-' : Number(value).toFixed(4))}
              />
              <Legend
                verticalAlign="top"
                align="center"
                content={({ payload: legendPayload }) => (
                  <div className="px-2 pt-1">
                    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {(legendPayload || []).map((entry) => (
                        <span key={entry.value} className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-0.5 w-4 rounded-sm"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span>{entry.value}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              />
              <Line type="monotone" dataKey="Clean (reference)" stroke="#22c55e" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="Noisy (input)" stroke="#f97316" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="Noisy filtered" stroke="#38bdf8" dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-card/60 border border-border rounded-xl p-4">
        <h3 className="text-sm font-bold text-foreground mb-3">Python vs MATLAB/Octave Pressure Metrics</h3>
        {!payload.matlabMetricsAvailable && (
          <div className="mb-3 text-xs text-yellow-500 bg-yellow-900/10 border border-yellow-900/30 rounded px-3 py-2">
            MATLAB/Octave metrics file is missing or empty. Export results to{' '}
            <code>{payload.matlabMetricsFile || 'backend/tests/results/pressure_metrics_octave.csv'}</code>.
          </div>
        )}
        <div className="overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-[10px] tracking-widest text-muted-foreground border-b border-border">
                <th className="text-left pb-2">Series</th>
                <th className="text-right pb-2">Python Pmax (kPa)</th>
                <th className="text-right pb-2">MATLAB/Octave Pmax (kPa)</th>
                <th className="text-right pb-2">|Δ| (kPa)</th>
                <th className="text-right pb-2">Python tPeak (s)</th>
                <th className="text-right pb-2">MATLAB/Octave tPeak (s)</th>
                <th className="text-right pb-2">|Δ| (s)</th>
                <th className="text-right pb-2">Python Impulse (kPa·s)</th>
                <th className="text-right pb-2">MATLAB/Octave Impulse (kPa·s)</th>
                <th className="text-right pb-2">|Δ| (kPa·s)</th>
              </tr>
            </thead>
            <tbody className="text-foreground/90">
              {SERIES_ORDER.map((row) => {
                const py = payload.pythonMetrics?.[row.key] || {};
                const ml = payload.matlabMetrics?.[row.key] || {};
                return (
                  <tr key={row.key} className="border-b border-border/60">
                    <td className="py-2 font-semibold">{row.label}</td>
                    <td className="py-2 text-right">{formatFixed(py.pMax, PRESSURE_DIGITS)}</td>
                    <td className="py-2 text-right">{formatFixed(ml.pMax, PRESSURE_DIGITS)}</td>
                    <td className="py-2 text-right">{formatDelta(py.pMax, ml.pMax)}</td>
                    <td className="py-2 text-right">{formatFixed(py.tMax, PRESSURE_DIGITS)}</td>
                    <td className="py-2 text-right">{formatFixed(ml.tMax, PRESSURE_DIGITS)}</td>
                    <td className="py-2 text-right">{formatDelta(py.tMax, ml.tMax)}</td>
                    <td className="py-2 text-right">{formatFixed(py.impulse, PRESSURE_DIGITS)}</td>
                    <td className="py-2 text-right">{formatFixed(ml.impulse, PRESSURE_DIGITS)}</td>
                    <td className="py-2 text-right">{formatDelta(py.impulse, ml.impulse)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          End threshold: {payload.settings?.endThresholdPercent?.toFixed?.(2) || '-'}% of P<sub>max</sub>.
        </div>
      </div>
    </div>
  );

  const renderEwtSection = () => (
    <div className="flex flex-col gap-6">
      <div className="bg-card/60 border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground mb-3">
          <AudioLines size={16} className="text-primary" />
          EWT Verification (Noisy Fixture)
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 min-h-[360px]">
            {ewtPlotData.length === 0 ? (
              <div className="h-full min-h-[360px] flex items-center justify-center rounded border border-border/60 bg-black/20 text-sm text-muted-foreground">
                {ewtWarning || error || 'No EWT data available yet.'}
              </div>
            ) : (
              <div className="space-y-3 max-h-[560px] overflow-auto pr-1">
                {ewtSeries.map((series) => (
                  <div key={series.key} className="rounded border border-border/60 bg-black/20 p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                      {series.label}
                    </div>
                    <div className="h-36">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={ewtPlotData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="time" type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                            }}
                            formatter={(value) => (value == null ? '-' : Number(value).toFixed(4))}
                          />
                          <Line type="monotone" dataKey={series.key} stroke={series.color} dot={false} strokeWidth={1.8} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded border border-border/60 bg-black/20 p-3 text-xs text-muted-foreground">
              <div>Samples: <span className="text-foreground">{ewtSummary.samples ?? '-'}</span></div>
              <div>Plotted points: <span className="text-foreground">{ewtPlottedPointCount || 0}</span></div>
              <div>Sampling rate: <span className="text-foreground">{formatFixed(ewtSummary.fs, 2)} Hz</span></div>
              <div>Modes returned: <span className="text-foreground">{ewtSummary.numModes ?? '-'}</span></div>
            </div>

            {ewtWarning && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle size={12} className="mt-0.5" />
                <span>{ewtWarning}</span>
              </div>
            )}

            <div className="rounded border border-border/60 bg-black/20 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Mode Energy (%)</div>
              {ewtEnergy.length === 0 ? (
                <div className="text-xs text-muted-foreground">No EWT energy data.</div>
              ) : (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ewtEnergy}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="mode" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                        }}
                        formatter={(value) => `${Number(value).toFixed(2)}%`}
                      />
                      <Bar dataKey="pct" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded border border-border/60 bg-black/20 p-3 overflow-auto">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Python EWT Mode Peaks</div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-[10px] tracking-widest text-muted-foreground border-b border-border">
                <th className="text-left pb-2">Mode</th>
                <th className="text-right pb-2">Peak (Hz)</th>
                <th className="text-right pb-2">Energy (%)</th>
              </tr>
            </thead>
            <tbody className="text-foreground/90">
              {ewtEnergy.map((row) => (
                <tr key={`ewt-mode-${row.mode}`} className="border-b border-border/60">
                  <td className="py-2">{row.mode}</td>
                  <td className="py-2 text-right">{formatFixed(row.peakHz, 3)}</td>
                  <td className="py-2 text-right">{formatFixed(row.pct, 2)}</td>
                </tr>
              ))}
              {ewtEnergy.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-3 text-center text-muted-foreground">No mode peaks available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded border border-border/60 bg-black/20 p-3 overflow-auto">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
            Python vs Octave Peak Alignment
          </div>
          {!payload.ewtAlignmentAvailable ? (
            <div className="text-xs text-muted-foreground">
              Run <code>npm run test:ewt:octave</code> to generate <code>backend/tests/results/ewt_peak_metrics_octave.csv</code>.
            </div>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-[10px] tracking-widest text-muted-foreground border-b border-border">
                  <th className="text-left pb-2">Mode</th>
                  <th className="text-right pb-2">Python (Hz)</th>
                  <th className="text-right pb-2">Octave (Hz)</th>
                  <th className="text-right pb-2">|Δ| (Hz)</th>
                </tr>
              </thead>
              <tbody className="text-foreground/90">
                {ewtPeakAlignment.map((row) => (
                  <tr key={`align-${row.mode}`} className="border-b border-border/60">
                    <td className="py-2">{row.mode}</td>
                    <td className="py-2 text-right">{formatFixed(row.pythonPeakHz, 3)}</td>
                    <td className="py-2 text-right">{formatFixed(row.octavePeakHz, 3)}</td>
                    <td className="py-2 text-right">{formatFixed(row.absDeltaHz, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground border border-border/60 bg-black/20 rounded px-3 py-2">
        Note: chart data is downsampled only for display.
        {' '}
        {ewtDownsampleApplied
          ? `Downsampling applied (${ewtPlottedPointCount} plotted, ${ewtFullSampleCount} full, max ${ewtMaxPlotPoints}).`
          : `No downsampling applied for this run (${ewtPlottedPointCount} plotted, max ${ewtMaxPlotPoints}).`}
        {' '}
        Python and Octave EWT peak metrics are always computed from full-resolution processed data.
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-card/60 border border-border rounded-xl p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Sigma size={16} className="text-primary" />
              App Calculations Verification
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Dedicated verification workspace with separate pressure and EWT verification views.
            </p>
          </div>
          <button
            onClick={fetchVerificationData}
            disabled={isLoading}
            className="inline-flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 rounded text-xs font-bold border border-primary/30 disabled:opacity-60"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveSection('ewt')}
            className={`px-3 py-2 rounded-md text-xs font-semibold border transition ${
              activeSection === 'ewt'
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground'
            }`}
          >
            EWT Verification
          </button>
          <button
            onClick={() => setActiveSection('pressure')}
            className={`px-3 py-2 rounded-md text-xs font-semibold border transition ${
              activeSection === 'pressure'
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground'
            }`}
          >
            Pressure Metrics Verification
          </button>
        </div>

        {activeSection === 'pressure' ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col items-start">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Allowed Decay From Pmax (%)
              </label>
              <input
                type="number"
                min="0"
                max="99.9"
                step="0.1"
                value={settings.decayPercent}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    decayPercent: Number(event.target.value),
                  }))
                }
                className="mt-1 w-28 bg-background border border-border rounded px-2 py-1 text-xs text-foreground"
              />
            </div>
            <div className="flex flex-col items-start">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Cutoff (Hz)
              </label>
              <input
                type="number"
                min="1"
                step="0.1"
                value={settings.cutoffHz}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    cutoffHz: Number(event.target.value),
                  }))
                }
                className="mt-1 w-28 bg-background border border-border rounded px-2 py-1 text-xs text-foreground"
              />
            </div>
            <div className="flex flex-col items-start">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Filter Order
              </label>
              <input
                type="number"
                min="1"
                max="10"
                step="1"
                value={settings.order}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    order: Number(event.target.value),
                  }))
                }
                className="mt-1 w-28 bg-background border border-border rounded px-2 py-1 text-xs text-foreground"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col items-start">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Num Modes</label>
              <input
                type="number"
                min="1"
                max="10"
                step="1"
                value={settings.ewtNumModes}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ewtNumModes: Math.max(1, Math.min(10, Number(event.target.value) || 1)),
                  }))
                }
                className="mt-1 w-28 bg-background border border-border rounded px-2 py-1 text-xs text-foreground"
              />
            </div>
            <div className="flex flex-col items-start">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Max Points</label>
              <input
                type="number"
                min="200"
                max="5000"
                step="100"
                value={settings.ewtMaxPoints}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ewtMaxPoints: Math.max(200, Math.min(5000, Number(event.target.value) || 1200)),
                  }))
                }
                className="mt-1 w-28 bg-background border border-border rounded px-2 py-1 text-xs text-foreground"
              />
            </div>
          </div>
        )}
      </div>

      {activeSection === 'pressure' ? renderPressureSection() : renderEwtSection()}
    </div>
  );
};

export default AppCalculationsVerificationPage;
