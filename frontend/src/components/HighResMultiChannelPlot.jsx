import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const formatXTick = (v) => Number(v).toExponential(2);
const formatYTick = (v) => Number(v).toFixed(3);

const HighResMultiChannelPlot = ({ plotData = [], channels = [], height = 440, colors = FALLBACK_COLORS }) => {
  const mountRef = useRef(null);
  const chartRef = useRef(null);
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
      { label: 't (s)' },
      ...channels.map((channel, idx) => ({
        label: channel.label || `Channel ${channel.index + 1}`,
        stroke: colors[idx % colors.length],
        width: 1.2,
      })),
    ];

    const options = {
      width,
      height,
      series,
      scales: {
        x: { auto: false, range: [xMin, xMax] },
        y: { auto: true },
      },
      axes: [
        {
          label: 'Time (s)',
          stroke: '#94a3b8',
          grid: { stroke: 'rgba(148,163,184,0.18)' },
          values: (_u, vals) => vals.map(formatXTick),
        },
        {
          stroke: '#94a3b8',
          grid: { stroke: 'rgba(148,163,184,0.14)' },
          values: (_u, vals) => vals.map(formatYTick),
        },
      ],
      cursor: {
        drag: {
          x: true,
          y: false,
          setScale: true,
        },
      },
      legend: {
        show: true,
        live: true,
      },
    };

    const chart = new uPlot(options, dataSeries, mountRef.current);
    chartRef.current = chart;

    const onDoubleClick = () => {
      chart.setScale('x', { min: xMin, max: xMax });
    };
    chart.root.addEventListener('dblclick', onDoubleClick);

    return () => {
      chart.root.removeEventListener('dblclick', onDoubleClick);
      chart.destroy();
      chartRef.current = null;
    };
  }, [channels, colors, dataSeries, height, width, xValues]);

  return (
    <div className="w-full" style={{ height: `${height}px` }}>
      <div ref={mountRef} className="w-full h-full" />
    </div>
  );
};

export default HighResMultiChannelPlot;
