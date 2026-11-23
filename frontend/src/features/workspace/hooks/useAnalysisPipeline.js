import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_INPUT_UNIT, FROM_FILE_UNIT, normalizeUnitToken } from '../../../utils/units';

const SERIES_COLORS = [
  'hsl(200, 80%, 60%)',
  'hsl(20, 80%, 60%)',
  'hsl(120, 70%, 55%)',
  'hsl(280, 70%, 65%)',
  'hsl(40, 85%, 55%)',
  'hsl(160, 65%, 55%)',
  'hsl(320, 70%, 60%)',
  'hsl(90, 70%, 55%)',
  'hsl(0, 75%, 60%)',
  'hsl(240, 70%, 65%)',
  'hsl(300, 60%, 60%)',
  'hsl(60, 80%, 55%)',
];

export const useAnalysisPipeline = ({
  apiBaseUrl,
  projectPath,
  activeTab,
  selectedCases,
  experimentalData,
  experimentalFlameData = null,
  settings,
  formatName,
  stringToColor,
}) => {
  const [plotData, setPlotData] = useState([]);
  const [analysisResults, setAnalysisResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisNonce, setAnalysisNonce] = useState(0);
  const lastProcessedNonceRef = useRef(0);

  // EXDA-Check B8: if the file cannot be read, raise an error; never fall back
  // to previously loaded (possibly stale or decimated) content.
  const readAnalysisContent = useCallback(
    async (fileObj) => {
      if (!fileObj?.path) return fileObj?.content || '';
      const query = new URLSearchParams({
        path: fileObj.path,
        projectPath: projectPath || '',
        fullResolution: '1',
      });
      if (settings.analysisLimitTimeWindow) {
        const start = Number(settings.analysisWindowStart);
        const end = Number(settings.analysisWindowEnd);
        if (Number.isFinite(start)) query.set('windowStart', String(start));
        if (Number.isFinite(end)) query.set('windowEnd', String(end));
      }
      let res;
      let data = null;
      try {
        res = await fetch(`${apiBaseUrl}/read_project_file?${query.toString()}`);
        data = await res.json();
      } catch (err) {
        throw new Error(`Could not read ${fileObj.path}: ${err?.message || err}`);
      }
      if (res.ok && data?.success && typeof data.content === 'string') {
        return data.content;
      }
      throw new Error(`Could not read ${fileObj.path}: ${data?.error || `HTTP ${res.status}`}`);
    },
    [
      apiBaseUrl,
      projectPath,
      settings.analysisLimitTimeWindow,
      settings.analysisWindowEnd,
      settings.analysisWindowStart,
    ]
  );

  const processFile = useCallback(
    async (fileObj, type = 'pressure', options = {}) => {
      try {
        const useRawValue = typeof options.useRaw === 'boolean' ? options.useRaw : settings.useRaw;
        const cutoffValue = Number.isFinite(Number(options.cutoff)) ? Number(options.cutoff) : settings.cutoff;
        const orderValue = Number.isFinite(Number(options.order)) ? Number(options.order) : settings.order;
        const channelValue = Number.isFinite(Number(options.channelIndex))
          ? Math.max(0, Math.round(Number(options.channelIndex)))
          : Math.max(0, Math.round(Number(type === 'ewt' ? settings.ewtChannelIndex : settings.pressureChannelIndex) || 0));
        const includeVent = typeof options.includeVent === 'boolean' ? options.includeVent : true;
        if (type === 'ewt') {
          const normalizedEwtUnit = normalizeUnitToken(settings.ewtInputUnit);
          const res = await fetch(`${apiBaseUrl}/analyze_ewt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: fileObj.content,
              maxNumPeaks: settings.ewtMaxNumPeaks ?? settings.ewtNumModes ?? 5,
              maxPoints: settings.ewtMaxPoints,
              channelIndex: channelValue,
              pressureUnit: normalizedEwtUnit === 'auto' || !normalizedEwtUnit ? DEFAULT_INPUT_UNIT : normalizedEwtUnit,
              convertToKpa: settings.ewtConvertToKpa !== false,
            }),
          });
          const d = await res.json();
          if (d.error) throw new Error(d.error);
          const name = formatName(fileObj.path || fileObj.name);
          const colorSeed = fileObj.path || fileObj.name || name;
          return {
            name: fileObj.name,
            displayName: name,
            ewt: d,
            plotData: d.plot_data || [],
            energy: d.energy || [],
            summary: d.summary || {},
            warning: d.warning || null,
            color: stringToColor(colorSeed),
          };
        }
        // Pressure: files are analysed at full resolution on the backend
        // (EXDA-Check B1). Every setting is sent explicitly and echoed back
        // in result.processing.
        const pressureUnit = String(settings.pressureInputUnit || FROM_FILE_UNIT);
        const reference =
          options.pressureReference || settings.pressureReference || 'gauge';
        const baseline = options.baseline || null;
        const commonBody = {
          dataType: type,
          cutoff: cutoffValue,
          order: orderValue,
          useRaw: useRawValue,
          impulseDrop: settings.impulseDrop,
          channelIndex: channelValue,
          pressureUnit,
          convertToKpa: settings.pressureConvertToKpa !== false,
          pressureReference: reference,
          baseline,
        };
        if (settings.analysisLimitTimeWindow) {
          const start = Number(settings.analysisWindowStart);
          const end = Number(settings.analysisWindowEnd);
          if (String(settings.analysisWindowStart).trim() !== '' && Number.isFinite(start)) commonBody.windowStart = start;
          if (String(settings.analysisWindowEnd).trim() !== '' && Number.isFinite(end)) commonBody.windowEnd = end;
        }
        const pressureRequest = (fileObj.path && type === 'pressure'
          ? fetch(`${apiBaseUrl}/analyze_pressure_file`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...commonBody, projectPath: projectPath || '', path: fileObj.path }),
            })
          : fetch(`${apiBaseUrl}/analyze_pressure`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...commonBody, content: fileObj.content }),
            })
        ).then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok && !body.error) body.error = `HTTP ${res.status}`;
          return body;
        });
        const ventRequest =
          type === 'pressure' && includeVent && fileObj.ventContent
            ? fetch(`${apiBaseUrl}/analyze_vent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: fileObj.ventContent }),
              }).then((res) => res.json())
            : Promise.resolve(null);
        const [d, vData] = await Promise.all([pressureRequest, ventRequest]);
        if (d.error) throw new Error(d.error);
        const name = formatName(fileObj.path || fileObj.name);
        const colorSeed = fileObj.path || fileObj.name || name;
        if (type === 'flame_speed') {
          return { name: fileObj.name, displayName: name, plotData: d.plot_data, color: stringToColor(colorSeed) };
        }
        let ventTime = null;
        if (type === 'pressure' && includeVent && fileObj.ventContent) {
          if (vData.metrics && vData.metrics.tVent !== 'N/A') ventTime = parseFloat(vData.metrics.tVent);
        }
        return {
          name: fileObj.name,
          displayName: name,
          metrics: d.metrics,
          processing: d.processing || null,
          plotData: d.plot_data,
          color: stringToColor(colorSeed),
          ventTime,
        };
      } catch (err) {
        // Shown to the user as an error row; never silently dropped.
        const name = formatName(fileObj?.path || fileObj?.name || 'Series');
        return {
          name: fileObj?.name,
          displayName: name,
          error: err?.message || String(err),
          metrics: null,
          processing: null,
          plotData: [],
          color: stringToColor(fileObj?.path || fileObj?.name || name),
        };
      }
    },
    [apiBaseUrl, formatName, projectPath, settings, stringToColor]
  );

  const runAnalysis = useCallback(async () => {
    if (selectedCases.length === 0 && !experimentalData && !experimentalFlameData) {
      setPlotData([]);
      setAnalysisResults([]);
      return;
    }
    setIsProcessing(true);
    const res = [];
    if (activeTab === 'ewt') {
      const candidates = selectedCases.filter((c) => c && c.content && c.type !== 'flame');
      if (!settings.ewtSelectedPath) {
        setAnalysisResults([]);
        setPlotData([]);
        setIsProcessing(false);
        return;
      }
      const selected = candidates.find((c) => (c.path || c.name) === settings.ewtSelectedPath);
      if (selected) {
        try {
          const resolvedContent = await readAnalysisContent(selected);
          const r = await processFile({ ...selected, content: resolvedContent }, 'ewt');
          if (r) res.push(r);
        } catch (err) {
          res.push({ name: selected.name, displayName: formatName(selected.path || selected.name), error: err?.message || String(err), plotData: [] });
        }
      }
      setAnalysisResults(res);
      setPlotData(res[0]?.plotData || []);
      setIsProcessing(false);
      return;
    }
    if (activeTab === 'flame_speed') {
      const flameResults = await Promise.all(
        selectedCases.map(async (c) => {
          if (!c.toaContent) return null;
          return processFile({ name: c.name, path: c.path, content: c.toaContent }, 'flame_speed');
        })
      );
      res.push(...flameResults.filter(Boolean));
    } else if (['pressure_analysis', 'cfd_validation'].includes(activeTab)) {
      const isExperimentsOnlyPressure = activeTab === 'pressure_analysis';
      const pressureCases = selectedCases.filter((c) => {
        if (c.type === 'flame') return false;
        if (isExperimentsOnlyPressure && c.type !== 'pressure') return false;
        return true;
      });
      const pressureResults = await Promise.all(
        pressureCases.map(async (c) => {
          const isExperimentalPressure = c.type === 'pressure';
          const experimentalUseRaw =
            typeof settings.experimentalUseRaw === 'boolean' ? settings.experimentalUseRaw : settings.useRaw;
          const useRawForCase = isExperimentalPressure ? experimentalUseRaw : settings.useRaw;
          const experimentalCutoff = Number.isFinite(Number(settings.experimentalCutoff))
            ? Number(settings.experimentalCutoff)
            : settings.cutoff;
          const experimentalOrder = Number.isFinite(Number(settings.experimentalOrder))
            ? Number(settings.experimentalOrder)
            : settings.order;
          const cutoffForCase = isExperimentalPressure ? experimentalCutoff : settings.cutoff;
          const orderForCase = isExperimentalPressure ? experimentalOrder : settings.order;
          const shouldIncludeRawReference = Boolean(settings.showRawReference) && !useRawForCase;
          const includeVentForCase = activeTab === 'cfd_validation';
          const sourceCase = c;
          const referenceForCase = isExperimentalPressure
            ? settings.pressureReference || 'gauge'
            : settings.simulationPressureReference || 'gauge';
          const baselineForCase = isExperimentalPressure && settings.baselineEnabled
            ? {
                enabled: true,
                method: settings.baselineMethod || 'mean',
                start: settings.baselineStart,
                end: settings.baselineEnd,
              }
            : null;
          const primaryPromise = processFile(sourceCase, 'pressure', {
            useRaw: useRawForCase,
            cutoff: cutoffForCase,
            order: orderForCase,
            includeVent: includeVentForCase,
            pressureReference: referenceForCase,
            baseline: baselineForCase,
          });
          const rawRefPromise = shouldIncludeRawReference
            ? processFile(sourceCase, 'pressure', {
                useRaw: true,
                cutoff: cutoffForCase,
                order: orderForCase,
                includeVent: false,
                pressureReference: referenceForCase,
                baseline: baselineForCase,
              })
            : Promise.resolve(null);
          const [r, rawRef] = await Promise.all([primaryPromise, rawRefPromise]);
          if (!r) return null;
          if (r.error) return { ...r, sourceType: isExperimentalPressure ? 'experiment' : 'simulation', rawOverlayPlotData: null };
          return {
            ...r,
            sourceType: isExperimentalPressure ? 'experiment' : 'simulation',
            rawOverlayPlotData: rawRef?.plotData || null,
          };
        })
      );
      res.push(...pressureResults.filter(Boolean));
    }
    const seenNames = new Map();
    const uniqueResults = res.map((item, idx) => {
      const base = item.displayName || item.name || 'Series';
      const count = seenNames.get(base) || 0;
      seenNames.set(base, count + 1);
      const displayName = count === 0 ? base : `${base} (${count + 1})`;
      return {
        ...item,
        displayName,
        color: SERIES_COLORS[idx % SERIES_COLORS.length],
        rawOverlayDisplayName:
          Array.isArray(item.rawOverlayPlotData) && item.rawOverlayPlotData.length > 0
            ? `${displayName} (raw ref)`
            : null,
      };
    });
    setAnalysisResults(uniqueResults);
    try {
      const aggregateRes = await fetch(`${apiBaseUrl}/aggregate_plot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeTab,
          preserveNativeTime: ['pressure_analysis', 'cfd_validation'].includes(activeTab),
          series: uniqueResults.filter((item) => !item.error).flatMap((item) => {
            const primary = [
              {
                displayName: item.displayName,
                plotData: item.plotData,
              },
            ];
            if (item.rawOverlayDisplayName && Array.isArray(item.rawOverlayPlotData)) {
              primary.push({
                displayName: item.rawOverlayDisplayName,
                plotData: item.rawOverlayPlotData,
              });
            }
            return primary;
          }),
          experimental: (() => {
            if (activeTab === 'flame_speed') {
              const flame = Array.isArray(experimentalData)
                ? experimentalData.find((d) => d.type === 'flame')
                : null;
              return flame ? flame.plotData : null;
            }
            return null;
          })(),
        }),
      });
      const aggregateData = await aggregateRes.json();
      setPlotData(aggregateData.plotData || []);
    } catch {
      setPlotData([]);
    }
    setIsProcessing(false);
  }, [activeTab, apiBaseUrl, experimentalData, experimentalFlameData, formatName, processFile, readAnalysisContent, selectedCases, settings]);

  const requestAnalysis = useCallback(() => {
    setAnalysisNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (activeTab !== 'ewt') return;
    if (!settings.ewtSelectedPath) {
      setPlotData([]);
      setAnalysisResults([]);
      return;
    }
    const t = setTimeout(runAnalysis, 300);
    return () => clearTimeout(t);
  }, [activeTab, runAnalysis, settings.ewtMaxPoints, settings.ewtMaxNumPeaks, settings.ewtNumModes, settings.ewtSelectedPath]);
  

  useEffect(() => {
    if (activeTab === 'ewt') return;
    if (analysisNonce === 0) return;
    if (analysisNonce === lastProcessedNonceRef.current) return;
    lastProcessedNonceRef.current = analysisNonce;
    const t = setTimeout(runAnalysis, 300);
    return () => clearTimeout(t);
  }, [activeTab, analysisNonce, runAnalysis]);

  return {
    plotData,
    setPlotData,
    analysisResults,
    setAnalysisResults,
    isProcessing,
    processFile,
    requestAnalysis,
  };
};
