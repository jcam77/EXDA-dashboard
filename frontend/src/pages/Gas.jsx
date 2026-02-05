import React, { useState } from 'react';
import { FlaskConical,Beaker, Wind, Gauge, RefreshCw, UserCheck } from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';

/**
 * GasPage Component
 * PhD Context: Handles verification of H2 vol% concentrations (8–14 vol%).
 * Ensures traceable stoichiometric calculations are performed in Python backend.
 */
const GasPage = ({ projectPath }) => {
    const apiBaseUrl = getBackendBaseUrl();
    // Local state for stoichiometric inputs
    const [inputs, setInputs] = useState({ targetVol: 10, ambPressure: 1.01325 });
    const [results, setResults] = useState(null);
    const [isCalculating, setIsCalculating] = useState(false);

    /**
     * Sends parameters to Flask to calculate partial pressures.
     * Prevents floating point issues and ensures experimental traceability.
     */
    const calculateInBackend = async () => {
        setIsCalculating(true);
        try {
            const res = await fetch(`${apiBaseUrl}/calculate_gas_mix`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...inputs, projectPath })
            });
            const data = await res.json();
            if (data.success) setResults(data.results);
        } catch {
            console.error("PhD Research Module: Backend calculation failed.");
        } finally {
            setIsCalculating(false);
        }
    };

    return (
        <div className="flex flex-col h-[75vh] bg-background p-6 animate-in fade-in duration-500 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-8 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <FlaskConical className="text-primary" size={24} />
                    <h1 className="text-lg font-bold text-foreground tracking-tight uppercase">Gas Mixing <span className='font-normal text-muted-foreground'>| Python Verified</span></h1>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {/* Parameter Inputs */}
                <div className="bg-card/60 border border-border rounded-xl p-6 space-y-6 shadow-2xl">
                    <h2 className="text-base font-bold text-foreground mb-4 flex items-center gap-2"><Beaker size={18} className="text-primary" /> Input Parameters</h2>
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Target H2 Vol %</label>
                            <input type="number" className="w-full bg-background border border-border rounded-md p-2.5 text-sm text-foreground outline-none focus:border-primary" 
                                value={inputs.targetVol} onChange={(e) => setInputs({...inputs, targetVol: e.target.value})} />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Ambient Pressure (bar)</label>
                            <input type="number" className="w-full bg-background border border-border rounded-md p-2.5 text-sm text-foreground outline-none focus:border-primary" 
                                value={inputs.ambPressure} onChange={(e) => setInputs({...inputs, ambPressure: e.target.value})} />
                        </div>

                        <button onClick={calculateInBackend} disabled={isCalculating} className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:border-primary/60 hover:bg-primary/20 transition self-start mt-2">
                            {isCalculating ? <RefreshCw className="animate-spin" size={18} /> : <Gauge size={16} />} Calculate
                        </button>
                    </div>
                </div>

                {/* Verified Results */}
                <div className="bg-card/60 border border-border rounded-xl p-6 flex flex-col justify-center text-center shadow-2xl">
                    {results ? (
                        <div className="space-y-8 animate-in zoom-in-95 duration-300">
                            <div>
                                <div className="text-5xl font-mono text-foreground tracking-tighter">{results.partial_h2}</div>
                                <div className="text-xs font-semibold text-primary uppercase mt-2">P_H2 Partial (bar)</div>
                            </div>
                            <div className="pt-6 border-t border-zinc-800/50">
                                <div className="text-2xl font-mono text-muted-foreground">{results.total_p}</div>
                                <div className="text-xs font-semibold text-muted-foreground uppercase mt-1">Final Chamber Pressure</div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-muted-foreground italic text-sm font-medium">Await Python stoichiometric validation...</div>
                    )}
                </div>
            </div>

            {/* Mixing Protocol Card Only */}
            <div className="mt-8">
                <div className="p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-xl flex items-center gap-4 shadow-2xl">
                    <Wind size={24} className="text-emerald-400" />
                    <div>
                        <div className="text-base font-bold text-foreground">Mixing Protocol</div>
                        <div className="text-sm text-muted-foreground">Run ATEX fan for 5 minutes post-injection for homogeneity.</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GasPage;
