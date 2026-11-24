import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Shield } from 'lucide-react';
import HighResMultiChannelPlot from '../components/HighResMultiChannelPlot';
import PeakTable from '../components/PeakTable';
import { FROM_FILE_UNIT, UNIT_OPTIONS_WITH_FILE, convertValueByUnit, getChannelDisplayUnit, isVoltageOrTrigger, normalizeUnitToken } from '../utils/units';

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

const getShortDisplayName = (value) => {
  const base = formatFileName(value);
  if (!base) return '';
  return base.length > 32 ? `${base.slice(0, 29)}...` : base;
};

const getRunKeyFromFileName = (value) => {
  const base = formatFileName(value).replace(/\.[^.]+$/, '');
  if (!base) return '';
  return base
    .replace(/-DAQ-[A-Za-z0-9_-]+$/i, '')
    .replace(/-H2CM(?:-[UML])?$/i, '')
    .replace(/-H2CM-U-M-L$/i, '');
};

const getPreviewSamplingRate = (preview, preferredChannelIndex = 0) => {
  const summaryRate = Number(preview?.summary?.samplingRateHz);
  if (Number.isFinite(summaryRate) && summaryRate > 0) return summaryRate;

  const channels = Array.isArray(preview?.channels) ? preview.channels : [];
  if (!channels.length) return null;
  const boundedIndex = Math.max(0, Math.min(channels.length - 1, Number(preferredChannelIndex) || 0));
  const channelRate = Number(channels[boundedIndex]?.sampleRateHz ?? channels[0]?.sampleRateHz);
  return Number.isFinite(channelRate) && channelRate > 0 ? channelRate : null;
};

const buildScreeningStateStorageKey = (projectPath, analysisMode) => {
  const base = String(projectPath || '__no_project__').trim() || '__no_project__';
  const mode = String(analysisMode || 'pressure').trim() || 'pressure';
  return `exda:raw-screening-state:${base}:${mode}`;
};

const readPersistedScreeningState = (storageKey) => {
  if (typeof window === 'undefined' || !storageKey) return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const writePersistedScreeningState = (storageKey, payload) => {
  if (typeof window === 'undefined' || !storageKey) return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Ignore persistence failures (quota/private mode/etc.) and keep UI functional.
  }
};

const RawDataScreeningCorePage = ({ apiBaseUrl, projectPath, selectedCases = [], analysisMode = 'pressure' }) => {
  const isConcentrationMode = analysisMode === 'concentration';
  const stateStorageKey = useMemo(
    () => buildScreeningStateStorageKey(projectPath, analysisMode),
    [projectPath, analysisMode]
  );
  const [stateRestored, setStateRestored] = useState(false);
  const restoredSelectedChannelKeysRef = useRef(false);
  const [selectedPath, setSelectedPath] = useState('');
  // Peak table (screen only): time range and ticked channels per file.
  const [peakRangeByPath, setPeakRangeByPath] = useState({});
  const [peakIncludedByPath, setPeakIncludedByPath] = useState({});
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
  const [convertToKpa, setConvertToKpa] = useState(!isConcentrationMode);
  const [convertPpmToVolPercent, setConvertPpmToVolPercent] = useState(false);
  const [selectedChannelKeys, setSelectedChannelKeys] = useState([]);
  const [channelUnitOverrides, setChannelUnitOverrides] = useState({});
  // H2S logs (EXDA-Check B6): one recording per file is chosen, never joined.
  const [h2sBlockByPath, setH2sBlockByPath] = useState({});
  const [h2sBlocksByPath, setH2sBlocksByPath] = useState({});
  const h2sEnrichedRef = useRef(new Set());
  const [preview, setPreview] = useState(null);
  const [comparePreviews, setComparePreviews] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const persisted = readPersistedScreeningState(stateStorageKey);
    restoredSelectedChannelKeysRef.current = false;
    if (persisted) {
      if (persisted.selectedPath != null) setSelectedPath(String(persisted.selectedPath || ''));
      if (persisted.viewMode === 'single' || persisted.viewMode === 'compare') setViewMode(persisted.viewMode);
      if (Array.isArray(persisted.comparePaths)) setComparePaths(persisted.comparePaths.map((v) => String(v || '')).filter(Boolean));
      if (persisted.compareChannelByPath && typeof persisted.compareChannelByPath === 'object') setCompareChannelByPath(persisted.compareChannelByPath);
      if (persisted.compareUnitOverrides && typeof persisted.compareUnitOverrides === 'object') setCompareUnitOverrides(persisted.compareUnitOverrides);
      if (Number.isFinite(Number(persisted.maxPoints))) setMaxPoints(Math.max(100, Math.min(2_000_000, Number(persisted.maxPoints))));
      if (typeof persisted.fullResolution === 'boolean') setFullResolution(persisted.fullResolution);
      if (typeof persisted.limitTimeWindow === 'boolean') setLimitTimeWindow(persisted.limitTimeWindow);
      if (persisted.timeWindowStart != null) setTimeWindowStart(String(persisted.timeWindowStart));
      if (persisted.timeWindowEnd != null) setTimeWindowEnd(String(persisted.timeWindowEnd));
      if (persisted.plotLayout === 'stacked' || persisted.plotLayout === 'overlay') setPlotLayout(persisted.plotLayout);
      if (typeof persisted.convertToKpa === 'boolean') setConvertToKpa(persisted.convertToKpa);
      if (typeof persisted.convertPpmToVolPercent === 'boolean') setConvertPpmToVolPercent(persisted.convertPpmToVolPercent);
      if (Array.isArray(persisted.selectedChannelKeys)) {
        setSelectedChannelKeys(persisted.selectedChannelKeys.map((v) => String(v || '')).filter(Boolean));
        restoredSelectedChannelKeysRef.current = true;
      }
      if (persisted.channelUnitOverrides && typeof persisted.channelUnitOverrides === 'object') setChannelUnitOverrides(persisted.channelUnitOverrides);
      if (persisted.h2sBlockByPath && typeof persisted.h2sBlockByPath === 'object') setH2sBlockByPath(persisted.h2sBlockByPath);
      if (persisted.peakRangeByPath && typeof persisted.peakRangeByPath === 'object') setPeakRangeByPath(persisted.peakRangeByPath);
      if (persisted.peakIncludedByPath && typeof persisted.peakIncludedByPath === 'object') setPeakIncludedByPath(persisted.peakIncludedByPath);
    }
    setStateRestored(true);
  }, [stateStorageKey]);

  useEffect(() => {
    if (!stateRestored) return;
    writePersistedScreeningState(stateStorageKey, {
      selectedPath,
      viewMode,
      comparePaths,
      compareChannelByPath,
      compareUnitOverrides,
      maxPoints,
      fullResolution,
      limitTimeWindow,
      timeWindowStart,
      timeWindowEnd,
      plotLayout,
      convertToKpa,
      convertPpmToVolPercent,
      selectedChannelKeys,
      channelUnitOverrides,
      h2sBlockByPath,
      peakRangeByPath,
      peakIncludedByPath,
    });
  }, [
    stateRestored,
    stateStorageKey,
    selectedPath,
    viewMode,
    comparePaths,
    compareChannelByPath,
    compareUnitOverrides,
    maxPoints,
    fullResolution,
    limitTimeWindow,
    timeWindowStart,
    timeWindowEnd,
    plotLayout,
    convertToKpa,
    convertPpmToVolPercent,
    selectedChannelKeys,
    channelUnitOverrides,
    h2sBlockByPath,
    peakRangeByPath,
    peakIncludedByPath,
  ]);

  useEffect(() => {
    if (isConcentrationMode) {
      setConvertToKpa(false);
    }
  }, [isConcentrationMode]);

  const dataFiles = useMemo(() => {
    if (!Array.isArray(selectedCases)) return [];
    const seen = new Set();
    const selectedOnly = selectedCases
      .filter((item) => {
        if (!item) return false;
        const itemType = String(item.type || '').toLowerCase();
        return isConcentrationMode ? itemType === 'concentration' : (itemType === 'pressure' || itemType === 'flame');
      })
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
  }, [isConcentrationMode, selectedCases]);

  useEffect(() => {
    if (!stateRestored) return;
    if (!dataFiles.length) {
      setPreview(null);
      return;
    }
    const normalizePath = (value) => String(value || '').replace(/\\/g, '/');
    const selectedNormalized = normalizePath(selectedPath);
    let matched = dataFiles.find((fileObj) => normalizePath(fileObj.path || fileObj.webkitRelativePath) === selectedNormalized);
    if (!matched && selectedPath) {
      const selectedName = formatFileName(selectedPath).toLowerCase();
      matched = dataFiles.find((fileObj) => formatFileName(fileObj.path || fileObj.webkitRelativePath).toLowerCase() === selectedName);
    }
    if (!selectedPath || !matched) {
      setSelectedPath((matched || dataFiles[0]).path || (matched || dataFiles[0]).webkitRelativePath);
    }
  }, [dataFiles, selectedPath, stateRestored]);

  useEffect(() => {
    if (!stateRestored) return;
    if (!dataFiles.length) return;
    setComparePaths((prev) => {
      const allowed = new Set(dataFiles.map((item) => item.path));
      const kept = prev.filter((path) => allowed.has(path));
      if (kept.length) return kept;
      return dataFiles.slice(0, Math.min(3, dataFiles.length)).map((item) => item.path);
    });
  }, [dataFiles, stateRestored]);

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
        maxPoints: String(Number.isFinite(Number(pointsValue)) ? Number(pointsValue) : 2000),
      });
      if (limitWindowValue) {
        const startNumeric = Number(startValue);
        const endNumeric = Number(endValue);
        if (Number.isFinite(startNumeric)) fileQuery.set('windowStart', String(startNumeric));
        if (Number.isFinite(endNumeric)) fileQuery.set('windowEnd', String(endNumeric));
      }
      const chosenBlock = h2sBlockByPath[pathValue];
      if (chosenBlock !== undefined && chosenBlock !== null && chosenBlock !== '') {
        fileQuery.set('block', String(chosenBlock));
      }
      const fileRes = await fetch(`${apiBaseUrl}/read_project_file?${fileQuery.toString()}`);
      const fileJson = await fileRes.json();
      if (Array.isArray(fileJson?.h2sBlocks)) {
        const blocks = fileJson.h2sBlocks;
        setH2sBlocksByPath((prev) => ({ ...prev, [pathValue]: prev[pathValue]?.enriched ? prev[pathValue] : { blocks } }));
        if (!h2sEnrichedRef.current.has(pathValue)) {
          h2sEnrichedRef.current.add(pathValue);
          const infoQuery = new URLSearchParams({ path: pathValue, projectPath: projectPath || '' });
          fetch(`${apiBaseUrl}/h2s_blocks?${infoQuery.toString()}`)
            .then((res) => res.json())
            .then((info) => {
              if (info?.success && Array.isArray(info.blocks)) {
                setH2sBlocksByPath((prev) => ({ ...prev, [pathValue]: { blocks: info.blocks, enriched: true } }));
              }
            })
            .catch(() => {});
        }
      }
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
          // Real sample count and sampling rate when the reader already reduced the file.
          sourceInfo: fileJson.sampleInfo || null,
        }),
      });
      const previewJson = await previewRes.json();
      if (!previewRes.ok || previewJson?.error) {
        throw new Error(previewJson?.error || 'Failed to parse channel data');
      }
      return previewJson;
    },
    [apiBaseUrl, h2sBlockByPath, projectPath]
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
    if (!allChannelKeys.length) return;
    setSelectedChannelKeys((prev) => {
      const prevSet = new Set(prev);
      const keep = allChannelKeys.filter((key) => prevSet.has(key));
      if (keep.length) return keep;
      if (prev.length === 0 && restoredSelectedChannelKeysRef.current) return [];
      return [...allChannelKeys];
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
      // Unit from the file header unless the user overrides it (EXDA-Check B5).
      const override = channelUnitOverrides[channel?.key];
      if (override && override !== FROM_FILE_UNIT) return normalizeUnitToken(override);
      return normalizeUnitToken(channel?.unit || 'raw');
    },
    [channelUnitOverrides]
  );

  const selectedChannels = useMemo(() => {
    if (!channels.length) return [];
    if (isConcentrationMode) {
      return [channels[0]].filter(Boolean);
    }
    const selectedSet = new Set(selectedChannelKeys);
    return channels.filter((channel) => selectedSet.has(channel.key));
  }, [channels, isConcentrationMode, selectedChannelKeys]);

  const displayNameByPath = useMemo(() => {
    const map = new Map();
    dataFiles.forEach((item) => {
      map.set(item.path, item.name || formatFileName(item.path));
    });
    return map;
  }, [dataFiles]);

  const convertedChannels = useMemo(() => {
    if (!selectedChannels.length) return [];
    if (isConcentrationMode) {
      const sourceLabel = displayNameByPath.get(selectedPath) || formatFileName(selectedPath) || 'Concentration';
      return selectedChannels.map((channel) => {
        const sourceUnit = channel.unit && channel.unit !== 'raw' ? channel.unit : 'unknown unit';
        const isPpm = String(sourceUnit).toLowerCase() === 'ppm';
        return {
          ...channel,
          label: sourceLabel,
          sourceUnit,
          unit: isPpm && convertPpmToVolPercent ? 'vol.%' : sourceUnit,
          role: 'concentration',
        };
      });
    }
    return selectedChannels.map((channel) => ({
      ...channel,
      sourceUnit: channel.unit,
      unit: getChannelDisplayUnit(
        { ...channel, unit: resolveUnitToken(channel) },
        resolveUnitToken(channel),
        convertToKpa
      ),
    }));
  }, [selectedChannels, isConcentrationMode, convertPpmToVolPercent, convertToKpa, displayNameByPath, resolveUnitToken, selectedPath]);

  const peakRange = peakRangeByPath[selectedPath] || { start: '', end: '' };
  const peakBand = useMemo(() => {
    const start = String(peakRange.start ?? '').trim() === '' ? NaN : Number(peakRange.start);
    const end = String(peakRange.end ?? '').trim() === '' ? NaN : Number(peakRange.end);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
  }, [peakRange.start, peakRange.end]);
  // Unit token of a converted channel from its recorded unit (or the user's override),
  // not from its display unit: a display unit of "kPa" may stand for recorded bar.
  const sourceUnitToken = useCallback(
    (channel) => resolveUnitToken({ ...channel, unit: channel.sourceUnit ?? channel.unit }),
    [resolveUnitToken]
  );
  const peakIncluded = useMemo(() => {
    const stored = peakIncludedByPath[selectedPath] || {};
    const next = {};
    convertedChannels.forEach((channel) => {
      next[channel.key] = typeof stored[channel.key] === 'boolean'
        ? stored[channel.key]
        : !isVoltageOrTrigger(channel, sourceUnitToken(channel));
    });
    return next;
  }, [convertedChannels, peakIncludedByPath, sourceUnitToken, selectedPath]);

  const convertedPlotData = useMemo(() => {
    if (!plotData.length || !selectedChannels.length) return [];
    if (isConcentrationMode) {
      return plotData.map((row) => {
        const nextRow = { t: row.t };
        selectedChannels.forEach((channel) => {
          const rawValue = Number(row[channel.key]);
          const isPpm = String(channel.unit || '').toLowerCase() === 'ppm';
          const value = Number.isFinite(rawValue)
            ? (convertPpmToVolPercent && isPpm ? rawValue / 10000 : rawValue)
            : rawValue;
          nextRow[channel.key] = value;
        });
        return nextRow;
      });
    }
    const conversionByKey = {};
    selectedChannels.forEach((channel) => {
      const inferred = resolveUnitToken(channel);
      const role = normalizeUnitToken(channel?.role);
      const unitToken = inferred;
      if (unitToken === 'v' || role === 'trigger' || (!convertToKpa && unitToken === 'kpa')) {
        conversionByKey[channel.key] = (v) => v;
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
  }, [plotData, selectedChannels, isConcentrationMode, convertPpmToVolPercent, resolveUnitToken, convertToKpa]);

  const compareOptions = useMemo(
    () => dataFiles.map((item) => ({ value: item.path, label: item.name || formatFileName(item.path) })),
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

  const compareOverlayCompatibility = useMemo(() => {
    if (viewMode !== 'compare') return { enabled: true, reason: '' };
    const activePaths = comparePaths.filter((path) => comparePreviews[path]);
    if (activePaths.length < 2) {
      return { enabled: false, reason: 'Select at least two tests to enable Overlay.' };
    }
    const runKeys = activePaths.map((path) => getRunKeyFromFileName(displayNameByPath.get(path) || path));
    const base = runKeys[0] || '';
    const sameRun = runKeys.every((k) => k && k === base);
    if (!sameRun) {
      return {
        enabled: false,
        reason:
          'Overlay is currently enabled only for files from the same run/test. Use Separate Tests for cross-run comparison.',
      };
    }

    const samplingRates = activePaths
      .map((path) => {
        const preferredChannel = Number.isFinite(Number(compareChannelByPath[path]))
          ? Number(compareChannelByPath[path])
          : 0;
        return getPreviewSamplingRate(comparePreviews[path], preferredChannel);
      })
      .filter((rate) => Number.isFinite(rate) && rate > 0);
    if (samplingRates.length >= 2) {
      const minRate = Math.min(...samplingRates);
      const maxRate = Math.max(...samplingRates);
      if (minRate > 0 && maxRate / minRate > 1.2) {
        return {
          enabled: false,
          reason:
            'Overlay is temporarily disabled for mixed DAQ sampling rates in compare mode. Use Separate Tests for accurate native-time review.',
        };
      }
    }

    return { enabled: true, reason: '' };
  }, [viewMode, comparePaths, comparePreviews, displayNameByPath, compareChannelByPath]);

  useEffect(() => {
    if (viewMode === 'compare' && plotLayout === 'overlay' && !compareOverlayCompatibility.enabled) {
      setPlotLayout('stacked');
    }
  }, [viewMode, plotLayout, compareOverlayCompatibility.enabled]);

  const compareOverlay = useMemo(() => {
    if (viewMode !== 'compare') return { channels: [], plotData: [], xAxisMode: 'time', perSeriesRows: [], summaries: [] };
    const activePaths = comparePaths.filter((path) => comparePreviews[path]);
    if (!activePaths.length) return { channels: [], plotData: [], xAxisMode: 'time', perSeriesRows: [], summaries: [] };

    const seenLabels = new Map();
    const perSeries = activePaths
      .map((path, idx) => {
        const entry = comparePreviews[path];
        const rows = Array.isArray(entry?.plotData) ? entry.plotData : [];
        const channelsList = Array.isArray(entry?.channels) ? entry.channels : [];
        const channelIndex = isConcentrationMode
          ? 0
          : Math.max(
              0,
              Math.min(
                channelsList.length - 1,
                Number.isFinite(Number(compareChannelByPath[path])) ? Number(compareChannelByPath[path]) : 0
              )
            );
        const channelKey = `ch_${channelIndex}`;
        const channelMeta = channelsList[channelIndex] || channelsList[0] || null;
        if (!rows.length) return null;
        const concentrationIsPpm = String(channelMeta?.unit || '').toLowerCase() === 'ppm';
        const unitToken = isConcentrationMode
          ? (concentrationIsPpm ? 'ppm' : 'raw')
          : (compareUnitOverrides[path] && compareUnitOverrides[path] !== FROM_FILE_UNIT
              ? normalizeUnitToken(compareUnitOverrides[path])
              : normalizeUnitToken(channelMeta?.unit || 'raw'));
        const roleToken = normalizeUnitToken(channelMeta?.role);
        const convert = (v) => {
          if (isConcentrationMode) {
            const raw = Number(v);
            if (!Number.isFinite(raw)) return raw;
            return convertPpmToVolPercent && concentrationIsPpm ? raw / 10000 : raw;
          }
          if (unitToken === 'v' || roleToken === 'trigger' || (!convertToKpa && unitToken === 'kpa')) return Number(v);
          return convertValueByUnit(v, unitToken, convertToKpa);
        };
        const baseLabel = displayNameByPath.get(path) || formatFileName(path);
        const seenCount = seenLabels.get(baseLabel) || 0;
        seenLabels.set(baseLabel, seenCount + 1);
        const uniqueLabel = seenCount === 0 ? baseLabel : `${baseLabel} (${seenCount + 1})`;
        return {
          path,
          color: CHANNEL_COLORS[idx % CHANNEL_COLORS.length],
          label: uniqueLabel,
          sourceLabel: channelMeta?.label || `Channel ${channelIndex + 1}`,
          sourceUnit: isConcentrationMode
            ? (concentrationIsPpm
                ? (convertPpmToVolPercent ? 'vol.%' : 'ppm')
                : (channelMeta?.unit && channelMeta.unit !== 'raw' ? channelMeta.unit : 'unknown unit'))
            : getChannelDisplayUnit(
                { ...channelMeta, unit: unitToken || channelMeta?.unit || 'raw' },
                unitToken || channelMeta?.unit || 'raw',
                convertToKpa
              ),
          points: rows
            .map((row) => {
              const t = Number(row?.t);
              const v = Number(convert(row?.[channelKey]));
              if (!Number.isFinite(t) || !Number.isFinite(v)) return null;
              return { t, v };
            })
            .filter(Boolean),
        };
      })
      .filter(Boolean);

    if (!perSeries.length) return { channels: [], plotData: [], xAxisMode: 'time', perSeriesRows: [], summaries: [] };

    // Keep native per-series time vectors in compare overlay.
    // No interpolation: we only emit original points and merge by exact timestamp.
    const mergedRows = [];
    perSeries.forEach((series, sIdx) => {
      (series.points || []).forEach((point) => {
        if (!Number.isFinite(point?.t) || !Number.isFinite(point?.v)) return;
        mergedRows.push({
          t: Number(point.t),
          seriesKey: `series_${sIdx}`,
          value: Number(point.v),
        });
      });
    });
    mergedRows.sort((a, b) => a.t - b.t);

    const compareRows = [];
    for (let i = 0; i < mergedRows.length; i += 1) {
      const current = mergedRows[i];
      const row = { t: current.t, [current.seriesKey]: current.value };
      while (i + 1 < mergedRows.length && mergedRows[i + 1].t === current.t) {
        i += 1;
        const sameTs = mergedRows[i];
        row[sameTs.seriesKey] = sameTs.value;
      }
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
      xAxisMode: 'native-merged',
      perSeriesRows: perSeries.map((series, idx) => ({
        key: `series_${idx}`,
        rows: (series.points || []).map((pt) => ({
          t: pt.t,
          [`series_${idx}`]: pt.v,
        })),
      })),
      summaries: perSeries.map((series) => ({
        path: series.path,
        label: series.label,
        channel: series.sourceLabel,
        unit: series.sourceUnit,
      })),
    };
  }, [viewMode, comparePaths, comparePreviews, compareChannelByPath, compareUnitOverrides, convertToKpa, convertPpmToVolPercent, displayNameByPath, isConcentrationMode]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 shadow-sm">
        <div className="text-[11px] font-semibold text-warning mb-2 uppercase tracking-wider">Read Before Screening</div>
        <div className="text-xs font-semibold text-foreground mb-2">Screening Guidance</div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5">
            <div className="flex items-center gap-1.5 text-warning font-bold text-[10px] uppercase tracking-widest">
              <Shield size={12} />
              Usage Disclaimer
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-foreground text-justify">
              EXDA-Dashboard is designed to support rapid on-site engineering assessment and preliminary interpretation of experimental data during tests. The implemented tools are intended to facilitate timely operational decisions (e.g., assessing data quality and determining whether a test repetition may be warranted). Outputs generated by the application are therefore indicative and must not be treated as final, publication-grade results or as definitive scientific conclusions.
            </p>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground text-justify">
              All results intended for reporting, publication, verification and validation (V&V), or uncertainty quantification (UQ) must be independently reviewed and processed using validated workflows outside this application, including appropriate documentation of assumptions, processing steps, and uncertainty evaluation.
            </p>
          </div>
          <div className="rounded-md border border-border bg-background/50 p-2.5">
            <div className="text-xs font-semibold text-foreground">Screening Checklist</div>
            {!isConcentrationMode ? (
              <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground list-disc pl-4">
                <li>Confirm sampling rate is expected for the DAQ system.</li>
                <li>Check trigger alignment and ignition timing consistency.</li>
                <li>Verify peak pressure magnitude and waveform shape look physically plausible.</li>
                <li>Check for clipping, flatlines, or obvious acquisition dropouts.</li>
              </ul>
            ) : (
              <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground list-disc pl-4">
                <li>Confirm concentration values are close to expected target levels.</li>
                <li>Check pre-ignition trend for stability and mixture homogeneity behavior.</li>
                <li>Check concentration baseline drift and sensor warm-up behavior before ignition.</li>
                <li>Check for spikes, flatlines, or sensor communication dropouts.</li>
              </ul>
            )}
          </div>
        </div>
      </div>
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
              {h2sBlocksByPath[selectedPath]?.blocks?.length > 0 && (
                <div className="mt-2">
                  <label className="block text-xs text-muted-foreground font-semibold mb-1">
                    Recording in this file
                  </label>
                  <select
                    value={h2sBlockByPath[selectedPath] ?? ''}
                    onChange={(event) =>
                      setH2sBlockByPath((prev) => ({ ...prev, [selectedPath]: event.target.value }))
                    }
                    className="w-full max-w-full p-2 bg-background border border-border rounded-md text-xs text-foreground outline-none"
                  >
                    <option value="">Choose a recording…</option>
                    {h2sBlocksByPath[selectedPath].blocks.map((block) => (
                      <option key={block.index} value={String(block.index)} disabled={block.empty}>
                        {`Recording ${block.index + 1}: ${block.empty ? 'empty' : `${block.timeStart}–${block.timeEnd}, ${block.rowCount} rows`}`}
                        {block.duplicateOf !== null && block.duplicateOf !== undefined ? ` (same data as recording ${block.duplicateOf + 1})` : ''}
                        {Array.isArray(block.identicalElsewhere) && block.identicalElsewhere.length > 0 ? ` (identical to ${block.identicalElsewhere.join('; ')})` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Device {h2sBlocksByPath[selectedPath].blocks[0]?.device?.['Device ID'] || '-'}
                    {' / factory ID '}{h2sBlocksByPath[selectedPath].blocks[0]?.device?.['Factory Device ID'] || '-'}.
                    Recordings are shown separately and never joined. Time is from the start of the recording.
                  </div>
                </div>
              )}
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
              Display limit
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
          {!isConcentrationMode ? (
            <label className="inline-flex items-center gap-2 text-xs text-foreground px-2 pb-2">
              <input
                type="checkbox"
                checked={convertToKpa}
                onChange={(event) => setConvertToKpa(event.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              Convert pressure to kPa
            </label>
          ) : (
            <label className="inline-flex items-center gap-2 text-xs text-foreground px-2 pb-2">
              <input
                type="checkbox"
                checked={convertPpmToVolPercent}
                onChange={(event) => setConvertPpmToVolPercent(event.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              Convert ppm to vol.% (÷ 10,000; ppm channels only)
            </label>
          )}
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
            disabled={viewMode === 'compare' && !compareOverlayCompatibility.enabled}
            className={`px-3 py-1.5 text-xs font-semibold border-l border-border transition ${
              viewMode === 'compare' && !compareOverlayCompatibility.enabled
                ? 'bg-background text-muted-foreground/60 cursor-not-allowed'
                : plotLayout === 'overlay'
                  ? 'bg-primary/20 text-primary'
                  : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
            title={viewMode === 'compare' && !compareOverlayCompatibility.enabled ? compareOverlayCompatibility.reason : 'Overlay'}
          >
            Overlay
          </button>
        </div>
        {viewMode === 'compare' && !compareOverlayCompatibility.enabled && (
          <p className="mt-2 text-xs text-amber-300">
            {compareOverlayCompatibility.reason}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {isConcentrationMode
            ? 'Single-channel H2 concentration preview in ppm or Vol.% for quick sanity checks.'
            : 'Plot only selected channels to keep the tab lightweight. Use this tab to inspect signal quality before EWT/Pressure analysis.'}
        </p>
        {hasMixedUnits && !isConcentrationMode && (
          <p className="mt-1 text-xs text-amber-300">
            Mixed channel units detected. Pressure and trigger channels are displayed together; check unit tags.
          </p>
        )}
        {fullResolution && (
          <p className="mt-1 text-xs text-amber-300">
            Full-resolution plotting can be heavy for large files. If UI becomes slow, uncheck this and use Display limit.
          </p>
        )}
        {limitTimeWindow && (
          <p className="mt-1 text-xs text-amber-300">
            Time window is applied at file-read stage (especially useful for TPC5 full-resolution workflows).
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {fullResolution
            ? 'Full resolution: every sample is plotted.'
            : 'Fast preview: the signal is split into short intervals and each interval keeps its lowest and highest sample per channel, so peaks and clipping are always visible. Use Full Resolution or a time window to see the exact waveform between those points.'}
        </p>
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
              <div className="text-muted-foreground">Displayed samples</div>
              <div className="text-foreground font-semibold">{compareOverlay.plotData.length}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">{plotLayout === 'overlay' ? 'X-axis' : 'Time axis'}</div>
              <div className="text-foreground font-semibold">
                {plotLayout === 'overlay'
                  ? 'Merged native timestamps (no interpolation)'
                  : 'Native per-file time vectors'}
              </div>
            </div>
          </div>

          {plotLayout === 'overlay' ? (
            <div className="w-full h-[500px] bg-background border border-border rounded-xl p-3">
              <HighResMultiChannelPlot
                plotData={compareOverlay.plotData}
                channels={compareOverlay.channels}
                height={476}
                colors={CHANNEL_COLORS}
                xAxisMode="time"
                xAxisLabel="Time (s)"
                spanGaps
              />
            </div>
          ) : (
            <div className="space-y-3">
              {compareOverlay.channels.map((channel, idx) => {
                const path = compareOverlay.summaries[idx]?.path || '';
                const singleSeriesRows =
                  compareOverlay.perSeriesRows?.find((entry) => entry.key === channel.key)?.rows || [];
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
                    {!!path && !isConcentrationMode && (
                      <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                        <span className="text-foreground font-semibold truncate max-w-[180px]" title={displayNameByPath.get(path) || formatFileName(path)}>
                          {getShortDisplayName(displayNameByPath.get(path) || formatFileName(path))}
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
                          value={compareUnitOverrides[path] || FROM_FILE_UNIT}
                          onChange={(event) =>
                            setCompareUnitOverrides((prev) => ({
                              ...prev,
                              [path]: event.target.value,
                            }))
                          }
                          className="w-[84px] bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                          title="Per-test channel unit override"
                        >
                          {UNIT_OPTIONS_WITH_FILE.map((option) => (
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

          {plotLayout === 'overlay' && !isConcentrationMode && (
            <div className="mt-3 flex flex-wrap gap-2">
            {comparePaths.map((path) => (
              <div key={`controls-${path}`} className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                <span className="text-foreground font-semibold truncate max-w-[180px]" title={displayNameByPath.get(path) || formatFileName(path)}>
                  {getShortDisplayName(displayNameByPath.get(path) || formatFileName(path))}
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
                  value={compareUnitOverrides[path] || FROM_FILE_UNIT}
                  onChange={(event) =>
                    setCompareUnitOverrides((prev) => ({
                      ...prev,
                      [path]: event.target.value,
                    }))
                  }
                  className="w-[84px] bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                  title="Per-test channel unit override"
                >
                  {UNIT_OPTIONS_WITH_FILE.map((option) => (
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
            {isConcentrationMode
              ? plotLayout === 'overlay'
                ? 'Overlay uses merged native timestamps from each selected file (no interpolation).'
                : 'Separate Tests keeps each concentration file on its native time vector (no interpolation).'
              : plotLayout === 'overlay'
                ? 'Overlay uses merged native timestamps from each selected file (no interpolation).'
                : 'Separate Tests keeps each file on its native time vector (no interpolation).'}
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
              <div className="text-muted-foreground">{limitTimeWindow ? 'Samples in window' : 'Samples in file'}</div>
              <div className="text-foreground font-semibold">{Number(summary.totalSamples ?? summary.sampleCount ?? plotData.length).toLocaleString()}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Displayed samples</div>
              <div className="text-foreground font-semibold">{Number(summary.plottedCount ?? plotData.length).toLocaleString()}</div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Mode</div>
              <div className="text-foreground font-semibold">
                {summary.reduction && summary.reduction !== 'none' ? 'Peaks kept (min/max)' : 'All samples'}
              </div>
            </div>
            <div className="bg-background/70 border border-border rounded-lg px-3 py-2 text-xs">
              <div className="text-muted-foreground">Sampling rate</div>
              <div className="text-foreground font-semibold">{formatSamplingRate(summary.samplingRateHz)}</div>
            </div>
          </div>

          {!!channels.length && !isConcentrationMode && (
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
                      value={channelUnitOverrides[channel.key] || FROM_FILE_UNIT}
                      onChange={(event) =>
                        setChannelUnitOverrides((prev) => ({
                          ...prev,
                          [channel.key]: event.target.value,
                        }))
                      }
                      className="bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                      title="Per-channel unit override"
                    >
                      {UNIT_OPTIONS_WITH_FILE.map((option) => (
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
                highlightRange={isConcentrationMode ? null : peakBand}
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
                    highlightRange={isConcentrationMode ? null : peakBand}
                  />
                </div>
              ))}
            </div>
          )}

          {!isConcentrationMode && !!selectedPath && convertedChannels.length > 0 && (
            <PeakTable
              key={selectedPath}
              apiBaseUrl={apiBaseUrl}
              projectPath={projectPath}
              filePath={selectedPath}
              channels={convertedChannels}
              unitTokenFor={sourceUnitToken}
              convertToKpa={convertToKpa}
              range={peakRange}
              onRangeChange={(next) => setPeakRangeByPath((prev) => ({ ...prev, [selectedPath]: next }))}
              included={peakIncluded}
              onIncludedChange={(key, value) => setPeakIncludedByPath((prev) => ({
                ...prev,
                [selectedPath]: { ...(prev[selectedPath] || {}), [key]: value },
              }))}
              plotWindow={limitTimeWindow ? { start: timeWindowStart, end: timeWindowEnd } : null}
            />
          )}

          {!!channels.length && !isConcentrationMode && (
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

export default RawDataScreeningCorePage;
