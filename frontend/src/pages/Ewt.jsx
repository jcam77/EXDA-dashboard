import React, { useEffect, useMemo, useState } from 'react';
import { AudioLines, Sliders, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';

const Ewt = ({
    plotData = [],
    analysisResults = [],
    isProcessing = false,
    settings,
    setSettings,
    selectedCases = [],
    formatName = (n) => n
}) => {
    const candidates = useMemo(
        () => selectedCases.filter(c => c && c.content && c.type !== 'flame'),
        [selectedCases]
    );

    const selectedPath = settings?.ewtSelectedPath || '';
    const [localTickCount, setLocalTickCount] = useState(settings.ewtTickCount || 10);
    const [localYTickCount, setLocalYTickCount] = useState(10);

    useEffect(() => {
        if (!selectedPath) return;
        const exists = candidates.some(c => (c.path || c.name) === selectedPath);
        if (!exists) {
            setSettings(prev => ({ ...prev, ewtSelectedPath: '' }));
        }
    }, [candidates, selectedPath, setSettings]);

    const activeResult = analysisResults[0] || {};
    const energy = activeResult.energy || [];
    const summary = activeResult.summary || {};
    const suggestedFilter = summary.suggestedFilter;
    const warning = activeResult.warning;

    const modeKeys = useMemo(() => {
        if (!plotData || plotData.length === 0) return [];
        return Object.keys(plotData[0]).filter((key) => key.startsWith('mode_'));
    }, [plotData]);

    const modeColors = ['hsl(var(--primary))'];

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

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between bg-card/60 border border-border rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-bold">
                    <AudioLines size={16} className="text-primary" />
                    Empirical Wavelet Transform
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Single pressure file analysis
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-card/60 border border-border rounded-xl p-4 flex flex-col max-w-[900px] w-full mx-auto lg:mx-0">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-foreground">Signal + EWT Modes</h3>
                        {isProcessing && (
                            <span className="text-[10px] uppercase tracking-widest text-primary animate-pulse">Processing...</span>
                        )}
                    </div>
                    <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                        <div className="rounded-lg border border-border/60 bg-black/20 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Samples</div>
                            <div className="text-sm font-bold text-foreground">{summary.samples || '--'}</div>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-black/20 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Sampling Rate</div>
                            <div className="text-sm font-bold text-foreground">{summary.fs ? `${summary.fs.toFixed(2)} Hz` : '--'}</div>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-black/20 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Libraries</div>
                            <div className="text-xs text-muted-foreground">
                                EWT {summary.usesEWT ? 'ON' : 'OFF'} | PyWT {summary.usesPyWT ? 'ON' : 'OFF'}
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 min-h-[280px]">
                        {plotData.length > 0 ? (
                            <div className="space-y-4 max-w-[760px] w-full mx-auto">
                                {[
                                    { key: 'raw', label: 'Raw Signal', color: 'hsl(var(--destructive))' },
                                    ...modeKeys.map((key, idx) => ({
                                        key,
                                        label: `Mode ${key.replace('mode_', '')}`,
                                        color: modeColors[idx % modeColors.length],
                                    })),
                                ].map((series, idx) => (
                                    <div key={series.key} className="bg-black/20 border border-border/60 rounded-xl p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                                            {series.label}
                                        </div>
                                        <div className="h-40 max-w-[720px] mx-auto">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={chartData}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                                    <XAxis
                                                        dataKey="time"
                                                        type="number"
                                                        stroke="hsl(var(--muted-foreground))"
                                                        fontSize={10}
                                                        tickFormatter={formatTimeTick}
                                                        tickCount={localTickCount || 10}
                                                        domain={[0, 'dataMax']}
                                                        allowDataOverflow
                                                        label={{
                                                            value: 'Time (s)',
                                                            position: 'insideBottom',
                                                            offset: -5,
                                                            fill: 'hsl(var(--muted-foreground))',
                                                            fontSize: 9,
                                                        }}
                                                    />
                                                    <YAxis
                                                        stroke="hsl(var(--muted-foreground))"
                                                        fontSize={10}
                                                        tickCount={localYTickCount || 10}
                                                        label={{
                                                            value: idx === 0 ? 'Pressure (kPa)' : `${series.label} (kPa)`,
                                                            angle: -90,
                                                            position: 'insideLeft',
                                                            fill: 'hsl(var(--muted-foreground))',
                                                            fontSize: 9,
                                                        }}
                                                    />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: '11px' }}
                                                        labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                                                    />
                                                    <Line
                                                        type="monotone"
                                                        dataKey={series.key}
                                                        stroke={series.color}
                                                        dot={false}
                                                        strokeWidth={2}
                                                    />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                                Select a pressure file to run EWT.
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="bg-card/60 border border-border rounded-xl p-4">
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                            <Sliders size={12} className="text-primary" />
                            Settings
                        </div>
                        <div className="mt-3 space-y-3">
                            <div>
                                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Pressure File</label>
                                <select
                                    value={selectedPath}
                                    onChange={(e) => setSettings(prev => ({ ...prev, ewtSelectedPath: e.target.value }))}
                                    className="mt-1 w-full bg-background border border-border rounded-md px-2 py-2 text-xs text-foreground outline-none"
                                >
                                    <option value="">Select file...</option>
                                    {candidates.map((c) => {
                                        const id = c.path || c.name;
                                        return (
                                            <option key={id} value={id}>
                                                {formatName(id)}
                                            </option>
                                        );
                                    })}
                                </select>
                                <p className="mt-1 text-[10px] text-muted-foreground">Assumes column 1 = time, column 2 = pressure.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Num Modes</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="10"
                                        value={settings.ewtNumModes}
                                        onChange={(e) => {
                                            const raw = Number(e.target.value || 1);
                                            const next = Math.max(1, Math.min(10, raw));
                                            setSettings(prev => ({ ...prev, ewtNumModes: next }));
                                        }}
                                        className="mt-1 w-full bg-background border border-border rounded-md px-2 py-2 text-xs text-foreground outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">X Ticks</label>
                                    <input
                                        type="number"
                                        min="3"
                                        max="20"
                                        value={localTickCount}
                                        onChange={(e) => {
                                            const raw = Number(e.target.value || 10);
                                            const next = Math.max(3, Math.min(20, Math.round(raw)));
                                            setLocalTickCount(next);
                                        }}
                                        className="mt-1 w-full bg-background border border-border rounded-md px-2 py-2 text-xs text-foreground outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Y Ticks</label>
                                    <input
                                        type="number"
                                        min="3"
                                        max="20"
                                        value={localYTickCount}
                                        onChange={(e) => {
                                            const raw = Number(e.target.value || 10);
                                            const next = Math.max(3, Math.min(20, Math.round(raw)));
                                            setLocalYTickCount(next);
                                        }}
                                        className="mt-1 w-full bg-background border border-border rounded-md px-2 py-2 text-xs text-foreground outline-none"
                                    />
                                </div>
                                <div className="flex flex-col justify-end">
                                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Max Points</div>
                                    <div className="text-xs text-foreground mt-1">{settings.ewtMaxPoints}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {warning && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-300">
                            <AlertTriangle size={12} className="mt-0.5" />
                            <span>{warning}</span>
                        </div>
                    )}

                    <div className="bg-card/60 border border-border rounded-xl p-4">
                        <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Mode Energy (%)</h4>
                        {energy.length > 0 ? (
                            <div className="h-[180px] max-w-[360px] mx-auto">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={energy}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                        <XAxis
                                            dataKey="mode"
                                            stroke="hsl(var(--muted-foreground))"
                                            fontSize={10}
                                            label={{
                                                value: 'Mode',
                                                position: 'insideBottom',
                                                offset: -4,
                                                fill: 'hsl(var(--muted-foreground))',
                                                fontSize: 9,
                                            }}
                                        />
                                        <YAxis
                                            stroke="hsl(var(--muted-foreground))"
                                            fontSize={10}
                                            tickCount={localYTickCount || 10}
                                            label={{
                                                value: 'Energy (%)',
                                                angle: -90,
                                                position: 'insideLeft',
                                                fill: 'hsl(var(--muted-foreground))',
                                                fontSize: 9,
                                            }}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: '11px' }}
                                            labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                                            formatter={(value) => `${Number(value).toFixed(2)}%`}
                                        />
                                        <Bar dataKey="pct" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="text-xs text-muted-foreground">No energy data yet.</div>
                        )}
                    </div>

                    {suggestedFilter && (
                        <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
                            <div className="text-[10px] uppercase tracking-widest text-primary font-bold">Suggested Low-Pass Filter</div>
                            <div className="mt-1 text-sm font-bold text-foreground">
                                {suggestedFilter.cutoffHz} Hz cutoff
                            </div>
                            <div className="mt-1 text-[10px] text-muted-foreground">
                                {suggestedFilter.basis}
                            </div>
                            <div className="mt-1 text-[10px] text-muted-foreground">
                                {suggestedFilter.note}
                            </div>
                        </div>
                    )}

                    <div className="rounded-xl border border-border/60 bg-black/20 p-4">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                            Mode Summary
                        </div>
                        {energy.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="text-[10px] text-muted-foreground uppercase border-b border-border">
                                            <th className="pb-2">Mode</th>
                                            <th className="pb-2">Energy %</th>
                                            <th className="pb-2">Peak Freq (Hz)</th>
                                            <th className="pb-2">Interpretation</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {energy.map((row) => (
                                            <tr key={row.mode} className="border-b border-border/50">
                                                <td className="py-2 font-mono">{row.mode}</td>
                                                <td className="py-2">{Number(row.pct).toFixed(2)}%</td>
                                                <td className="py-2">{row.peakHz ? row.peakHz.toFixed(1) : '--'}</td>
                                                <td className="py-2 text-muted-foreground">{row.guess}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-xs text-muted-foreground">No mode summary yet.</div>
                        )}
                    </div>
                </div>
            </div>

            
        </div>
    );
};

export default Ewt;
