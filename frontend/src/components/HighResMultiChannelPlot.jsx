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
      base.push(plotData.map((row) => Number(row[channel.key])));
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

    return () => {
      chart.root.removeEventListener('dblclick', onDoubleClick);
      chart.destroy();
      chartRef.current = null;
    };
  }, [channels, colors, dataSeries, handleResetZoom, height, primaryLabel, secondaryLabel, showLegend, useDualAxis, width, xValues]);

  return (
    <div className="w-full relative" style={{ height: `${height}px` }}>
      {showResetButton && (
        <button
          type="button"
          onClick={handleResetZoom}
          className="absolute left-2 top-2 z-[6] rounded border border-border bg-background/80 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition"
        >
          Reset Zoom
        </button>
      )}
      <div ref={mountRef} className="w-full h-full" />
    </div>
  );
};

export default HighResMultiChannelPlot;
