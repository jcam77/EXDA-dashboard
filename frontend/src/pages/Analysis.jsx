import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Info, AlertTriangle, Download, Settings, Activity, Flame, Zap } from 'lucide-react';

const AnalysisPage = ({ 
    activeTab, 
    plotData, 
    analysisResults, 
    experimentalData, 
    isProcessing,
    settings,
    setSettings
}) => {

    const exportToCSV = () => {
        if (!plotData || plotData.length === 0) return;
        const headers = Object.keys(plotData[0]).join(",");
        const rows = plotData.map(row => Object.values(row).join(",")).join("\n");
        const blob = new Blob([headers + "\n" + rows], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analysis_export_${activeTab}.csv`;
        a.click();
    };

    return (
        <div className="flex flex-col h-full gap-4">
            
            {/* 1. CONTROLS HEADER */}
            <div className="flex justify-between items-center bg-card/60 p-4 rounded-xl border border-border">
                <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                        <label className="text-[10px] text-muted-foreground uppercase font-bold">Cutoff (Hz)</label>
                        <input type="number" value={settings.cutoff} onChange={e=>setSettings({...settings, cutoff:e.target.value})} className="bg-background border border-border rounded px-2 py-1 text-xs w-20 text-foreground"/>
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[10px] text-muted-foreground uppercase font-bold">Impulse Drop</label>
                        <input type="number" value={settings.impulseDrop} onChange={e=>setSettings({...settings, impulseDrop:e.target.value})} className="bg-background border border-border rounded px-2 py-1 text-xs w-20 text-foreground"/>
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                        <input type="checkbox" checked={settings.useRaw} onChange={e=>setSettings({...settings, useRaw:e.target.checked})} className="rounded bg-muted border-border"/>
                        <span className="text-xs text-muted-foreground">Use Raw Data (No Filter)</span>
                    </div>
                </div>
                <div>
                    {plotData.length > 0 && (
                        <button onClick={exportToCSV} className="flex items-center gap-2 bg-muted hover:bg-muted/80 text-foreground px-3 py-2 rounded text-xs font-bold border border-border">
                            <Download size={14}/> Export CSV
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                
                {/* 2. CHART SECTION */}
                <div className="lg:col-span-2 bg-card/60 border border-border p-4 rounded-xl flex flex-col">
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                            {activeTab === 'flame_speed' ? <Flame className="text-orange-500" size={16}/> : <Activity className="text-red-500" size={16}/>}
                            {activeTab === 'flame_speed' ? 'Flame Speed vs Position' : 'Pressure vs Time'}
                        </h3>
                        {/* DISCLAIMER: TRANSPARENCY ABOUT INTERPOLATION */}
                        {plotData.length > 0 && (
                            <div className="flex items-start gap-2 bg-yellow-900/10 border border-yellow-900/30 p-2 rounded max-w-md">
                                <Info size={14} className="text-yellow-500 mt-0.5 shrink-0"/>
                                <p className="text-[10px] text-yellow-500/80 leading-tight">
                                    <strong>Visualization Note:</strong> Data has been linearly interpolated to a common grid for comparison. 
                                    Exact peak values calculated from raw physics data are shown in the table.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-h-0 relative">
                        {isProcessing ? (
                            <div className="absolute inset-0 flex items-center justify-center text-emerald-500 animate-pulse font-mono text-sm">
                                Processing Physics Data...
                            </div>
                        ) : plotData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={plotData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                    <XAxis 
                                        dataKey={activeTab === 'flame_speed' ? 'x' : 'time'} 
                                        stroke="hsl(var(--muted-foreground))" 
                                        fontSize={12} 
                                        tickFormatter={val => val.toFixed(activeTab === 'flame_speed' ? 2 : 3)}
                                        label={{ value: activeTab === 'flame_speed' ? 'Position (m)' : 'Time (s)', position: 'insideBottom', offset: -5, fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                                    />
                                    <YAxis 
                                        stroke="hsl(var(--muted-foreground))" 
                                        fontSize={12}
                                        label={{ value: activeTab === 'flame_speed' ? 'Speed (m/s)' : 'Pressure (bar)', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '4px' }}
                                        labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '0.5rem' }}
                                        itemStyle={{ fontSize: '12px', padding: 0 }}
                                        formatter={(val) => val !== null ? val.toFixed(3) : "No Data"}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}/>
                                    
                                    {/* DYNAMIC LINES */}
                                    {analysisResults.map((result, i) => (
                                        <Line 
                                            key={i} 
                                            type="monotone" 
                                            dataKey={result.displayName} 
                                            stroke={result.color} 
                                            dot={false} 
                                            strokeWidth={2}
                                            connectNulls={true} // Helps visual continuity
                                            isAnimationActive={false}
                                        />
                                    ))}
                                    {/* EXPERIMENTAL LINE */}
                                    {(() => {
                                        let hasExperimental = false;
                                        if (activeTab === 'flame_speed') {
                                            hasExperimental = Array.isArray(experimentalData) && experimentalData.some(d => d.type === 'flame' && d.plotData && d.plotData.length > 0);
                                        } else {
                                            hasExperimental = Array.isArray(experimentalData) && experimentalData.some(d => d.type === 'pressure' && d.plotData && d.plotData.length > 0);
                                        }
                                        return hasExperimental ? (
                                            <Line type="monotone" dataKey="Experimental" stroke="hsl(var(--foreground))" strokeDasharray="5 5" dot={false} strokeWidth={2} connectNulls={true} />
                                        ) : null;
                                    })()}
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                                <Activity size={48} className="mb-4 opacity-20"/>
                                <p className="text-sm">Select cases from the Data tab to compare</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* 3. METRICS TABLE (THE TRUTH) */}
                <div className="bg-card/60 border border-border p-4 rounded-xl flex flex-col overflow-hidden">
                    <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2"><Settings size={16} className="text-muted-foreground"/> Calculated Metrics (Exact)</h3>
                    <div className="flex-1 overflow-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="text-[10px] text-muted-foreground uppercase border-b border-border">
                                    <th className="pb-2 font-bold">Case</th>
                                    {activeTab === 'flame_speed' ? (
                                        <th className="pb-2 text-right">Max Speed</th>
                                    ) : (
                                        <>
                                            <th className="pb-2 text-right">P_max</th>
                                            <th className="pb-2 text-right">Impulse</th>
                                            <th className="pb-2 text-right">t_vent</th>
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="text-xs text-foreground/80">
                                {analysisResults.map((res, i) => (
                                    <tr key={i} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                                        <td className="py-3 font-mono truncate max-w-[100px]" title={res.displayName}>
                                            <span className="w-2 h-2 inline-block rounded-full mr-2" style={{backgroundColor: res.color}}></span>
                                            {res.displayName}
                                        </td>
                                        {activeTab === 'flame_speed' ? (
                                            <td className="py-3 text-right text-foreground font-bold">-</td>
                                        ) : (
                                            <>
                                                <td className="py-3 text-right font-bold text-foreground">{res.metrics?.pMax || '-'}</td>
                                                <td className="py-3 text-right text-muted-foreground">{res.metrics?.impulse || '-'}</td>
                                                <td className="py-3 text-right text-muted-foreground">{res.ventTime ? res.ventTime.toFixed(4) : '-'}</td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {analysisResults.length === 0 && <div className="text-center text-muted-foreground text-xs mt-10 italic">No metrics calculated yet</div>}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default AnalysisPage;
