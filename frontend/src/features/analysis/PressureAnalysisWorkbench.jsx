import React, { useEffect, useMemo, useState } from 'react';
import { Info, Download, Settings, Activity, FlaskConical } from 'lucide-react';
import { deriveChannelOptionsFromCases } from '../../utils/channelOptions';
import { DEFAULT_INPUT_UNIT, UNIT_OPTIONS, getDisplayUnitFromSetting } from '../../utils/units';
import HighResMultiChannelPlot from '../../components/HighResMultiChannelPlot';

const PressureAnalysis = ({
  plotData,
  analysisResults,
  isProcessing,
  settings,
  setSettings,
  onRunAnalysis,
  selectedCases = [],
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

  const withAlpha = (color, alpha = 0.28) => {
    const safeAlpha = Number.isFinite(Number(alpha)) ? Math.max(0, Math.min(1, Number(alpha))) : 0.28;
    if (typeof color !== 'string') return `hsl(var(--muted-foreground) / ${safeAlpha})`;
    const value = color.trim();
    if (!value) return `hsl(var(--muted-foreground) / ${safeAlpha})`;
    if (/^hsl\(/i.test(value)) return value.replace(/^hsl\((.*)\)$/i, `hsla($1, ${safeAlpha})`);
    if (/^rgb\(/i.test(value)) return value.replace(/^rgb\((.*)\)$/i, `rgba($1, ${safeAlpha})`);
    return `hsl(var(--muted-foreground) / ${safeAlpha})`;
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
    return getDisplayUnitFromSetting(settings.pressureInputUnit, settings.pressureConvertToKpa);
  }, [settings.pressureConvertToKpa, settings.pressureInputUnit]);
  const channelOptions = useMemo(() => {
    const eligible = (Array.isArray(selectedCases) ? selectedCases : []).filter(
      (item) => item && item.content && item.type !== 'flame'
    );
    const inferred = deriveChannelOptionsFromCases(eligible);
    return inferred.length ? inferred : [{ value: 0, label: 'Ch 1' }];
  }, [selectedCases]);
  useEffect(() => {
    const current = Number(settings.pressureChannelIndex ?? 0);
    const max = Math.max(0, channelOptions.length - 1);
    if (current > max) {
      setSettings((prev) => ({ ...prev, pressureChannelIndex: max }));
    }
  }, [channelOptions, setSettings, settings.pressureChannelIndex]);

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
  const pressurePlotConfig = useMemo(() => {
    const series = [];
    displayedSeries.forEach((result) => {
      series.push({
        key: result.displayName,
        label: result.displayName,
        unit: pressureDisplayUnit,
        role: 'pressure',
        color: result.color,
      });
      if (showRawReferenceOverlay && result.rawOverlayDisplayName) {
        series.push({
          key: result.rawOverlayDisplayName,
          label: `${result.displayName} (raw ref)`,
          unit: pressureDisplayUnit,
          role: 'pressure',
          color: withAlpha(result.color, 0.4),
        });
      }
    });
    if (hasExperimental && showExperimental) {
      series.push({
        key: 'Experimental',
        label: 'Experimental',
        unit: pressureDisplayUnit,
        role: 'pressure',
        color: 'hsl(var(--foreground))',
      });
    }
    const channels = series.map((entry, idx) => ({
      key: entry.key,
      label: entry.label,
      unit: entry.unit,
      role: entry.role,
      index: idx,
    }));
    const colors = series.map((entry) => entry.color);
    const rows = chartData.map((row) => {
      const nextRow = { t: Number(row?.time) };
      series.forEach((entry) => {
        const y = Number(row?.[entry.key]);
        nextRow[entry.key] = Number.isFinite(y) ? y : NaN;
      });
      return nextRow;
    });
    return { channels, colors, rows };
  }, [chartData, displayedSeries, hasExperimental, pressureDisplayUnit, showExperimental, showRawReferenceOverlay]);

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
            <div className="flex items-start gap-2">
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
          </div>

          <div className="flex-1 min-h-0 relative">
            {isProcessing ? (
              <div className="absolute inset-0 flex items-center justify-center text-cyan-300 animate-pulse font-mono text-sm">
                Processing Pressure Data...
              </div>
            ) : plotData && plotData.length > 0 ? (
              <HighResMultiChannelPlot
                plotData={pressurePlotConfig.rows}
                channels={pressurePlotConfig.channels}
                colors={pressurePlotConfig.colors}
                height={420}
              />
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
                <div className="rounded-lg border border-border/60 bg-card/40 p-3">
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
              <div className="rounded-lg border border-border/60 bg-card/40 p-3">
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
                      {channelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">Input Unit</label>
                    <select
                      value={String(settings.pressureInputUnit || '').toLowerCase() === 'auto' ? DEFAULT_INPUT_UNIT : (settings.pressureInputUnit || DEFAULT_INPUT_UNIT)}
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
              <div className="xl:col-span-2 rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                  Display, Impulse & Input Scope
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
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={Boolean(settings.analysisFullResolution)}
                      onChange={(e) => setSettings({ ...settings, analysisFullResolution: e.target.checked })}
                      className="rounded bg-muted border-border"
                    />
                    Use full-resolution input (slower)
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={Boolean(settings.analysisLimitTimeWindow)}
                      onChange={(e) => setSettings({ ...settings, analysisLimitTimeWindow: e.target.checked })}
                      className="rounded bg-muted border-border"
                    />
                    Limit input time window (s)
                  </label>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">Start (s)</label>
                    <input
                      type="number"
                      step="any"
                      value={settings.analysisWindowStart ?? ''}
                      disabled={!settings.analysisLimitTimeWindow}
                      onChange={(e) => setSettings({ ...settings, analysisWindowStart: e.target.value })}
                      className="bg-background border border-border rounded px-2 py-1 text-xs w-24 text-foreground disabled:opacity-50"
                      placeholder="auto"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">End (s)</label>
                    <input
                      type="number"
                      step="any"
                      value={settings.analysisWindowEnd ?? ''}
                      disabled={!settings.analysisLimitTimeWindow}
                      onChange={(e) => setSettings({ ...settings, analysisWindowEnd: e.target.value })}
                      className="bg-background border border-border rounded px-2 py-1 text-xs w-24 text-foreground disabled:opacity-50"
                      placeholder="auto"
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
            <div className="mb-4 rounded-lg border border-border/60 bg-card/40 p-3 text-xs text-muted-foreground">
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
            <div className="flex-1 overflow-auto custom-scrollbar rounded-lg border border-primary/30 bg-primary/10 p-3">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] text-primary uppercase border-b border-primary/20">
                    <th className="pb-2 font-bold">Case</th>
                    <th className="pb-2 text-right">P<sub>max</sub></th>
                    <th className="pb-2 text-right">t<sub>peak</sub></th>
                    <th className="pb-2 text-right">Impulse</th>
                    {isValidationMode && <th className="pb-2 text-right">t<sub>vent</sub></th>}
                  </tr>
                </thead>
                <tbody className="text-xs text-foreground/80">
                  {analysisResults.map((res, i) => (
                    <tr key={i} className="border-b border-primary/15 hover:bg-primary/5 transition-colors">
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
