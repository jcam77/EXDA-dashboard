import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const FALLBACK_COLORS = [
  '#38bdf8',
  '#f97316',
  '#22c55e',
  '#a78bfa',
  '#f59e0b',
  '#14b8a6',
  '#f43f5e',
  '#84cc16',
];

const formatXTick = (v) => {
  const num = Number(v);
  if (!Number.isFinite(num)) return '';
  const abs = Math.abs(num);
  if (abs === 0) return '0';
  const exp = Math.floor(Math.log10(abs) / 3) * 3;
  const scaled = num / (10 ** exp);
  return `${scaled.toFixed(1)}e${exp >= 0 ? '+' : ''}${exp}`;
};
const formatYTick = (v) => {
  const num = Number(v);
  if (!Number.isFinite(num)) return '';
  const abs = Math.abs(num);
  if (abs === 0) return '0';

  // Use engineering notation for very small/large values to avoid "0.0" collapse.
  if (abs < 0.1 || abs >= 10000) {
    const exp = Math.floor(Math.log10(abs) / 3) * 3;
    const scaled = num / (10 ** exp);
    return `${scaled.toFixed(1)}e${exp >= 0 ? '+' : ''}${exp}`;
  }

  return num.toFixed(1);
};
const normalizeUnit = (value) => String(value || '').trim().toLowerCase();
const isVoltageChannel = (channel) => {
  const unit = normalizeUnit(channel?.unit);
  const role = normalizeUnit(channel?.role);
  return unit === 'v' || unit === 'volt' || unit === 'voltage' || role === 'trigger';
};

const HighResMultiChannelPlot = ({
  plotData = [],
  channels = [],
  height = 440,
  colors = FALLBACK_COLORS,
  showLegend = true,
  showResetButton = true,
}) => {
  const mountRef = useRef(null);
  const chartRef = useRef(null);
  const initialScalesRef = useRef(null);
  const resizeRef = useRef(null);
  const [width, setWidth] = useState(800);

  const xValues = useMemo(() => plotData.map((row) => Number(row.t)), [plotData]);
  const dataSeries = useMemo(() => {
    const base = [xValues];
    channels.forEach((channel) => {
      base.push(
        plotData.map((row) => {
          const raw = row?.[channel.key];
          if (raw === null || raw === undefined || raw === '') return null;
          const numeric = Number(raw);
          return Number.isFinite(numeric) ? numeric : null;
        })
      );
    });
    return base;
  }, [channels, plotData, xValues]);
  const hasVoltage = useMemo(() => channels.some((channel) => isVoltageChannel(channel)), [channels]);
  const hasNonVoltage = useMemo(() => channels.some((channel) => !isVoltageChannel(channel)), [channels]);
  const useDualAxis = hasVoltage && hasNonVoltage;
  const primaryLabel = useMemo(() => {
    const first = channels.find((channel) => !isVoltageChannel(channel)) || channels[0];
    if (!first) return 'Signal';
    return first.unit && first.unit !== 'raw' ? `Signal (${first.unit})` : 'Signal';
  }, [channels]);
  const secondaryLabel = useMemo(() => {
    const first = channels.find((channel) => isVoltageChannel(channel));
    if (!first) return 'Voltage (V)';
    return first.unit && first.unit !== 'raw' ? `Voltage (${first.unit})` : 'Voltage (V)';
  }, [channels]);

  const handleResetZoom = useCallback(() => {
    const chart = chartRef.current;
    const initial = initialScalesRef.current;
    if (!chart || !initial) return;
    chart.setScale('x', { min: initial.x.min, max: initial.x.max });
    chart.setScale('y', { min: initial.y.min, max: initial.y.max });
    if (initial.y2 && chart.scales?.y2) {
      chart.setScale('y2', { min: initial.y2.min, max: initial.y2.max });
    }
  }, []);

  const clampXRange = useCallback((min, max, hardMin, hardMax) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(hardMin) || !Number.isFinite(hardMax)) {
      return { min, max };
    }
    const span = max - min;
    if (!(span > 0)) return { min, max };
    if (span >= (hardMax - hardMin)) {
      return { min: hardMin, max: hardMax };
    }
    let nextMin = min;
    let nextMax = max;
    if (nextMin < hardMin) {
      const delta = hardMin - nextMin;
      nextMin += delta;
      nextMax += delta;
    }
    if (nextMax > hardMax) {
      const delta = nextMax - hardMax;
      nextMin -= delta;
      nextMax -= delta;
    }
    return { min: nextMin, max: nextMax };
  }, []);

  useEffect(() => {
    if (!mountRef.current) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries?.[0]?.contentRect?.width || 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(mountRef.current);
    resizeRef.current = observer;
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mountRef.current || !xValues.length || width <= 0) return undefined;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const xMin = xValues[0];
    const xMax = xValues[xValues.length - 1];

    const series = [
      {
        label: 't (s)',
        value: (_u, v) => (Number.isFinite(Number(v)) ? Number(v).toExponential(4) : ''),
      },
      ...channels.map((channel, idx) => ({
        label: `${channel.label || `Channel ${channel.index + 1}`}${channel.unit && channel.unit !== 'raw' ? ` (${channel.unit})` : ''}`,
        stroke: colors[idx % colors.length],
        width: 1.2,
        scale: useDualAxis && isVoltageChannel(channel) ? 'y2' : 'y',
        value: (_u, v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(5) : ''),
      })),
    ];

    const options = {
      width,
      height,
      series,
      scales: {
        x: { auto: true, time: false },
        y: { auto: true },
        ...(useDualAxis ? { y2: { auto: true } } : {}),
      },
      axes: [
        {
          label: 'Time (s)',
          size: 52,
          stroke: '#94a3b8',
          grid: { stroke: 'rgba(148,163,184,0.18)' },
          values: (_u, vals) => vals.map(formatXTick),
        },
        {
          label: primaryLabel,
          size: 78,
          stroke: '#94a3b8',
          grid: { stroke: 'rgba(148,163,184,0.14)' },
          values: (_u, vals) => vals.map(formatYTick),
        },
        ...(useDualAxis
          ? [
              {
                scale: 'y2',
                side: 1,
                label: secondaryLabel,
                size: 78,
                stroke: '#94a3b8',
                grid: { show: false },
                values: (_u, vals) => vals.map(formatYTick),
              },
            ]
          : []),
      ],
      cursor: {
        drag: {
          x: true,
          y: true,
          setScale: true,
        },
      },
      legend: {
        show: showLegend,
        live: true,
      },
    };

    const chart = new uPlot(options, dataSeries, mountRef.current);
    chartRef.current = chart;
    initialScalesRef.current = {
      x: { min: xMin, max: xMax },
      y: { min: chart.scales.y.min, max: chart.scales.y.max },
      y2: useDualAxis ? { min: chart.scales.y2?.min, max: chart.scales.y2?.max } : null,
    };
    chart.root.style.position = 'relative';
    const legendEl = chart.root.querySelector('.u-legend');
    if (legendEl) {
      legendEl.style.position = 'absolute';
      legendEl.style.left = 'auto';
      legendEl.style.top = '4px';
      legendEl.style.right = '4px';
      legendEl.style.bottom = 'auto';
      legendEl.style.zIndex = '5';
    }
    const selectEl = chart.root.querySelector('.u-select');
    if (selectEl) {
      selectEl.style.border = '1px dashed rgba(148, 163, 184, 0.9)';
      selectEl.style.background = 'rgba(56, 189, 248, 0.12)';
    }

    const onDoubleClick = () => handleResetZoom();
    chart.root.addEventListener('dblclick', onDoubleClick);

    // Pan interaction: hold Alt and left-drag horizontally to move the current zoom window.
    // This avoids conflict with normal drag-to-zoom.
    const panState = {
      active: false,
      startClientX: 0,
      startMin: null,
      startMax: null,
    };

    const onPanMove = (event) => {
      if (!panState.active) return;
      const plotWidthPx = chart.bbox?.width || 0;
      const startMin = Number(panState.startMin);
      const startMax = Number(panState.startMax);
      if (!(plotWidthPx > 0) || !Number.isFinite(startMin) || !Number.isFinite(startMax)) return;
      const span = startMax - startMin;
      if (!(span > 0)) return;
      const dxPx = Number(event.clientX) - Number(panState.startClientX);
      const deltaX = (dxPx / plotWidthPx) * span;
      const hardMin = xMin;
      const hardMax = xMax;
      const desiredMin = startMin - deltaX;
      const desiredMax = startMax - deltaX;
      const next = clampXRange(desiredMin, desiredMax, hardMin, hardMax);
      chart.setScale('x', { min: next.min, max: next.max });
    };

    const endPan = () => {
      if (!panState.active) return;
      panState.active = false;
      if (chart?.root) chart.root.style.cursor = '';
      window.removeEventListener('mousemove', onPanMove);
      window.removeEventListener('mouseup', endPan);
    };

    const onPanStart = (event) => {
      // Pan mode:
      // - Shift + left drag (cross-platform friendly)
      // - Middle mouse drag
      // - Alt + left drag (kept as fallback where OS doesn't capture Alt)
      const isLeftWithModifier = event.button === 0 && (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey);
      const isMiddleMouse = event.button === 1;
      if (!(isLeftWithModifier || isMiddleMouse)) return;
      event.preventDefault();
      const currentMin = chart.scales?.x?.min;
      const currentMax = chart.scales?.x?.max;
      if (!Number.isFinite(currentMin) || !Number.isFinite(currentMax)) return;
      panState.active = true;
      panState.startClientX = Number(event.clientX);
      panState.startMin = Number(currentMin);
      panState.startMax = Number(currentMax);
      chart.root.style.cursor = 'grabbing';
      window.addEventListener('mousemove', onPanMove);
      window.addEventListener('mouseup', endPan);
    };

    chart.over?.addEventListener('mousedown', onPanStart);

    return () => {
      chart.root.removeEventListener('dblclick', onDoubleClick);
      chart.over?.removeEventListener('mousedown', onPanStart);
      endPan();
      chart.destroy();
      chartRef.current = null;
    };
  }, [channels, clampXRange, colors, dataSeries, handleResetZoom, height, primaryLabel, secondaryLabel, showLegend, useDualAxis, width, xValues]);

  return (
    <div className="w-full relative" style={{ height: `${height}px` }}>
      {showResetButton && (
        <div className="absolute left-2 top-2 z-[6] flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetZoom}
            className="rounded border border-border bg-background/80 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition"
          >
            Reset Zoom
          </button>
          <span className="rounded border border-border bg-background/70 px-2 py-1 text-[10px] text-muted-foreground">
            Shift + Drag to Pan
          </span>
        </div>
      )}
      <div ref={mountRef} className="w-full h-full" />
    </div>
  );
};

export default HighResMultiChannelPlot;
