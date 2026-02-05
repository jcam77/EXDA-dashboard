import React, { useState } from 'react';
import { FileText, ClipboardCheck, Activity, AlertTriangle, Save, Download } from 'lucide-react';

const ReportPage = ({
    experiments = [],
    checklistState = {},
    planMeta = {},
}) => {
    const [selectedExpId, setSelectedExpId] = useState("");
    const [observations, setObservations] = useState("");

    const selectedExp = experiments.find(e => e.id === selectedExpId);
    
    // Safety Status Calculation
    const totalChecklistItems = 18; // Based on your 4 groups
    const completedItems = Object.values(checklistState).filter(Boolean).length;
    const safetyScore = Math.round((completedItems / totalChecklistItems) * 100);

    return (
        <div className="flex flex-col h-[75vh] bg-background p-6 animate-in fade-in duration-500 overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="flex justify-between items-center mb-8 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <FileText className="text-blue-500" size={24} />
                    <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">Experimental Test Report</h1>
                </div>
                <button className="flex items-center gap-2 bg-muted hover:bg-muted/80 text-foreground px-4 py-2 rounded-lg text-xs font-bold transition-all">
                    <Download size={14} /> Export PDF
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Configuration & Safety */}
                <div className="space-y-6">
                    <div className="bg-card/60 border border-border/60 rounded-2xl p-5">
                        <h2 className="text-xs font-black uppercase text-muted-foreground mb-4 tracking-widest">Test Selection</h2>
                        <select 
                            value={selectedExpId}
                            onChange={(e) => setSelectedExpId(e.target.value)}
                            className="w-full bg-background border border-border text-sm text-foreground p-2 rounded-lg outline-none focus:border-ring"
                        >
                            <option value="">Select Experiment from Plan...</option>
                            {experiments.map(exp => (
                                <option key={exp.id} value={exp.id}>{exp.name} ({exp.id})</option>
                            ))}
                        </select>
                        {selectedExp && (
                            <div className="mt-4 text-[11px] text-muted-foreground italic">
                                Plan Objective: {planMeta.objective || "No objective defined."}
                            </div>
                        )}
                    </div>

                    <div className="bg-card/60 border border-border/60 rounded-2xl p-5">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xs font-black uppercase text-muted-foreground tracking-widest">Safety Compliance</h2>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${safetyScore === 100 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-orange-500/10 text-orange-500'}`}>
                                {safetyScore}% Verified
                            </span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-[11px]">
                                <span className="text-muted-foreground">Pre-test Checklist</span>
                                <span className="text-foreground">{completedItems} / {totalChecklistItems} OK</span>
                            </div>
                            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                                <div className="bg-emerald-500 h-full transition-all" style={{ width: `${safetyScore}%` }}></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Middle Column: Technical Results */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-card/60 border border-border/60 rounded-2xl p-6">
                        <h2 className="text-xs font-black uppercase text-muted-foreground mb-6 tracking-widest flex items-center gap-2">
                            <Activity size={14} className="text-red-500" /> Measured Performance
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="p-4 bg-background rounded-xl border border-border/60">
                                <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">Peak Pressure</div>
                                <div className="text-lg font-mono text-foreground">-- <span className="text-xs text-muted-foreground">bar</span></div>
                            </div>
                            <div className="p-4 bg-background rounded-xl border border-border/60">
                                <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">Total Impulse</div>
                                <div className="text-lg font-mono text-foreground">-- <span className="text-xs text-muted-foreground">Pa·s</span></div>
                            </div>
                            <div className="p-4 bg-background rounded-xl border border-border/60">
                                <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">Vent Timing</div>
                                <div className="text-lg font-mono text-foreground">-- <span className="text-xs text-muted-foreground">ms</span></div>
                            </div>
                            <div className="p-4 bg-background rounded-xl border border-border/60">
                                <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">H2 Conc.</div>
                                <div className="text-lg font-mono text-foreground">-- <span className="text-xs text-muted-foreground">%</span></div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-card/60 border border-border/60 rounded-2xl p-6">
                        <h2 className="text-xs font-black uppercase text-muted-foreground mb-4 tracking-widest flex items-center gap-2">
                            <ClipboardCheck size={14} className="text-blue-500" /> Manual Observations
                        </h2>
                        <textarea 
                            className="w-full bg-background border border-border rounded-xl p-4 text-sm text-foreground outline-none focus:border-ring min-h-[120px] resize-none"
                            placeholder="Describe seal behavior, reaction forces, or any deviations from the RAMS..."
                            value={observations}
                            onChange={(e) => setObservations(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Emergency Log Footer */}
            <div className="mt-8 p-4 bg-orange-500/5 border border-orange-500/20 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <AlertTriangle size={18} className="text-orange-500" />
                    <div>
                        <div className="text-[10px] font-black uppercase text-orange-500">Event Log</div>
                        <div className="text-[11px] text-muted-foreground italic">No emergency action cards triggered during this run.</div>
                    </div>
                </div>
                <button className="text-[10px] font-bold uppercase text-muted-foreground hover:text-foreground transition-colors">Add incident report</button>
            </div>
        </div>
    );
};

export default ReportPage;
