import { useCallback, useEffect, useRef, useState } from 'react';

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

  const processFile = useCallback(
    async (fileObj, type = 'pressure', options = {}) => {
      try {
        const useRawValue = typeof options.useRaw === 'boolean' ? options.useRaw : settings.useRaw;
        const cutoffValue = Number.isFinite(Number(options.cutoff)) ? Number(options.cutoff) : settings.cutoff;
        const orderValue = Number.isFinite(Number(options.order)) ? Number(options.order) : settings.order;
        if (type === 'ewt') {
          const res = await fetch(`${apiBaseUrl}/analyze_ewt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: fileObj.content,
              numModes: settings.ewtNumModes,
              maxPoints: settings.ewtMaxPoints,
              kneeModes: 10,
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
        const res = await fetch(`${apiBaseUrl}/analyze_pressure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: fileObj.content,
            dataType: type,
            cutoff: cutoffValue,
            order: orderValue,
            useRaw: useRawValue,
            impulseDrop: settings.impulseDrop,
          }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        const name = formatName(fileObj.path || fileObj.name);
        const colorSeed = fileObj.path || fileObj.name || name;
        if (type === 'flame_speed') {
          return { name: fileObj.name, displayName: name, plotData: d.plot_data, color: stringToColor(colorSeed) };
        }
        let ventTime = null;
        if (type === 'pressure' && fileObj.ventContent) {
          const vRes = await fetch(`${apiBaseUrl}/analyze_vent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: fileObj.ventContent }),
          });
          const vData = await vRes.json();
          if (vData.metrics && vData.metrics.tVent !== 'N/A') ventTime = parseFloat(vData.metrics.tVent);
        }
        return {
          name: fileObj.name,
          displayName: name,
          metrics: d.metrics,
          plotData: d.plot_data,
          color: stringToColor(colorSeed),
          ventTime,
        };
      } catch {
        return null;
      }
    },
    [apiBaseUrl, formatName, settings, stringToColor]
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
        const r = await processFile(selected, 'ewt');
        if (r) res.push(r);
      }
      setAnalysisResults(res);
      setPlotData(res[0]?.plotData || []);
      setIsProcessing(false);
      return;
    }
    for (const c of selectedCases) {
      if (activeTab === 'flame_speed' && c.toaContent) {
        const r = await processFile({ name: c.name, path: c.path, content: c.toaContent }, 'flame_speed');
        if (r) res.push(r);
      } else if (['pressure_analysis', 'cfd_validation'].includes(activeTab)) {
        const isExperimentsOnlyPressure = activeTab === 'pressure_analysis';
        if (c.type === 'flame') {
          continue;
        }
        if (isExperimentsOnlyPressure && c.type !== 'pressure') {
          continue;
        }
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
        const r = await processFile(c, 'pressure', {
          useRaw: useRawForCase,
          cutoff: cutoffForCase,
          order: orderForCase,
        });
        if (r) {
          let rawOverlayPlotData = null;
          if (shouldIncludeRawReference) {
            const rawRef = await processFile(c, 'pressure', {
              useRaw: true,
              cutoff: cutoffForCase,
              order: orderForCase,
            });
            rawOverlayPlotData = rawRef?.plotData || null;
          }
          res.push({
            ...r,
            sourceType: isExperimentalPressure ? 'experiment' : 'simulation',
            rawOverlayPlotData,
          });
        }
      }
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
          series: uniqueResults.flatMap((item) => {
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
  }, [activeTab, apiBaseUrl, experimentalData, experimentalFlameData, processFile, selectedCases, settings]);

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
  }, [activeTab, runAnalysis, settings.ewtMaxPoints, settings.ewtNumModes, settings.ewtSelectedPath]);

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
