import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Info, Download, Settings, Activity, FlaskConical } from 'lucide-react';

const CHANNEL_OPTIONS = [
  { value: 0, label: 'Y[0] (Ch 1)' },
  { value: 1, label: 'Y[1] (Ch 2)' },
  { value: 2, label: 'Y[2] (Ch 3)' },
  { value: 3, label: 'Y[3] (Ch 4)' },
];
const UNIT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'bar', label: 'bar' },
  { value: 'kPa', label: 'kPa' },
  { value: 'Pa', label: 'Pa' },
  { value: 'V', label: 'V (trigger)' },
];

const PressureAnalysis = ({
  plotData,
  analysisResults,
  isProcessing,
  settings,
  setSettings,
  onRunAnalysis,
  mode = 'validation',
}) => {
  const exportToCSV = () => {
    if (!plotData || plotData.length === 0) return;
    const headers = Object.keys(plotData[0]).join(",");
    const rows = plotData.map((row) => Object.values(row).join(",")).join("\n");
    const blob = new Blob([headers + "\n" + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pressure_analysis_export.csv';
    a.click();
  };

  const hasExperimental = Array.isArray(plotData)
    ? plotData.some((row) => row && row.Experimental !== undefined && row.Experimental !== null)
    : false;

  const [visibleSeries, setVisibleSeries] = useState({});
  const [showExperimental, setShowExperimental] = useState(true);
  const [seriesScope, setSeriesScope] = useState(mode === 'validation' ? 'all' : 'experimental');
  const [localTickCount, setLocalTickCount] = useState(settings.pressureTickCount || 10);
  const [localYTickCount, setLocalYTickCount] = useState(10);
  const effectiveImpulseDrop = useMemo(() => {
    const raw = Number(settings.impulseDrop);
    if (!Number.isFinite(raw) || raw <= 0) return 0.05;
    return raw > 1 ? Math.min(raw / 100, 1) : raw;
  }, [settings.impulseDrop]);
  const decayAmountPercent = useMemo(
    () => Math.max(0, Math.min(99.9, Number(((1 - effectiveImpulseDrop) * 100).toFixed(1)))),
    [effectiveImpulseDrop]
  );
  const showRawReferenceOverlay = settings.showRawReference !== false;
  const isValidationMode = mode === 'validation';
  const chartTitle = isValidationMode ? 'CFD Validation: Pressure vs Time' : 'Pressure vs Time (Experiments)';
  const effectiveSeriesScope = isValidationMode ? seriesScope : 'experimental';

  const normalizedVisibleSeries = useMemo(() => {
    const next = {};
    analysisResults.forEach((item) => {
      const key = item.displayName || item.name;
      if (!key) return;
      next[key] = visibleSeries[key] ?? true;
    });
    return next;
  }, [analysisResults, visibleSeries]);

  const displayedSeries = useMemo(
    () =>
      analysisResults.filter((item) => {
        if (!isValidationMode && item.sourceType !== 'experiment') return false;
        if (normalizedVisibleSeries[item.displayName] === false) return false;
        if (effectiveSeriesScope === 'experimental') return item.sourceType === 'experiment';
        if (effectiveSeriesScope === 'simulation') return item.sourceType === 'simulation';
        return true;
      }),
    [analysisResults, normalizedVisibleSeries, effectiveSeriesScope, isValidationMode]
  );

  const experimentalSeriesCount = useMemo(
    () => analysisResults.filter((item) => item.sourceType === 'experiment').length,
    [analysisResults]
  );
  const simulationSeriesCount = useMemo(
    () => analysisResults.filter((item) => item.sourceType === 'simulation').length,
    [analysisResults]
  );
  const unitNotes = useMemo(
    () => Array.from(new Set(analysisResults.map((item) => item?.metrics?.unitNote).filter(Boolean))),
    [analysisResults]
  );
  const pressureDisplayUnit = useMemo(() => {
    if (settings.pressureConvertToKpa !== false) return 'kPa';
    const selected = String(settings.pressureInputUnit || 'raw').toLowerCase();
    if (selected === 'bar') return 'bar';
    if (selected === 'kpa') return 'kPa';
    if (selected === 'pa') return 'Pa';
    if (selected === 'v') return 'V';
    return 'raw';
  }, [settings.pressureConvertToKpa, settings.pressureInputUnit]);

  const formatTimeTick = (val) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return val;
    return num.toFixed(2);
  };

  const chartData = useMemo(() => {
    if (!Array.isArray(plotData)) return [];
    return plotData.map((row) => {
      const timeNum = Number(row?.time);
      return {
        ...row,
        time: Number.isFinite(timeNum) ? timeNum : row?.time,
      };
    });
  }, [plotData]);

  const onCutoffChange = (e) => {
    const next = Number(e.target.value);
    setSettings({ ...settings, cutoff: Number.isFinite(next) ? next : settings.cutoff });
  };

  const onOrderChange = (e) => {
    const next = Number(e.target.value);
    const safe = Number.isFinite(next) ? Math.max(1, Math.round(next)) : settings.order;
    setSettings({ ...settings, order: safe });
  };

  const onExperimentalCutoffChange = (e) => {
    const next = Number(e.target.value);
    const fallback = Number.isFinite(Number(settings.experimentalCutoff))
      ? Number(settings.experimentalCutoff)
      : settings.cutoff;
    setSettings({ ...settings, experimentalCutoff: Number.isFinite(next) ? next : fallback });
  };

  const onExperimentalOrderChange = (e) => {
    const next = Number(e.target.value);
    const fallback = Number.isFinite(Number(settings.experimentalOrder))
      ? Number(settings.experimentalOrder)
      : settings.order;
    const safe = Number.isFinite(next) ? Math.max(1, Math.round(next)) : fallback;
    setSettings({ ...settings, experimentalOrder: safe });
  };

  const onTickCountChange = (e) => {
    const raw = Number(e.target.value);
    const safe = Number.isFinite(raw) ? Math.max(3, Math.min(20, Math.round(raw))) : localTickCount;
    setLocalTickCount(safe);
  };

  const onYTickCountChange = (e) => {
    const raw = Number(e.target.value);
    const safe = Number.isFinite(raw) ? Math.max(3, Math.min(20, Math.round(raw))) : localYTickCount;
    setLocalYTickCount(safe);
  };

  const onDecayAmountChange = (e) => {
    const rawPercent = Number(e.target.value);
    const safePercent = Number.isFinite(rawPercent) ? Math.max(0, Math.min(99.9, rawPercent)) : decayAmountPercent;
    const impulseThresholdFraction = Math.max(0.001, Math.min(1, (100 - safePercent) / 100));
    setSettings({ ...settings, impulseDrop: impulseThresholdFraction });
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-2 bg-card/60 border border-border p-4 rounded-xl flex flex-col">
          <div className="flex justify-between items-start mb-2 gap-4">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Activity className="text-cyan-400" size={16} />
              {chartTitle}
            </h3>
            {plotData && plotData.length > 0 && (
              <div className="flex items-start gap-2 bg-yellow-900/10 border border-yellow-900/30 p-2 rounded max-w-md">
                <Info size={14} className="text-yellow-500 mt-0.5 shrink-0" />
                <p className="text-[10px] text-yellow-500/80 leading-tight">
                  <strong>Visualization Note:</strong> Data is interpolated to a common grid for comparison. Exact
                  peak values are computed from raw data in the table.
                </p>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 relative">
            {isProcessing ? (
              <div className="absolute inset-0 flex items-center justify-center text-cyan-300 animate-pulse font-mono text-sm">
                Processing Pressure Data...
              </div>
            ) : plotData && plotData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="time"
                    type="number"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={formatTimeTick}
                    tickCount={localTickCount || 10}
                    domain={[0, 'dataMax']}
                    allowDataOverflow
                    label={{
                      value: 'Time (s)',
                      position: 'insideBottom',
                      offset: -5,
                      fill: 'hsl(var(--muted-foreground))',
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickCount={localYTickCount || 10}
                    label={{
                      value: `Pressure (${pressureDisplayUnit})`,
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
                      borderRadius: '4px',
                    }}
                    labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '0.5rem' }}
                    itemStyle={{ fontSize: '12px', padding: 0 }}
                    formatter={(val) => (val !== null && val !== undefined ? Number(val).toFixed(3) : 'No Data')}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />

                  {displayedSeries.map((result, i) => (
                    <Line
                      key={i}
                      type="monotone"
                      dataKey={result.displayName}
                      stroke={result.color}
                      strokeDasharray={result.sourceType === 'experiment' ? '6 4' : undefined}
                      dot={false}
                      strokeWidth={2}
                      connectNulls={true}
                      isAnimationActive={false}
                    />
                  ))}
                  {showRawReferenceOverlay &&
                    displayedSeries
                      .filter((result) => result.rawOverlayDisplayName)
                      .map((result, i) => (
                        <Line
                          key={`raw-ref-${i}-${result.rawOverlayDisplayName}`}
                          type="monotone"
                          dataKey={result.rawOverlayDisplayName}
                          stroke={result.color}
                          strokeDasharray="3 3"
                          strokeOpacity={0.28}
                          dot={false}
                          strokeWidth={1.5}
                          connectNulls={true}
                          isAnimationActive={false}
                          legendType="none"
                        />
                      ))}

                  {hasExperimental && showExperimental ? (
                    <Line
                      type="monotone"
                      dataKey="Experimental"
                      stroke="hsl(var(--foreground))"
                      strokeDasharray="5 5"
                      dot={false}
                      strokeWidth={2}
                      connectNulls={true}
                    />
                  ) : null}

                  {displayedSeries
                    .filter((result) => typeof result.ventTime === 'number' && Number.isFinite(result.ventTime))
                    .map((result, i) => (
                      <ReferenceLine
                        key={`vent-${i}`}
                        x={result.ventTime}
                        stroke={result.color}
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        ifOverflow="extendDomain"
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <Activity size={48} className="mb-4 opacity-20" />
                <p className="text-sm">Select cases from the Data tab, then click “Plot Selected”.</p>
              </div>
            )}
          </div>

          <div className="mt-4 bg-card/60 border border-border rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Plot Controls</div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {isValidationMode && (
                <div className="rounded-lg border border-border/60 bg-black/20 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                    Simulation Filter
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col">
                      <label className="text-[10px] text-muted-foreground uppercase font-bold">Filter Frequency (Hz)</label>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={settings.cutoff}
                        onChange={onCutoffChange}
                        className="bg-background border border-border rounded px-2 py-1 text-xs w-28 text-foreground"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-[10px] text-muted-foreground uppercase font-bold">Filter Order</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="1"
                        value={settings.order}
                        onChange={onOrderChange}
                        className="bg-background border border-border rounded px-2 py-1 text-xs w-20 text-foreground"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={settings.useRaw}
                        onChange={(e) => setSettings({ ...settings, useRaw: e.target.checked })}
                        className="rounded bg-muted border-border"
                      />
                      Use raw simulation data
                    </label>
                  </div>
                </div>
              )}
              <div className="rounded-lg border border-border/60 bg-black/20 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                  Experimental Filter
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">Filter Frequency (Hz)</label>
                    <input
                      type="number"
                      min="1"
                      step="0.1"
                      value={settings.experimentalCutoff ?? settings.cutoff}
                      onChange={onExperimentalCutoffChange}
                      className="bg-background border border-border rounded px-2 py-1 text-xs w-28 text-foreground"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">Filter Order</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      step="1"
                      value={settings.experimentalOrder ?? settings.order}
                      onChange={onExperimentalOrderChange}
                      className="bg-background border border-border rounded px-2 py-1 text-xs w-20 text-foreground"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={Boolean(settings.experimentalUseRaw)}
                      onChange={(e) => setSettings({ ...settings, experimentalUseRaw: e.target.checked })}
                      className="rounded bg-muted border-border"
                    />
                    Use raw experimental data
                  </label>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">Channel</label>
                    <select
                      value={Number(settings.pressureChannelIndex ?? 0)}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          pressureChannelIndex: Math.max(0, Math.round(Number(e.target.value) || 0)),
                        })
                      }
                      className="bg-background border border-border rounded px-2 py-1 text-xs w-32 text-foreground"
                    >
                      {CHANNEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">Input Unit</label>
                    <select
                      value={settings.pressureInputUnit || 'auto'}
                      onChange={(e) => setSettings({ ...settings, pressureInputUnit: e.target.value })}
                      className="bg-background border border-border rounded px-2 py-1 text-xs w-28 text-foreground"
                    >
                      {UNIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={settings.pressureConvertToKpa !== false}
                      onChange={(e) => setSettings({ ...settings, pressureConvertToKpa: e.target.checked })}
                      className="rounded bg-muted border-border"
                    />
                    Convert to kPa
                  </label>
                </div>
              </div>
              <div className="xl:col-span-2 rounded-lg border border-border/60 bg-black/20 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                  Display & Impulse
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold min-h-[24px] flex items-end">
                      X Ticks
                    </label>
                    <input
                      type="number"
                      min="3"
                      max="20"
                      step="1"
                      value={localTickCount}
                      onChange={onTickCountChange}
                      className="bg-background border border-border rounded px-2 py-1 text-xs w-full text-foreground"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold min-h-[24px] flex items-end">
                      Y Ticks
                    </label>
                    <input
                      type="number"
                      min="3"
                      max="20"
                      step="1"
                      value={localYTickCount}
                      onChange={onYTickCountChange}
                      className="bg-background border border-border rounded px-2 py-1 text-xs w-full text-foreground"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold min-h-[24px] flex items-end">
                      Allowed Decay From P<sub>max</sub> (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="99.9"
                      step="0.1"
                      value={decayAmountPercent}
                      onChange={onDecayAmountChange}
                      className="bg-background border border-border rounded px-2 py-1 text-xs w-full text-foreground"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Settings size={14} />
              <span>
                End level is P<sub>end</sub> = (1 - D/100) * P<sub>max</sub>. 0% = stop at peak, 50% = stop at
                0.5*P<sub>max</sub>, 95% = stop at 0.05*P<sub>max</sub>. Click Plot Selected to refresh.
              </span>
            </div>
            {unitNotes.length > 0 && (
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Info size={14} />
                <span>{unitNotes.join(' ')}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 min-h-0">
          <div className="bg-card/60 border border-border p-4 rounded-xl">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <Info size={12} className="text-muted-foreground" />
              <span>
                {isValidationMode
                  ? 'Select experiments and simulations in Import Data, then Plot Selected.'
                  : 'Select pressure experiment files in Import Data, then Plot Selected.'}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={onRunAnalysis}
                disabled={!onRunAnalysis || isProcessing}
                className="flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 rounded text-xs font-bold border border-primary/30 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Activity size={14} />
                Plot Selected
              </button>
              {plotData && plotData.length > 0 && (
                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-2 border border-border/60 bg-background/40 hover:bg-background/70 text-muted-foreground hover:text-foreground px-3 py-2 rounded text-xs font-semibold transition-colors"
                >
                  <Download size={14} /> Export CSV
                </button>
              )}
            </div>
          </div>

          <div className="bg-card/60 border border-border p-4 rounded-xl">
            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
              <FlaskConical size={16} className="text-primary" />
              Data Display Controls
            </h3>
            <div className="space-y-3">
              {isValidationMode ? (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase font-bold">Series Filter</label>
                  <select
                    value={seriesScope}
                    onChange={(e) => setSeriesScope(e.target.value)}
                    className="bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground"
                  >
                    <option value="all">All Series</option>
                    <option value="experimental">Experimental Only</option>
                    <option value="simulation">Simulation Only</option>
                  </select>
                  <div className="text-[11px] text-muted-foreground">
                    Experimental: {experimentalSeriesCount} | Simulation: {simulationSeriesCount}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  Experimental series only.
                </div>
              )}
              <div className="text-[11px] text-muted-foreground">Series visibility only. Metrics are unchanged.</div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showRawReferenceOverlay}
                  onChange={(e) => setSettings({ ...settings, showRawReference: e.target.checked })}
                  className="rounded bg-muted border-border"
                />
                Show faded raw-reference overlay for filtered traces
              </label>
              <div className="text-[11px] text-muted-foreground">
                Re-click Plot Selected after changing this option.
              </div>
            </div>
          </div>

          <div className="bg-card/60 border border-border p-4 rounded-xl flex flex-col overflow-hidden min-h-0 flex-1">
            <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
              <Settings size={16} className="text-muted-foreground" /> Calculated Metrics
            </h3>
            <div className="mb-4 rounded-lg border border-border/60 bg-black/20 p-3 text-xs text-muted-foreground">
              <div className="text-[10px] uppercase tracking-widest font-bold mb-2">Visible Series</div>
              <div className="flex flex-col gap-2">
                {analysisResults.length === 0 && <span className="text-[11px] text-muted-foreground">No series yet.</span>}
                {analysisResults.map((item) => (
                  <label key={item.displayName} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={normalizedVisibleSeries[item.displayName] !== false}
                      onChange={() =>
                        setVisibleSeries((prev) => ({
                          ...prev,
                          [item.displayName]: prev[item.displayName] === false,
                        }))
                      }
                    />
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                      {item.displayName}
                    </span>
                  </label>
                ))}
                {hasExperimental && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showExperimental}
                      onChange={() => setShowExperimental((prev) => !prev)}
                    />
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-foreground" />
                      Experimental
                    </span>
                  </label>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] text-muted-foreground uppercase border-b border-border">
                    <th className="pb-2 font-bold">Case</th>
                    <th className="pb-2 text-right">P<sub>max</sub></th>
                    <th className="pb-2 text-right">t<sub>peak</sub></th>
                    <th className="pb-2 text-right">Impulse</th>
                    {isValidationMode && <th className="pb-2 text-right">t<sub>vent</sub></th>}
                  </tr>
                </thead>
                <tbody className="text-xs text-foreground/80">
                  {analysisResults.map((res, i) => (
                    <tr key={i} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                      <td className="py-3 font-mono truncate max-w-[140px]" title={res.displayName}>
                        <span className="w-2 h-2 inline-block rounded-full mr-2" style={{ backgroundColor: res.color }} />
                        {res.displayName}
                      </td>
                      <td className="py-3 text-right font-bold text-foreground">{res.metrics?.pMax || '-'}</td>
                      <td className="py-3 text-right text-muted-foreground">{res.metrics?.tMax || '-'}</td>
                      <td className="py-3 text-right text-muted-foreground">{res.metrics?.impulse || '-'}</td>
                      {isValidationMode && (
                        <td className="py-3 text-right text-muted-foreground">
                          {res.ventTime ? res.ventTime.toFixed(4) : '-'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {analysisResults.length === 0 && (
                <div className="text-center text-muted-foreground text-xs mt-10 italic">No metrics calculated yet</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PressureAnalysis;
