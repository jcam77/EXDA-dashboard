import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import HighResMultiChannelPlot from '../components/HighResMultiChannelPlot';

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
const UNIT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'bar', label: 'bar' },
  { value: 'kPa', label: 'kPa' },
  { value: 'Pa', label: 'Pa' },
  { value: 'V', label: 'V (trigger)' },
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
const normalizeUnitToken = (value) => String(value || 'raw').trim().toLowerCase();

const convertValueByUnit = (value, unit, convertToKpa) => {
  const y = Number(value);
  if (!Number.isFinite(y)) return y;
  if (!convertToKpa) return y;
  if (unit === 'bar' || unit === 'barg') return y * 100.0;
  if (unit === 'pa' || unit === 'pascal' || unit === 'pascals') return (y - 101325.0) / 1000.0;
  return y;
};

const getChannelDisplayUnit = (channel, selectedInputUnit, convertToKpa) => {
  const explicit = normalizeUnitToken(selectedInputUnit);
  const inferred = normalizeUnitToken(channel?.unit);
  const role = normalizeUnitToken(channel?.role);
  const base = explicit === 'auto' ? inferred : explicit;
  if (base === 'v' || role === 'trigger') return 'V';
  if (base === 'kpa' || base === 'kpag') return 'kPa';
  if (base === 'pa' || base === 'pascal' || base === 'pascals') return convertToKpa ? 'kPa' : 'Pa';
  if (base === 'bar' || base === 'barg') return convertToKpa ? 'kPa' : 'bar';
  return convertToKpa ? (role === 'pressure' ? 'kPa' : (channel?.unit || 'raw')) : (channel?.unit || 'raw');
};

const CleanDataPage = ({ apiBaseUrl, projectPath, selectedCases = [] }) => {
  const [selectedPath, setSelectedPath] = useState('');
  const [maxPoints, setMaxPoints] = useState(2000);
  const [fullResolution, setFullResolution] = useState(false);
  const [plotLayout, setPlotLayout] = useState('stacked');
  const [convertToKpa, setConvertToKpa] = useState(true);
  const [selectedChannelKeys, setSelectedChannelKeys] = useState([]);
  const [channelUnitOverrides, setChannelUnitOverrides] = useState({});
  const [preview, setPreview] = useState(null);
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
      setPreview(null);
      return;
    }
    const exists = dataFiles.some((fileObj) => (fileObj.path || fileObj.webkitRelativePath) === selectedPath);
    if (!selectedPath || !exists) {
      setSelectedPath(dataFiles[0].path || dataFiles[0].webkitRelativePath);
    }
  }, [dataFiles, selectedPath]);

  const requestPreview = useCallback(async (pathValue, pointsValue, fullResValue) => {
    if (!pathValue) return;
    setLoading(true);
    setError('');
    try {
      const fileRes = await fetch(
        `${apiBaseUrl}/read_project_file?path=${encodeURIComponent(pathValue)}&projectPath=${encodeURIComponent(projectPath || '')}`
      );
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
      setPreview(previewJson);
    } catch (err) {
      setPreview(null);
      setError(err?.message || 'Unable to load channel preview.');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, projectPath]);

  const loadPreview = useCallback(() => {
    return requestPreview(selectedPath, maxPoints, fullResolution);
  }, [fullResolution, maxPoints, requestPreview, selectedPath]);

  useEffect(() => {
    if (selectedPath) {
      requestPreview(selectedPath, maxPoints, fullResolution);
    }
  }, [selectedPath, requestPreview, maxPoints, fullResolution]);

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
      const channelToken = normalizeUnitToken(channelUnitOverrides[channel?.key] || 'auto');
      if (channelToken !== 'auto') return channelToken;
      return normalizeUnitToken(channel?.unit);
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

  return (
    <div className="space-y-5">
      <div className="bg-card/60 border border-border rounded-xl p-5 shadow-2xl">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-[320px]">
            <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
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
          <div className="w-[120px]">
            <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
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
          <button
            onClick={loadPreview}
            disabled={!selectedPath || loading}
            className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary hover:border-primary/60 hover:bg-primary/20 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Reload
          </button>
        </div>
        <div className="mt-3 inline-flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setPlotLayout('stacked')}
            className={`px-3 py-1.5 text-xs font-semibold transition ${plotLayout === 'stacked' ? 'bg-primary/20 text-primary' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          >
            Separate Channels
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
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!error && !!plotData.length && (
        <div className="bg-card/60 border border-border rounded-xl p-5 shadow-2xl">
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
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
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
                      value={channelUnitOverrides[channel.key] || 'auto'}
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

export default CleanDataPage;
