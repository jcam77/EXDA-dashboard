import React, { useState } from 'react';
import { 
    Save, Upload, Plus, CheckSquare, Square, PenTool, Trash2, Calendar, 
    Clock, Target, GripVertical, Layers, FlaskConical, BarChart2, X, 
    AlertCircle, CheckCircle2, Beaker, Zap, Cpu, TrendingUp, Thermometer, Gauge 
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell, LabelList } from 'recharts';

const PlanPage = ({ 
    experiments = [], 
    setExperiments, 
    planName, 
    setPlanName, 
    planMeta = { objective: "", description: "", startDate: "", deadline: "" },
    setPlanMeta,
    onSave, 
    onImport 
}) => {
    const [input, setInput] = useState({ name: "" });
    const [editingExp, setEditingExp] = useState(null);
    const [draggedId, setDraggedId] = useState(null);

    // --- ANALYTICS & GATING ---
    const isReady = (exp) => {
        // Gates: Mandatory fields for scientific integrity
        return exp.meta?.h2 && exp.meta?.ignition && exp.meta?.vent;
    };

    const getStats = () => {
        const total = experiments.length;
        const done = experiments.filter(e => e.done).length;
        const remaining = total - done;
        const ready = experiments.filter(e => isReady(e)).length;

        const today = new Date();
        const deadlineDate = planMeta.deadline ? new Date(planMeta.deadline) : null;
        
        let daysLeft = 0;
        let pace = 0;

        if (deadlineDate) {
            const diffTime = deadlineDate - today;
            daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (daysLeft > 0 && remaining > 0) {
                pace = (remaining / daysLeft).toFixed(1);
            }
        }
        const completionPercent = total ? Math.round((done / total) * 100) : 0;
        return { total, done, remaining, ready, daysLeft: daysLeft > 0 ? daysLeft : 0, pace, completionPercent };
    };
    
    const stats = getStats();

    const getMissingMeta = (exp) => {
        const missing = [];
        if (!exp.meta?.h2) missing.push('H2%');
        if (!exp.meta?.ignition) missing.push('Ignition');
        if (!exp.meta?.vent) missing.push('Vent');
        return missing;
    };

    // --- CRUD ---
    const addExp = () => {
        if (!input.name.trim()) return;
        setExperiments([...experiments, { 
            id: Date.now(), 
            name: input.name, 
            done: false,
            meta: { h2: "", p0: "1.013", t0: "293", ignition: "", vent: "", cfdHash: "" } 
        }]);
        setInput({ name: "" });
    };

    const saveEdit = () => {
        if (editingExp) {
            setExperiments(experiments.map(e => e.id === editingExp.id ? editingExp : e));
            setEditingExp(null);
        }
    };

    // --- DRAG AND DROP ---
    const onDrop = (targetId) => {
        if (!draggedId || draggedId === targetId) return;
        const newExps = [...experiments];
        const draggedIdx = newExps.findIndex(e => e.id === draggedId);
        const targetIdx = newExps.findIndex(e => e.id === targetId);
        const [removed] = newExps.splice(draggedIdx, 1);
        newExps.splice(targetIdx, 0, removed);
        setExperiments(newExps);
        setDraggedId(null);
    };

    // --- NUMERICAL GROUPING FIX ---
    const getGroupedExperiments = () => {
        const groups = {};
        experiments.forEach(exp => {
            const match = exp.name.match(/(\d+pctV)/i);
            const g = match ? match[1].replace(/pct/i, '%').toUpperCase() : "GENERAL";
            if (!groups[g]) groups[g] = [];
            groups[g].push(exp);
        });

        const sortedGroupNames = Object.keys(groups).sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.replace(/\D/g, '')) || 0;
            if (a === "GENERAL") return 1;
            if (b === "GENERAL") return -1;
            return numA - numB;
        });

        const ordered = {};
        sortedGroupNames.forEach(name => { ordered[name] = groups[name]; });
        return ordered;
    };

    const groupedTasks = getGroupedExperiments();

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
            {/* LEFT: LIST & RUN CARDS (30%) */}
            <div className="lg:col-span-4 bg-zinc-900/50 border border-zinc-800 p-6 rounded-xl flex flex-col h-full overflow-hidden">
                <div className="flex justify-between items-center mb-4 gap-2">
                   <div className="flex items-center gap-2 flex-1">
                       <FlaskConical size={16} className="text-primary shrink-0"/>
                       <input value={planName} onChange={e=>setPlanName(e.target.value)} className="bg-transparent border-b border-zinc-800 text-sm font-bold w-full outline-none focus:border-primary text-white"/>
                   </div>
                   <div className="flex gap-1">
                       <button onClick={onSave} className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"><Save size={18}/></button>
                       <button onClick={onImport} className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"><Upload size={18}/></button>
                   </div>
                </div>
                
                <div className="flex flex-col gap-2 mb-4 bg-black/20 p-3 rounded border border-zinc-800/50">
                    <input value={input.name} onChange={e=>setInput({...input, name:e.target.value})} placeholder="vh2d-10pctV-001" className="bg-black border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-primary text-white"/>
                    <button onClick={addExp} className="bg-primary/10 border border-primary/30 px-3 py-1.5 rounded text-primary hover:border-primary/60 hover:bg-primary/20 flex items-center justify-center gap-2 font-bold text-xs"><Plus size={14}/> Add Planned Run</button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                    {Object.entries(groupedTasks).map(([group, tasks]) => (
                        <div key={group} className="mb-4">
                            <h4 className="text-[10px] font-bold text-zinc-500 uppercase mb-2 flex items-center gap-2 tracking-wider"><Layers size={10}/> {group}</h4>
                            {tasks.map(e => (
                                <div key={e.id} draggable onDragStart={()=>setDraggedId(e.id)} onDragOver={ev=>ev.preventDefault()} onDrop={()=>onDrop(e.id)} className={`flex flex-col p-3 bg-black/40 border rounded mb-2 group transition-all ${isReady(e) ? 'border-zinc-900 hover:border-zinc-700' : 'border-yellow-900/30 hover:border-yellow-700/50'}`}>
                                    <div className="flex items-center gap-2">
                                        <GripVertical size={14} className="text-zinc-700 cursor-grab active:cursor-grabbing"/>
                                        <button 
                                            onClick={() => setExperiments(experiments.map(x => x.id === e.id ? {...x, done: !x.done} : x))} 
                                            disabled={!isReady(e)}
                                            className={`${isReady(e) ? 'text-zinc-600 hover:text-primary' : 'text-zinc-800 cursor-not-allowed'}`}
                                        >
                                            {e.done ? <CheckSquare size={16} className="text-[hsl(var(--primary))]"/> : <Square size={16}/>}
                                        </button>
                                        <span className={`text-sm flex-1 truncate font-mono ${e.done ? 'line-through text-zinc-600' : 'text-zinc-300'}`}>{e.name}</span>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                                            <button onClick={()=>setEditingExp({...e})} className="text-zinc-600 hover:text-white p-1 hover:bg-zinc-800 rounded transition-colors"><PenTool size={12}/></button>
                                            <button onClick={()=>setExperiments(experiments.filter(x=>x.id!==e.id))} className="text-zinc-600 hover:text-red-500 p-1 hover:bg-zinc-800 rounded transition-colors"><Trash2 size={12}/></button>
                                        </div>
                                    </div>
                                    
                                    <div className="ml-8 mt-2 flex flex-wrap gap-2">
                                        {isReady(e) ? (
                                            <>
                                                <div className="flex items-center gap-1 bg-primary/10 border border-primary/30 px-1.5 py-0.5 rounded text-[9px] text-primary font-bold">
                                                    <Beaker size={8}/> {e.meta.h2}% H2
                                                </div>
                                                <div className="flex items-center gap-1 border border-zinc-800 px-1.5 py-0.5 rounded text-[9px] text-zinc-500 font-mono">
                                                    <Gauge size={8}/> {e.meta.p0} bar
                                                </div>
                                                <div className="flex items-center gap-1 border border-zinc-800 px-1.5 py-0.5 rounded text-[9px] text-zinc-500 font-mono">
                                                    <Thermometer size={8}/> {e.meta.t0} K
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex items-center gap-1 bg-yellow-950/20 border border-yellow-900/30 px-1.5 py-0.5 rounded text-[9px] text-yellow-600 font-bold uppercase tracking-wider">
                                                <AlertCircle size={8}/> Missing: {getMissingMeta(e).join(', ')}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* RIGHT: CHARTS & PROJECT STATS (70%) */}
            <div className="lg:col-span-8 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* OBJECTIVE CARD */}
                    <div className="lg:col-span-2 bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl">
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-wider"><Target size={16}/> Project Objectives</div>
                            <div className="flex gap-4 bg-black/40 p-2 rounded-lg border border-zinc-800/50">
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-zinc-500 uppercase font-bold text-center">Start</span>
                                    <input type="date" value={planMeta.startDate} onChange={e=>setPlanMeta({...planMeta, startDate: e.target.value})} className="bg-transparent text-[10px] text-zinc-400 border-none p-0 outline-none w-24 cursor-pointer text-center"/>
                                </div>
                                <div className="w-px bg-zinc-800 h-6 mx-1"></div>
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-zinc-500 uppercase font-bold text-center">Deadline</span>
                                    <input type="date" value={planMeta.deadline} onChange={e=>setPlanMeta({...planMeta, deadline: e.target.value})} className="bg-transparent text-[10px] text-primary border-none p-0 outline-none w-24 cursor-pointer font-bold text-center"/>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                                Objective (one line)
                            </label>
                            <input
                                value={planMeta.objective}
                                onChange={e=>setPlanMeta({...planMeta, objective:e.target.value})}
                                className="w-full bg-black/30 text-xs px-3 py-2 rounded-lg outline-none border border-zinc-800 text-zinc-300 focus:border-primary"
                                placeholder="Primary objective (one line)"
                            />
                        </div>
                        <div className="mt-3 space-y-2">
                            <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                                Description (details)
                            </label>
                            <textarea
                                value={planMeta.description}
                                onChange={e=>setPlanMeta({...planMeta, description:e.target.value})}
                                className="w-full bg-black/30 text-xs p-3 rounded-lg outline-none h-20 border border-zinc-800 text-zinc-300 resize-none focus:border-primary"
                                placeholder="Add a longer description, scope, and notes..."
                            />
                        </div>
                    </div>

                    {/* KPI GRID */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                            <div className="text-xl font-bold text-white leading-none mb-1">{stats.done}/{stats.total}</div>
                            <div className="text-[9px] uppercase text-zinc-500 font-bold">Performed</div>
                        </div>
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                            <div className="text-xl font-bold text-primary leading-none mb-1">{stats.ready}</div>
                            <div className="text-[9px] uppercase text-zinc-500 font-bold">Ready Runs</div>
                        </div>
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                            <div className="text-xl font-bold text-zinc-300 leading-none mb-1">{stats.daysLeft}</div>
                            <div className="text-[9px] uppercase text-zinc-500 font-bold">Days until Deadline</div>
                        </div>
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                            <div className="text-xl font-bold text-primary leading-none mb-1">{stats.pace || '--'}</div>
                            <div className="text-[9px] uppercase text-zinc-500 font-bold">Pace (Runs/Day)</div>
                        </div>
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-2 text-center col-span-2">
                            <div className="text-xl font-bold text-white leading-none mb-1">{stats.completionPercent}%</div>
                            <div className="text-[9px] uppercase text-zinc-500 font-bold">Completion</div>
                            <div className="mt-2 h-1 w-full max-w-[120px] rounded-full bg-zinc-800 overflow-hidden">
                                <div className="h-full bg-primary" style={{ width: `${stats.completionPercent}%` }} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* TIMELINE */}
                <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl h-[450px] shrink-0 flex flex-col">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase mb-4 flex items-center gap-2 tracking-wider"><Clock size={12}/> Campaign Schedule</h3>
                    <div className="flex-1 bg-black/40 rounded-lg border border-zinc-800/50 overflow-hidden">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart layout="vertical" data={experiments.map((e,i)=>({name:e.name, offset:i, duration:1, status:e.done}))} barSize={14} margin={{left: 20, right: 30, bottom: 20}}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#222" />
                                <XAxis type="number" stroke="#52525b" fontSize={9} tickFormatter={(val) => `D${val}`} domain={[0, 'auto']} />
                                <YAxis type="category" dataKey="name" width={120} fontSize={9} stroke="#51515b" tick={{fill: '#888'}} />
                                <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{backgroundColor: '#18181b', border: '1px solid #3f3f46', fontSize: '10px'}} />
                                <Bar dataKey="offset" stackId="a" fill="transparent" />
                                <Bar dataKey="duration" stackId="a" radius={4}>
                                    {experiments.map((e, index) => <Cell key={`cell-${index}`} fill={e.done ? 'hsl(var(--primary))' : '#3f3f46'} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* GROUP DISTRIBUTION */}
                <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl h-[160px] shrink-0 flex flex-col">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase mb-4 flex items-center gap-2 tracking-wider"><BarChart2 size={12}/> Mixture Distribution</h3>
                    <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={Object.entries(groupedTasks).map(([name, tasks]) => ({ name, count: tasks.length }))}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#222" />
                                <XAxis dataKey="name" fontSize={9} stroke="#555" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                                <YAxis fontSize={9} stroke="#555" allowDecimals={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                                <Tooltip contentStyle={{backgroundColor: '#18181b', border: '1px solid #3f3f46', fontSize: '10px'}} />
                                <Bar dataKey="count" fill="#3f3f46" radius={[4, 4, 0, 0]} barSize={40}>
                                     {Object.entries(groupedTasks).map((entry, index) => (
                                        <Cell key={`cell-dist-${index}`} fill={index % 2 === 0 ? 'hsl(var(--primary))' : '#3f3f46'} />
                                    ))}
                                    <LabelList dataKey="count" position="top" fill="hsl(var(--primary))" fontSize={10} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* RUN CARD MODAL */}
            {editingExp && (
                <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-4 backdrop-blur-md">
                    <div className="bg-zinc-950 p-8 rounded-2xl border border-primary/30 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto ring-1 ring-white/5">
                        <div className="flex justify-between items-center mb-8 border-b border-zinc-800 pb-6">
                            <div>
                                <h3 className="text-white font-bold text-xl flex items-center gap-3 tracking-tight">
                                    <Beaker size={24} className="text-primary"/> Run MetaData Card
                                </h3>
                                <p className="text-zinc-500 text-xs mt-1 font-mono uppercase tracking-widest">{editingExp.name}</p>
                            </div>
                            <button onClick={()=>setEditingExp(null)} className="text-zinc-500 hover:text-white bg-zinc-900 p-2 rounded-full transition-all hover:scale-110"><X size={20}/></button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 text-left">
                            <div className="space-y-6">
                                <div>
                                    <div className="flex items-center gap-2 text-zinc-400 font-bold text-[10px] uppercase tracking-widest mb-3 border-b border-zinc-900 pb-1">
                                        <TrendingUp size={12}/> Mixture Parameters
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div><label className="text-[9px] text-zinc-500 uppercase font-bold mb-1 block">Target H2%</label><input value={editingExp.meta?.h2} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, h2:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-white outline-none focus:ring-1 focus:ring-primary" placeholder="10.5"/></div>
                                        <div><label className="text-[9px] text-zinc-500 uppercase font-bold mb-1 block">Init P (bar)</label><input value={editingExp.meta?.p0} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, p0:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-white outline-none focus:ring-1 focus:ring-primary"/></div>
                                        <div><label className="text-[9px] text-zinc-500 uppercase font-bold mb-1 block">Init T (K)</label><input value={editingExp.meta?.t0} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, t0:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-white outline-none focus:ring-1 focus:ring-primary"/></div>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 text-zinc-400 font-bold text-[10px] uppercase tracking-widest mb-3 border-b border-zinc-900 pb-1">
                                        <Zap size={12}/> Experimental Setup
                                    </div>
                                    <div className="space-y-4">
                                        <div><label className="text-[9px] text-zinc-500 uppercase font-bold mb-1 block">Ignition Config</label><input value={editingExp.meta?.ignition} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, ignition:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-white outline-none focus:ring-1 focus:ring-primary" placeholder="Center Spark, 100mJ"/></div>
                                        <div><label className="text-[9px] text-zinc-500 uppercase font-bold mb-1 block">Venting Config</label><input value={editingExp.meta?.vent} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, vent:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-white outline-none focus:ring-1 focus:ring-primary" placeholder="Mylar 20um, removal by wire"/></div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <div className="flex items-center gap-2 text-zinc-400 font-bold text-[10px] uppercase tracking-widest mb-3 border-b border-zinc-900 pb-1">
                                        <Cpu size={12}/> Traceability Link
                                    </div>
                                    <div><label className="text-[9px] text-zinc-500 uppercase font-bold mb-1 block">Case ID / CFD Hash</label><input value={editingExp.meta?.cfdHash} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, cfdHash:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-400 font-mono outline-none focus:ring-1 focus:ring-primary" placeholder="#OFv2306-mesh-rev2"/></div>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 text-zinc-400 font-bold text-[10px] uppercase tracking-widest mb-3 border-b border-zinc-900 pb-1">
                                        <PenTool size={12}/> Operator Notes
                                    </div>
                                    <textarea value={editingExp.notes} onChange={e=>setEditingExp({...editingExp, notes:e.target.value})} className="w-full bg-black border border-zinc-800 rounded p-4 text-xs text-zinc-300 h-36 outline-none focus:ring-1 focus:ring-primary resize-none font-sans" placeholder="Record sensor health, offsets, or observations..."/>
                                </div>
                            </div>
                        </div>

                        <div className="mt-10 flex gap-4 border-t border-zinc-800 pt-8">
                            <button onClick={()=>setEditingExp(null)} className="flex-1 bg-zinc-900 text-zinc-400 py-3 rounded-xl font-bold text-sm border border-zinc-800 hover:bg-zinc-800 transition-all">Discard Changes</button>
                            <button onClick={saveEdit} className="flex-[2] bg-primary text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-primary/30 hover:bg-primary/90 transition-all active:scale-95">Verify & Save Run Card</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlanPage;
