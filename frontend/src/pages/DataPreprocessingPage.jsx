import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import HighResMultiChannelPlot from '../components/HighResMultiChannelPlot';
import { DEFAULT_INPUT_UNIT, UNIT_OPTIONS, convertValueByUnit, getChannelDisplayUnit, normalizeUnitToken } from '../utils/units';

const CHANNEL_COLORS = [
  '#38bdf8',
  '#f97316',
  '#22c55e',
  '#a78bfa',
  '#f59e0b',
  '#14b8a6',
  '#f43f5e',
  '#84cc16',
];
const formatFileName = (value) => {
  if (!value) return '';
  const normalized = String(value).replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
};

const formatSamplingRate = (value) => {
  if (!Number.isFinite(Number(value))) return 'N/A';
  return `${Number(value).toFixed(2)} Hz`;
};

const DataPreprocessingPage = ({ apiBaseUrl, projectPath, selectedCases = [] }) => {
  const [selectedPath, setSelectedPath] = useState('');
  const [viewMode, setViewMode] = useState('single');
  const [comparePaths, setComparePaths] = useState([]);
  const [compareChannelByPath, setCompareChannelByPath] = useState({});
  const [compareUnitOverrides, setCompareUnitOverrides] = useState({});
  const [maxPoints, setMaxPoints] = useState(2000);
  const [fullResolution, setFullResolution] = useState(false);
  const [limitTimeWindow, setLimitTimeWindow] = useState(false);
  const [timeWindowStart, setTimeWindowStart] = useState('');
  const [timeWindowEnd, setTimeWindowEnd] = useState('');
  const [plotLayout, setPlotLayout] = useState('stacked');
  const [convertToKpa, setConvertToKpa] = useState(true);
  const [selectedChannelKeys, setSelectedChannelKeys] = useState([]);
  const [channelUnitOverrides, setChannelUnitOverrides] = useState({});
  const [preview, setPreview] = useState(null);
  const [comparePreviews, setComparePreviews] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const dataFiles = useMemo(() => {
    if (!Array.isArray(selectedCases)) return [];
    const seen = new Set();
    const selectedOnly = selectedCases
      .filter((item) => item && (item.type === 'pressure' || item.type === 'flame'))
      .filter((item) => (item.path || item.name) && /\.(txt|csv|dat|asc|ascii|mf4|tpc5)$/i.test(item.name || item.path || ''))
      .map((item) => {
        const path = item.path || item.name;
        const name = item.name || formatFileName(path);
        return { path, name };
      })
      .filter((item) => {
        if (seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return selectedOnly;
  }, [selectedCases]);

  useEffect(() => {
    if (!dataFiles.length) {
      setSelectedPath('');
      setComparePaths([]);
      setPreview(null);
      return;
    }
    const exists = dataFiles.some((fileObj) => (fileObj.path || fileObj.webkitRelativePath) === selectedPath);
    if (!selectedPath || !exists) {
      setSelectedPath(dataFiles[0].path || dataFiles[0].webkitRelativePath);
    }
  }, [dataFiles, selectedPath]);

  useEffect(() => {
    if (!dataFiles.length) return;
    setComparePaths((prev) => {
      const allowed = new Set(dataFiles.map((item) => item.path));
      const kept = prev.filter((path) => allowed.has(path));
      if (kept.length) return kept;
      return dataFiles.slice(0, Math.min(3, dataFiles.length)).map((item) => item.path);
    });
  }, [dataFiles]);

  useEffect(() => {
    const allowed = new Set(comparePaths);
    setCompareChannelByPath((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([path, index]) => {
        if (allowed.has(path)) next[path] = index;
      });
      return next;
    });
    setCompareUnitOverrides((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([path, unit]) => {
        if (allowed.has(path)) next[path] = unit;
      });
      return next;
    });
  }, [comparePaths]);

  const fetchPreviewData = useCallback(
    async (pathValue, pointsValue, fullResValue, limitWindowValue, startValue, endValue) => {
      if (!pathValue) return null;
      const fileQuery = new URLSearchParams({
        path: pathValue,
        projectPath: projectPath || '',
        fullResolution: fullResValue ? '1' : '0',
      });
      if (limitWindowValue) {
        const startNumeric = Number(startValue);
        const endNumeric = Number(endValue);
        if (Number.isFinite(startNumeric)) fileQuery.set('windowStart', String(startNumeric));
        if (Number.isFinite(endNumeric)) fileQuery.set('windowEnd', String(endNumeric));
      }
      const fileRes = await fetch(`${apiBaseUrl}/read_project_file?${fileQuery.toString()}`);
      const fileJson = await fileRes.json();
      if (!fileRes.ok || !fileJson?.success) {
        throw new Error(fileJson?.error || 'Failed to read file');
      }

      const previewRes = await fetch(`${apiBaseUrl}/preview_multichannel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fileJson.content,
          maxPoints: Number.isFinite(Number(pointsValue)) ? Number(pointsValue) : 2000,
          fullResolution: Boolean(fullResValue),
        }),
      });
      const previewJson = await previewRes.json();
      if (!previewRes.ok || previewJson?.error) {
        throw new Error(previewJson?.error || 'Failed to parse channel data');
      }
      return previewJson;
    },
    [apiBaseUrl, projectPath]
  );

  const requestPreview = useCallback(
    async (pathValue, pointsValue, fullResValue, limitWindowValue, startValue, endValue) => {
      if (!pathValue) return;
      setLoading(true);
      setError('');
      try {
        const previewJson = await fetchPreviewData(
          pathValue,
          pointsValue,
          fullResValue,
          limitWindowValue,
          startValue,
          endValue
        );
        setPreview(previewJson);
      } catch (err) {
        setPreview(null);
        setError(err?.message || 'Unable to load channel preview.');
      } finally {
        setLoading(false);
      }
    },
    [fetchPreviewData]
  );

  const requestComparePreviews = useCallback(
    async (pathsValue, pointsValue, fullResValue, limitWindowValue, startValue, endValue) => {
      const paths = (Array.isArray(pathsValue) ? pathsValue : []).filter(Boolean);
      if (!paths.length) {
        setComparePreviews({});
        return;
      }
      setLoading(true);
      setError('');
      try {
        const entries = await Promise.all(
          paths.map(async (path) => {
            const previewJson = await fetchPreviewData(
              path,
              pointsValue,
              fullResValue,
              limitWindowValue,
              startValue,
              endValue
            );
            return [path, previewJson];
          })
        );
        setComparePreviews(Object.fromEntries(entries));
      } catch (err) {
        setComparePreviews({});
        setError(err?.message || 'Unable to load comparison previews.');
      } finally {
        setLoading(false);
      }
    },
    [fetchPreviewData]
  );

  const loadPreview = useCallback(() => {
    if (viewMode === 'compare') {
      return requestComparePreviews(
        comparePaths,
        maxPoints,
        fullResolution,
        limitTimeWindow,
        timeWindowStart,
        timeWindowEnd
      );
    }
    return requestPreview(
      selectedPath,
      maxPoints,
      fullResolution,
      limitTimeWindow,
      timeWindowStart,
      timeWindowEnd
    );
  }, [
    viewMode,
    comparePaths,
    fullResolution,
    limitTimeWindow,
    maxPoints,
    requestComparePreviews,
    requestPreview,
    selectedPath,
    timeWindowEnd,
    timeWindowStart,
  ]);

  useEffect(() => {
    if (viewMode === 'single' && selectedPath) {
      requestPreview(
        selectedPath,
        maxPoints,
        fullResolution,
        limitTimeWindow,
        timeWindowStart,
        timeWindowEnd
      );
    }
    if (viewMode === 'compare') {
      requestComparePreviews(
        comparePaths,
        maxPoints,
        fullResolution,
        limitTimeWindow,
        timeWindowStart,
        timeWindowEnd
      );
    }
  }, [
    viewMode,
    selectedPath,
    comparePaths,
    requestPreview,
    requestComparePreviews,
    maxPoints,
    fullResolution,
    limitTimeWindow,
    timeWindowStart,
    timeWindowEnd,
  ]);

  const channels = useMemo(
    () => (Array.isArray(preview?.channels) ? preview.channels : []),
    [preview?.channels]
  );
  const plotData = useMemo(
    () => (Array.isArray(preview?.plotData) ? preview.plotData : []),
    [preview?.plotData]
  );
  const summary = preview?.summary || {};
  const hasMixedUnits = Boolean(summary.hasMixedUnits);
  const allChannelKeys = useMemo(() => channels.map((channel) => channel.key), [channels]);

  useEffect(() => {
    if (!allChannelKeys.length) {
      setSelectedChannelKeys([]);
      return;
    }
    setSelectedChannelKeys((prev) => {
      const prevSet = new Set(prev);
      const keep = allChannelKeys.filter((key) => prevSet.has(key));
      return keep.length ? keep : [...allChannelKeys];
    });
  }, [allChannelKeys]);

  useEffect(() => {
    const allowed = new Set(allChannelKeys);
    setChannelUnitOverrides((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([key, value]) => {
        if (allowed.has(key)) next[key] = value;
      });
      return next;
    });
  }, [allChannelKeys]);

  const resolveUnitToken = useCallback(
    (channel) => {
      return normalizeUnitToken(channelUnitOverrides[channel?.key] || DEFAULT_INPUT_UNIT);
    },
    [channelUnitOverrides]
  );

  const selectedChannels = useMemo(() => {
    if (!channels.length) return [];
    const selectedSet = new Set(selectedChannelKeys);
    return channels.filter((channel) => selectedSet.has(channel.key));
  }, [channels, selectedChannelKeys]);

  const convertedChannels = useMemo(() => {
    if (!selectedChannels.length) return [];
    return selectedChannels.map((channel) => ({
      ...channel,
      sourceUnit: channel.unit,
      unit: getChannelDisplayUnit(
        { ...channel, unit: resolveUnitToken(channel) },
        resolveUnitToken(channel),
        convertToKpa
      ),
    }));
  }, [selectedChannels, resolveUnitToken, convertToKpa]);

  const convertedPlotData = useMemo(() => {
    if (!plotData.length || !selectedChannels.length) return [];
    const conversionByKey = {};
    selectedChannels.forEach((channel) => {
      const inferred = resolveUnitToken(channel);
      const role = normalizeUnitToken(channel?.role);
      const unitToken = inferred;
      if (unitToken === 'v' || role === 'trigger' || (!convertToKpa && unitToken === 'kpa')) {
        conversionByKey[channel.key] = (v) => v;
      } else if (unitToken === 'raw' && role === 'pressure') {
        conversionByKey[channel.key] = (v) => convertValueByUnit(v, 'bar', convertToKpa);
      } else {
        conversionByKey[channel.key] = (v) => convertValueByUnit(v, unitToken, convertToKpa);
      }
    });
    return plotData.map((row) => {
      const nextRow = { t: row.t };
      selectedChannels.forEach((channel) => {
        const converter = conversionByKey[channel.key] || ((v) => v);
        nextRow[channel.key] = converter(row[channel.key]);
      });
      return nextRow;
    });
  }, [plotData, selectedChannels, resolveUnitToken, convertToKpa]);

  const compareOptions = useMemo(
    () => dataFiles.map((item) => ({ value: item.path, label: formatFileName(item.path) })),
    [dataFiles]
  );
  const compareChannelOptionsByPath = useMemo(() => {
    const next = {};
    comparePaths.forEach((path) => {
      const channelsList = Array.isArray(comparePreviews[path]?.channels) ? comparePreviews[path].channels : [];
      if (!channelsList.length) {
        next[path] = [{ value: 0, label: 'Channel 1' }];
        return;
      }
      next[path] = channelsList.map((channel, idx) => ({
        value: idx,
        label: channel?.label || `Channel ${idx + 1}`,
      }));
    });
    return next;
  }, [comparePaths, comparePreviews]);

  const compareOverlay = useMemo(() => {
    if (viewMode !== 'compare') return { channels: [], plotData: [], summaries: [] };
    const activePaths = comparePaths.filter((path) => comparePreviews[path]);
    if (!activePaths.length) return { channels: [], plotData: [], summaries: [] };

    const seenLabels = new Map();
    const perSeries = activePaths
      .map((path, idx) => {
        const entry = comparePreviews[path];
        const rows = Array.isArray(entry?.plotData) ? entry.plotData : [];
        const channelsList = Array.isArray(entry?.channels) ? entry.channels : [];
        const channelIndex = Math.max(
          0,
          Math.min(
            channelsList.length - 1,
            Number.isFinite(Number(compareChannelByPath[path])) ? Number(compareChannelByPath[path]) : 0
          )
        );
        const channelKey = `ch_${channelIndex}`;
        const channelMeta = channelsList[channelIndex] || channelsList[0] || null;
        if (!rows.length) return null;
        const unitToken = normalizeUnitToken(compareUnitOverrides[path] || DEFAULT_INPUT_UNIT);
        const roleToken = normalizeUnitToken(channelMeta?.role);
        const convert = (v) => {
          if (unitToken === 'v' || roleToken === 'trigger' || (!convertToKpa && unitToken === 'kpa')) return Number(v);
          if (unitToken === 'raw' && roleToken === 'pressure') return convertValueByUnit(v, 'bar', convertToKpa);
          return convertValueByUnit(v, unitToken, convertToKpa);
        };
        const baseLabel = formatFileName(path);
        const seenCount = seenLabels.get(baseLabel) || 0;
        seenLabels.set(baseLabel, seenCount + 1);
        const uniqueLabel = seenCount === 0 ? baseLabel : `${baseLabel} (${seenCount + 1})`;
        return {
          path,
          color: CHANNEL_COLORS[idx % CHANNEL_COLORS.length],
          label: uniqueLabel,
          sourceLabel: channelMeta?.label || `Channel ${channelIndex + 1}`,
          sourceUnit: getChannelDisplayUnit(
            { ...channelMeta, unit: unitToken || channelMeta?.unit || DEFAULT_INPUT_UNIT },
            unitToken || channelMeta?.unit || DEFAULT_INPUT_UNIT,
            convertToKpa
          ),
          values: rows.map((row) => convert(row[channelKey])),
        };
      })
      .filter(Boolean);

    if (!perSeries.length) return { channels: [], plotData: [], summaries: [] };
    const maxLen = Math.max(...perSeries.map((s) => s.values.length));
    const safeLen = Math.max(0, Math.min(maxLen, 4000));
    const compareRows = [];
    for (let i = 0; i < safeLen; i += 1) {
      const row = { t: i };
      perSeries.forEach((series, sIdx) => {
        const srcLen = series.values.length;
        if (!srcLen) return;
        const mapped = safeLen > 1 ? Math.round((i * (srcLen - 1)) / (safeLen - 1)) : 0;
        row[`series_${sIdx}`] = series.values[mapped];
      });
      compareRows.push(row);
    }
    const channelsOut = perSeries.map((series, idx) => ({
      key: `series_${idx}`,
      label: series.label,
      unit: series.sourceUnit || 'raw',
      role: 'signal',
      index: idx,
    }));
    return {
      channels: channelsOut,
      plotData: compareRows,
      summaries: perSeries.map((series) => ({
        path: series.path,
        label: series.label,
        channel: series.sourceLabel,
        unit: series.sourceUnit,
      })),
    };
  }, [viewMode, comparePaths, comparePreviews, compareChannelByPath, compareUnitOverrides, convertToKpa]);

  return (
    <div className="space-y-5">
      <div className="bg-card/60 border border-border rounded-xl p-5 shadow-sm">
        <div className="mb-3 inline-flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode('single')}
            className={`px-3 py-1.5 text-xs font-semibold transition ${viewMode === 'single' ? 'bg-primary/20 text-primary' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          >
            Single Test
          </button>
          <button
            type="button"
            onClick={() => setViewMode('compare')}
            className={`px-3 py-1.5 text-xs font-semibold border-l border-border transition ${viewMode === 'compare' ? 'bg-primary/20 text-primary' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          >
            Compare Tests
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {viewMode === 'single' ? (
            <div className="w-full sm:w-[320px]">
              <label className="block text-xs text-muted-foreground font-semibold mb-1">
                Source File
              </label>
              <select
                value={selectedPath}
                onChange={(event) => setSelectedPath(event.target.value)}
                className="w-full max-w-full p-2.5 bg-background border border-border rounded-md text-xs text-foreground outline-none"
                disabled={!dataFiles.length}
              >
                {!dataFiles.length && <option value="">No selected files from Import Data queue</option>}
                {dataFiles.map((fileObj) => {
                  const value = fileObj.path;
                  return (
                    <option key={value} value={value}>
                      {formatFileName(value)}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <>
              <div className="w-full sm:w-fit sm:min-w-[240px] sm:max-w-[320px] sm:self-start">
                <div className="text-xs text-muted-foreground font-semibold mb-1">Compare Files</div>
                <div className="max-h-36 overflow-y-auto rounded-md border border-border bg-background p-2 space-y-1">
                  {compareOptions.length === 0 && (
                    <div className="text-xs text-muted-foreground">No selected files from Import Data queue</div>
                  )}
                  {compareOptions.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={comparePaths.includes(option.value)}
                        onChange={(event) =>
                          setComparePaths((prev) => {
                            if (event.target.checked) {
                              return prev.includes(option.value) ? prev : [...prev, option.value];
                            }
                            return prev.filter((path) => path !== option.value);
                          })
                        }
                        className="accent-blue-600 w-3.5 h-3.5"
                      />
                      <span className="truncate" title={option.label}>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="w-[120px]">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">
              Max Points
            </label>
            <input
              type="number"
              min={100}
              max={2000000}
              step={100}
              value={maxPoints}
              onChange={(event) => setMaxPoints(event.target.value)}
              className="w-full p-2.5 bg-background border border-border rounded-md text-xs text-foreground outline-none"
              disabled={fullResolution}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-foreground px-2 pb-2">
            <input
              type="checkbox"
              checked={convertToKpa}
              onChange={(event) => setConvertToKpa(event.target.checked)}
              className="accent-blue-600 w-4 h-4"
            />
            Convert pressure to kPa
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-foreground px-2 pb-2">
            <input
              type="checkbox"
              checked={fullResolution}
              onChange={(event) => setFullResolution(event.target.checked)}
              className="accent-blue-600 w-4 h-4"
            />
            Full Resolution (all points, slower)
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-foreground px-2 pb-2">
            <input
              type="checkbox"
              checked={limitTimeWindow}
              onChange={(event) => setLimitTimeWindow(event.target.checked)}
              className="accent-blue-600 w-4 h-4"
            />
            Limit Time Window (s)
          </label>
          <div className="w-[120px]">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">
              Start (s)
            </label>
            <input
              type="number"
              step="any"
              value={timeWindowStart}
              onChange={(event) => setTimeWindowStart(event.target.value)}
              className="w-full p-2.5 bg-background border border-border rounded-md text-xs text-foreground outline-none disabled:opacity-50"
              disabled={!limitTimeWindow}
              placeholder="auto"
            />
          </div>
          <div className="w-[120px]">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">
              End (s)
            </label>
            <input
              type="number"
              step="any"
              value={timeWindowEnd}
              onChange={(event) => setTimeWindowEnd(event.target.value)}
              className="w-full p-2.5 bg-background border border-border rounded-md text-xs text-foreground outline-none disabled:opacity-50"
              disabled={!limitTimeWindow}
              placeholder="auto"
            />
          </div>
          <button
            onClick={loadPreview}
            disabled={(viewMode === 'single' ? !selectedPath : comparePaths.length === 0) || loading}
            className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary hover:border-primary/60 hover:bg-primary/20 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {viewMode === 'single' ? 'Reload' : 'Reload Compare'}
          </button>
        </div>
        <div className="mt-3 inline-flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setPlotLayout('stacked')}
            className={`px-3 py-1.5 text-xs font-semibold transition ${plotLayout === 'stacked' ? 'bg-primary/20 text-primary' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          >
            {viewMode === 'compare' ? 'Separate Tests' : 'Separate Channels'}
          </button>
          <button
            type="button"
            onClick={() => setPlotLayout('overlay')}
            className={`px-3 py-1.5 text-xs font-semibold border-l border-border transition ${plotLayout === 'overlay' ? 'bg-primary/20 text-primary' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          >
            Overlay
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Plot only selected channels to keep the tab lightweight. Use this tab to inspect signal quality before EWT/Pressure analysis.
        </p>
        {hasMixedUnits && (
          <p className="mt-1 text-xs text-amber-300">
            Mixed channel units detected. Pressure and trigger channels are displayed together; check unit tags.
          </p>
        )}
        {fullResolution && (
          <p className="mt-1 text-xs text-amber-300">
            Full-resolution plotting can be heavy for large files. If UI becomes slow, uncheck this and use Max Points.
          </p>
        )}
        {limitTimeWindow && (
          <p className="mt-1 text-xs text-amber-300">
            Time window is applied at file-read stage (especially useful for TPC5 full-resolution workflows).
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!error && viewMode === 'compare' && !!compareOverlay.plotData.length && (
        <div className="bg-card/60 border border-border rounded-xl p-5 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Tests</div>
              <div className="text-foreground font-semibold">{compareOverlay.channels.length}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Channels</div>
              <div className="text-foreground font-semibold">Per file</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Plotted points</div>
              <div className="text-foreground font-semibold">{compareOverlay.plotData.length}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">X-axis</div>
              <div className="text-foreground font-semibold">Aligned sample index</div>
            </div>
          </div>

          {plotLayout === 'overlay' ? (
            <div className="w-full h-[500px] bg-background border border-border rounded-xl p-3">
              <HighResMultiChannelPlot
                plotData={compareOverlay.plotData}
                channels={compareOverlay.channels}
                height={476}
                colors={CHANNEL_COLORS}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {compareOverlay.channels.map((channel, idx) => {
                const path = compareOverlay.summaries[idx]?.path || '';
                const singleSeriesRows = compareOverlay.plotData.map((row) => ({
                  t: row.t,
                  [channel.key]: row[channel.key],
                }));
                return (
                  <div key={channel.key} className="bg-background border border-border rounded-xl p-3">
                    <div className="mb-2 text-xs text-muted-foreground">
                      <span className="text-foreground font-semibold">{channel.label}</span>
                      {channel.unit ? ` (${channel.unit})` : ''}
                    </div>
                    <HighResMultiChannelPlot
                      plotData={singleSeriesRows}
                      channels={[channel]}
                      height={260}
                      colors={[CHANNEL_COLORS[idx % CHANNEL_COLORS.length]]}
                    />
                    {!!path && (
                      <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                        <span className="text-foreground font-semibold truncate max-w-[180px]" title={formatFileName(path)}>
                          {formatFileName(path)}
                        </span>
                        <span>/</span>
                        <span>Channel</span>
                        <select
                          value={Math.max(
                            0,
                            Math.min(
                              Math.max(0, (compareChannelOptionsByPath[path] || [{ value: 0 }]).length - 1),
                              Number.isFinite(Number(compareChannelByPath[path])) ? Number(compareChannelByPath[path]) : 0
                            )
                          )}
                          onChange={(event) =>
                            setCompareChannelByPath((prev) => ({
                              ...prev,
                              [path]: Math.max(0, Number(event.target.value) || 0),
                            }))
                          }
                          className="w-[112px] bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                          title="Per-test channel selection"
                        >
                          {(compareChannelOptionsByPath[path] || [{ value: 0, label: 'Channel 1' }]).map((option) => (
                            <option key={`${path}-separate-ch-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span>/</span>
                        <span>Unit</span>
                        <select
                          value={compareUnitOverrides[path] || DEFAULT_INPUT_UNIT}
                          onChange={(event) =>
                            setCompareUnitOverrides((prev) => ({
                              ...prev,
                              [path]: event.target.value,
                            }))
                          }
                          className="w-[84px] bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                          title="Per-test channel unit override"
                        >
                          {UNIT_OPTIONS.map((option) => (
                            <option key={`${path}-separate-unit-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {plotLayout === 'overlay' && (
            <div className="mt-3 flex flex-wrap gap-2">
            {comparePaths.map((path) => (
              <div key={`controls-${path}`} className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                <span className="text-foreground font-semibold truncate max-w-[180px]" title={formatFileName(path)}>
                  {formatFileName(path)}
                </span>
                <span>/</span>
                <span>Channel</span>
                <select
                  value={Math.max(
                    0,
                    Math.min(
                      Math.max(0, (compareChannelOptionsByPath[path] || [{ value: 0 }]).length - 1),
                      Number.isFinite(Number(compareChannelByPath[path])) ? Number(compareChannelByPath[path]) : 0
                    )
                  )}
                  onChange={(event) =>
                    setCompareChannelByPath((prev) => ({
                      ...prev,
                      [path]: Math.max(0, Number(event.target.value) || 0),
                    }))
                  }
                  className="w-[112px] bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                  title="Per-test channel selection"
                >
                  {(compareChannelOptionsByPath[path] || [{ value: 0, label: 'Channel 1' }]).map((option) => (
                    <option key={`${path}-ch-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span>/</span>
                <span>Unit</span>
                <select
                  value={compareUnitOverrides[path] || DEFAULT_INPUT_UNIT}
                  onChange={(event) =>
                    setCompareUnitOverrides((prev) => ({
                      ...prev,
                      [path]: event.target.value,
                    }))
                  }
                  className="w-[84px] bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                  title="Per-test channel unit override"
                >
                  {UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Comparison mode uses one selected channel per file. X-axis uses aligned sample index for lightweight multi-test viewing.
          </p>
        </div>
      )}

      {!error && viewMode === 'single' && !!plotData.length && (
        <div className="bg-card/60 border border-border rounded-xl p-5 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Channels</div>
              <div className="text-foreground font-semibold">{summary.channelCount ?? channels.length}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Selected</div>
              <div className="text-foreground font-semibold">{convertedChannels.length}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Samples</div>
              <div className="text-foreground font-semibold">{summary.sampleCount ?? plotData.length}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Plotted points</div>
              <div className="text-foreground font-semibold">{summary.plottedCount ?? plotData.length}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Mode</div>
              <div className="text-foreground font-semibold">{summary.fullResolution ? 'Full resolution' : 'Downsampled'}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Sampling rate</div>
              <div className="text-foreground font-semibold">{formatSamplingRate(summary.samplingRateHz)}</div>
            </div>
          </div>

          {!!channels.length && (
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground font-semibold">
                  Channel Selection
                </div>
                <div className="inline-flex rounded-md border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setSelectedChannelKeys([...allChannelKeys])}
                    className="px-2 py-1 text-[10px] font-semibold bg-background text-muted-foreground hover:text-foreground"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedChannelKeys([])}
                    className="px-2 py-1 text-[10px] font-semibold border-l border-border bg-background text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {channels.map((channel) => (
                  <div
                    key={channel.key}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannelKeys.includes(channel.key)}
                      onChange={(event) =>
                        setSelectedChannelKeys((prev) => {
                          if (event.target.checked) {
                            return prev.includes(channel.key) ? prev : [...prev, channel.key];
                          }
                          return prev.filter((key) => key !== channel.key);
                        })
                      }
                      className="accent-blue-600 w-3.5 h-3.5"
                    />
                    <span className="text-foreground font-semibold">{channel.label || `Channel ${channel.index + 1}`}</span>
                    <span>/</span>
                    <span>{getChannelDisplayUnit({ ...channel, unit: resolveUnitToken(channel) }, resolveUnitToken(channel), convertToKpa)}</span>
                    <select
                      value={channelUnitOverrides[channel.key] || DEFAULT_INPUT_UNIT}
                      onChange={(event) =>
                        setChannelUnitOverrides((prev) => ({
                          ...prev,
                          [channel.key]: event.target.value,
                        }))
                      }
                      className="bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                      title="Per-channel unit override"
                    >
                      {UNIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {channel.role ? <span className="text-primary">({channel.role})</span> : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {convertedChannels.length === 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              No channels selected. Pick at least one channel to render the preview.
            </div>
          ) : plotLayout === 'overlay' ? (
            <div className="w-full h-[500px] bg-background border border-border rounded-xl p-3">
              <HighResMultiChannelPlot
                plotData={convertedPlotData}
                channels={convertedChannels}
                height={476}
                colors={CHANNEL_COLORS}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {convertedChannels.map((channel, idx) => (
                <div key={channel.key} className="bg-background border border-border rounded-xl p-3">
                  <div className="mb-2 text-xs text-muted-foreground">
                    <span className="text-foreground font-semibold">{channel.label || `Channel ${channel.index + 1}`}</span>
                    {channel.unit ? ` (${channel.unit})` : ''}
                    {channel.role ? ` - ${channel.role}` : ''}
                  </div>
                  <HighResMultiChannelPlot
                    plotData={convertedPlotData}
                    channels={[channel]}
                    height={260}
                    colors={[CHANNEL_COLORS[idx % CHANNEL_COLORS.length]]}
                  />
                </div>
              ))}
            </div>
          )}

          {!!channels.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {channels.map((channel) => (
                <span
                  key={channel.key}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground"
                >
                  <span className="text-foreground font-semibold">{channel.label || `Channel ${channel.index + 1}`}</span>
                  <span>/</span>
                  <span>{getChannelDisplayUnit({ ...channel, unit: resolveUnitToken(channel) }, resolveUnitToken(channel), convertToKpa)}</span>
                  {channel.role ? <span className="text-primary">({channel.role})</span> : null}
                </span>
              ))}
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Note: this view may downsample for plotting performance. Raw analysis in other tabs still uses full data.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Zoom tip: drag on the plot area to zoom, then double-click to reset.
          </p>
        </div>
      )}
    </div>
  );
};

export default DataPreprocessingPage;
