import React from 'react';
import { ShieldCheck, AlertTriangle, Wind, Warehouse, HardHat, Cog, Activity, ClipboardList, UserCheck, GraduationCap } from 'lucide-react';

const ChecklistPage = ({ checklistState = {}, setChecklistState = () => {} }) => {

    const toggleItem = (id) => {
        setChecklistState(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const handleInputChange = (field, value) => {
        setChecklistState(prev => ({ ...prev, [field]: value }));
    };

    const checklistGroups = [
        {
            number: "Group 1:",
            title: "Facility & Environmental Prep",
            icon: <Warehouse size={24} className="text-zinc-400" />,
            items: [
                { id: 'vent', text: "1.1: Ventilation system is confirmed OFF [Proc.Ref. xxx]" },
                { id: 'hatches', text: "1.2: All ceiling hatches are confirmed OPEN [Proc.Ref. xxx]" },
                { id: 'cranes', text: "1.3: Overhead cranes are de-energized/OFF [Proc.Ref. xxx]" },
                { id: 'neighbors', text: "1.4: DBI neighbors and personnel in the area informed [Proc.Ref. xxx]" },
                { id: 'gate', text: "1.5: Façade Hall gate/safety tape 'DO NOT CROSS' in place [Proc.Ref. xxx]" }
            ]
        },
        {
            number: "Group 2:",
            title: "Personnel & PPE (TBT)",
            icon: <HardHat size={24} className="text-yellow-400" />,
            items: [
                { id: 'phones', text: "2.1: NO mobile phones in the Façade Hall / Safe zone storage [Proc.Ref. xxx]" },
                { id: 'ppe', text: "2.2: PPE: Hearing protection, safety boots, and FR clothing verified [Proc.Ref. xxx]" },
                { id: 'stop', text: "2.3: 'Say Stop' policy briefed to all involved [Proc.Ref. xxx]" },
                { id: 'firstaid', text: "2.4: Nearest First Aid kit located and 2+ first aiders present [Proc.Ref. xxx]" },
                { id: 'batteries', text: "2.5: Lithium-Ion batteries inspected for shape changes [Proc.Ref. xxx]" }
            ]
        },
        {
            number: "Group 3:",
            title: "Hardware & Supply Line",
            icon: <Cog size={24} className="text-orange-400" />,
            items: [
                { id: 'blocks', text: "3.1: Mechanical blocks (2-3 per side) secured against tunnel [Proc.Ref. xxx]" },
                { id: 'leak', text: "3.2: Soapy water leakage test completed on H2 supply line [Proc.Ref. xxx]" },
                { id: 'v7', text: "3.3: Valve V7 confirmed OPEN for H2 adding to protect seal [Proc.Ref. xxx]" },
                { id: 'cylinder', text: "3.4: Hydrogen cylinder secured in stable position [Proc.Ref. xxx]" },
                { id: 'fan', text: "3.5: ATEX fan securely fixed and grounded [Proc.Ref. xxx]" }
            ]
        },
        {
            number: "Group 4:",
            title: "Systems Shakedown",
            icon: <Activity size={24} className="text-red-500" />,
            items: [
                { id: 'pretest', text: "4.1: Dry shakedown (no H2) verified for sync, cameras, and spark [Proc.Ref. xxx]" },
                { id: 'emergency', text: "4.2: Action cards for Ignitor/Fan failure reviewed by team [Proc.Ref. xxx]" },
                { id: 'sensors', text: "4.3: Pressure and H2 sensors zeroed and signal verified [Proc.Ref. xxx]" }
            ]
        }
    ];

    const allItemIds = checklistGroups.flatMap(group => group.items.map(item => item.id));
    const totalItems = allItemIds.length;
    const completedItems = allItemIds.filter(id => checklistState[id]).length;
    const completionPercent = totalItems ? Math.round((completedItems / totalItems) * 100) : 0;
    const hasResponsible = Boolean((checklistState['resp_name'] || '').trim()) && Boolean((checklistState['inst_init'] || '').trim());
    const isAllChecked = completedItems === totalItems && totalItems > 0;
    const isReady = isAllChecked && checklistState['final_confirm'] && hasResponsible;

    const setAllItems = (value) => {
        setChecklistState(prev => {
            const next = { ...prev };
            allItemIds.forEach(id => {
                next[id] = value;
            });
            return next;
        });
    };

    const setGroupItems = (items, value) => {
        setChecklistState(prev => {
            const next = { ...prev };
            items.forEach(item => {
                next[item.id] = value;
            });
            return next;
        });
    };

    return (
        <div className="flex flex-col h-full w-full p-6 animate-in fade-in duration-500 overflow-y-auto custom-scrollbar bg-background text-foreground">
            <div className="flex items-center justify-between mb-8 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <ClipboardList className="text-primary" size={24} />
                    <h1 className="text-xl font-bold tracking-tight uppercase">Pre-Experiment Checklist</h1>
                </div>
                <div className="flex items-center gap-2 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
                    <ShieldCheck size={20} className="text-amber-500" />
                    <span className="text-[11px] font-bold text-amber-500 uppercase tracking-widest">Safety Protocol Active: [Proc.Ref. xxx]</span>
                </div>
            </div>

            {/* Progress + Actions */}
            <div className="mb-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-xl border border-sidebar-border bg-card/60 p-5">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">Checklist Progress</div>
                            <div className="mt-2 flex items-center gap-3">
                                <span className="text-2xl font-bold text-foreground">{completionPercent}%</span>
                                <span className="text-xs text-muted-foreground">{completedItems}/{totalItems} complete</span>
                                {isReady ? (
                                    <span className="ml-2 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                                        Ready
                                    </span>
                                ) : (
                                    <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-500">
                                        Pending
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setAllItems(true)}
                                className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-primary hover:border-primary/60 hover:bg-primary/20 transition"
                            >
                                Mark All
                            </button>
                            <button
                                type="button"
                                onClick={() => setAllItems(false)}
                                className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-ring transition"
                            >
                                Reset All
                            </button>
                        </div>
                    </div>
                    <div className="mt-4 h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${completionPercent}%` }}
                        />
                    </div>
                    {!hasResponsible && (
                        <div className="mt-3 text-[11px] text-amber-500">
                            Add responsible name and initials to enable final sign-off.
                        </div>
                    )}
                </div>
                <div className="rounded-xl border border-sidebar-border bg-card/60 p-5">
                    <div className="flex items-center gap-2 text-muted-foreground mb-3">
                        <ShieldCheck size={18} className="text-primary" />
                        <span className="text-[11px] font-black uppercase tracking-widest">Status Summary</span>
                    </div>
                    <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Groups</span>
                            <span className="text-foreground">{checklistGroups.length}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Items</span>
                            <span className="text-foreground">{totalItems}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Completed</span>
                            <span className="text-foreground">{completedItems}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Emergency & Responsible Party Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div className="lg:col-span-2 p-5 rounded-xl border border-sidebar-border bg-card/60">
                    <div className="flex items-center gap-2 mb-2 text-destructive">
                        <AlertTriangle size={22} />
                        <span className="text-xs font-bold uppercase tracking-wider">Emergency Action Card Reminder</span>
                    </div>
                    <p className="text-sm text-amber-500 leading-relaxed italic">
                        In case of Ignitor failure: Use fan to vent until H2 = 0% [Proc.Ref. xxx].
                    </p>
                    <p className="text-sm text-amber-500 leading-relaxed italic">
                        In case of Fan failure: Be sure of safety distance and press trigger [Proc.Ref. xxx].
                    </p>
                </div>

                {/* Responsible Sign-off Box */}
                <div className="bg-card/60 border border-sidebar-border rounded-xl p-5 flex flex-col gap-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <UserCheck size={18} className="text-primary" />
                        <span className="text-[11px] font-black uppercase tracking-widest">Responsible Sign-off</span>
                    </div>
                    <div className="space-y-2">
                        <div className="relative">
                            <input 
                                type="text"
                                placeholder="Responsible Name"
                                className="w-full bg-background border border-border rounded-lg p-2 text-xs outline-none focus:border-ring"
                                value={checklistState['resp_name'] || ''}
                                onChange={(e) => handleInputChange('resp_name', e.target.value)}
                            />
                        </div>
                        <div className="relative">
                            <input 
                                type="text"
                                placeholder="University / Institute Initials"
                                className="w-full bg-background border border-border rounded-lg p-2 text-xs outline-none focus:border-ring"
                                value={checklistState['inst_init'] || ''}
                                onChange={(e) => handleInputChange('inst_init', e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                             <input 
                                type="checkbox"
                                id="final-lock"
                                className="w-4 h-4 rounded border-border bg-background text-primary"
                                checked={checklistState['final_confirm'] || false}
                                onChange={() => toggleItem('final_confirm')}
                            />
                            <label htmlFor="final-lock" className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">I confirm safety readiness</label>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                {checklistGroups.map((group, gIdx) => {
                    const groupDone = group.items.filter(item => checklistState[item.id]).length;
                    const groupTotal = group.items.length;
                    const groupPercent = groupTotal ? Math.round((groupDone / groupTotal) * 100) : 0;
                    const groupComplete = groupDone === groupTotal && groupTotal > 0;

                    return (
                    <div key={gIdx} className="rounded-xl border border-sidebar-border bg-card/50 p-5 hover:border-primary/50 transition">
                        <div className="flex items-center gap-3 mb-4">
                            {group.icon}
                            <h2 className="text-sm font-black uppercase">{group.number}</h2>
                            <h2 className="text-sm font-black">{group.title}</h2>
                            <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                                groupComplete
                                    ? 'border-primary/30 bg-primary/10 text-primary'
                                    : 'border-border bg-muted/40 text-muted-foreground'
                            }`}>
                                {groupDone}/{groupTotal}
                            </span>
                        </div>
                        <div className="mb-3 h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${groupPercent}%` }}
                            />
                        </div>
                        <div className="mb-3 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setGroupItems(group.items, true)}
                                className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary hover:border-primary/60 hover:bg-primary/20 transition"
                            >
                                Mark Group
                            </button>
                            <button
                                type="button"
                                onClick={() => setGroupItems(group.items, false)}
                                className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-ring transition"
                            >
                                Reset
                            </button>
                        </div>
                        <div className="space-y-1">
                            {group.items.map((item) => (
                                <label key={item.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-muted/60 cursor-pointer group transition-colors border border-transparent hover:border-border">
                                    <input 
                                        type="checkbox" 
                                        className="mt-1 w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary"
                                        checked={checklistState[item.id] || false}
                                        onChange={() => toggleItem(item.id)}
                                    />
                                    <span className={`text-sm transition-all ${checklistState[item.id] ? 'text-muted-foreground line-through' : 'text-foreground/80'}`}>
                                        {item.text}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                    );
                })}
            </div>

            
        </div>
    );
};

export default ChecklistPage;
