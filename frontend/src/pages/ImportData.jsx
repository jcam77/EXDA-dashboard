import React from 'react';
import { Trash2, FileText, Database, FlaskConical, FolderOpen, Activity, Flame, Upload, Layers, Import, Droplets } from 'lucide-react';
import { isSimulationCaseFile } from '../features/workspace/dataImportRules';

const ImportDataPage = (props) => {
    const { 
        projectPath: _projectPath,
        onSimFolderSelect: _onSimFolderSelect, 
        onExpFolderSelect: _onExpFolderSelect, 
        sessionFiles = [], 
        expFiles = [], 
        selectedExpFolder = "",
        simulationData = [], 
        experimentalData,    
        experimentalFlameData: _experimentalFlameData, 
        selectedCases = [], 
        onOpenSimPicker,
        onOpenExpPicker,
        onSelectionChange, 
        onRemoveCase, 
        onToggleCase,
        showSimulationSection = true,
        formatName = (n) => n
    } = props;

    const filteredExpFiles = Array.isArray(expFiles) ? expFiles.filter(f => {
        if (!selectedExpFolder) return true;
        if (f.webkitRelativePath) {
            return f.webkitRelativePath.startsWith(selectedExpFolder);
        }
        if (f.path) {
            return f.path.startsWith(selectedExpFolder);
        }
        return true;
    }) : [];

    const expPressureFiles = filteredExpFiles.filter(f => !f.isDirectory);
    const expFlameFiles = filteredExpFiles.filter(f => !f.isDirectory);
    const expConcentrationFiles = filteredExpFiles.filter((f) => {
        if (f.isDirectory) return false;
        const candidate = String(f.name || f.path || f.webkitRelativePath || '');
        return /\.csv$/i.test(candidate);
    });

    const simCaseFiles = Array.isArray(sessionFiles) ? sessionFiles.filter(isSimulationCaseFile) : [];

    const expQueue = Array.isArray(experimentalData) ? experimentalData : [];
    const isFlameQueueItem = (item) => {
        const t = String(item?.type || "").toLowerCase();
        return t.includes("flame");
    };
    const isConcentrationQueueItem = (item) => {
        const t = String(item?.type || "").toLowerCase();
        return t.includes("concentration");
    };
    const pressureQueue = expQueue.filter((item) => !isFlameQueueItem(item) && !isConcentrationQueueItem(item));
    const flameQueue = expQueue.filter((item) => isFlameQueueItem(item));
    const concentrationQueue = expQueue.filter((item) => isConcentrationQueueItem(item));

    const getFullBaseName = (raw) => {
        if (!raw) return "Unknown";
        const parts = String(raw).split(/[/\\]/).filter(Boolean);
        return parts[parts.length - 1] || String(raw);
    };

    const getQueueDisplayName = (item) => getFullBaseName(item?.path || item?.name);
    const getQueuePath = (item) => String(item?.path || item?.name || "");

    const runSelectAll = (files, type, e) => {
        files.forEach((f) => {
            const val = f.webkitRelativePath || f.path;
            if (!val) return;
            onSelectionChange({ target: { value: val } }, type);
        });
        if (e?.target) {
            e.target.value = "";
        }
    };

        return (
            <>
                <div className={`grid grid-cols-1 gap-6 ${showSimulationSection ? 'md:grid-cols-2' : ''}`}>
                    {/* EXPERIMENTS CARD */}
                    <div className="bg-card/60 border border-border p-4 rounded-xl flex flex-col h-full overflow-hidden shadow-sm">
                        <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                            <FlaskConical size={20} className="text-primary" />
                            Experiments Data
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">Select the folder containing experimental data files (CSV/TXT/DAT/ASC/ASCII/MF4/TPC5) for Pressure, Flame, and H2 Concentration.</p>
                        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Folder Structure Convention (Data)</div>
                                <div className="mt-1 text-[11px] text-zinc-300 font-mono break-all">
                                    Projects/&lt;ProjectName&gt;/Raw_Data/&lt;Run&gt;/&lt;DAQ&gt;/
                                </div>
                                <div className="mt-2 text-[11px] text-zinc-400">
                                    Example:
                                </div>
                                <ul className="mt-1 space-y-1 text-[11px] text-zinc-300 font-mono">
                                    <li>Projects/VH2D-Project/Raw_Data/VH2D-01-01/DAQ-1/DAQ-1-VH2D-01-01.tpc5</li>
                                    <li>Projects/VH2D-Project/Raw_Data/VH2D-01-01/DAQ-2/DAQ-2-VH2D-01-01.mf4</li>
                                    <li>Projects/VH2D-Project/Raw_Data/VH2D-01-01/H2CM/H2CM-U-M-L-VH2D-01-01.csv</li>
                                </ul>
                            </div>
                            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Filename Convention</div>
                                <div className="mt-1 text-[11px] text-zinc-300 font-mono break-all">
                                    &lt;Run&gt;-&lt;DAQ&gt;.&lt;ext&gt;
                                </div>
                                <div className="mt-2 text-[11px] text-zinc-400">
                                    Recommended examples:
                                </div>
                                <ul className="mt-1 space-y-1 text-[11px] text-zinc-300 font-mono">
                                    <li>DAQ-1-VH2D-01-01.tpc5</li>
                                    <li>DAQ-2-VH2D-01-01.mf4</li>
                                    <li>H2CM-U-M-L-VH2D-01-01.csv</li>
                                </ul>
                                <div className="mt-2 text-[11px] text-zinc-400">
                                    H2CM legend (sampling point location in chamber): <span className="font-mono">U</span>=Upper, <span className="font-mono">M</span>=Middle, <span className="font-mono">L</span>=Lower
                                </div>
                            </div>
                        </div>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                            <div className="md:col-span-3">
                                <button
                                    onClick={onOpenExpPicker}
                                    className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:border-primary/60 hover:bg-primary/20 transition"
                                >
                                    <Import size={16} /> Select Import Folder
                                </button>
                            </div>
                            <div className="space-y-1.5 md:col-span-3">
                                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                                    <Activity size={14} className="text-primary" /> Pressure Data
                                </div>
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === "__all__") {
                                            runSelectAll(expPressureFiles, 'exp_pressure', e);
                                            return;
                                        }
                                        if (val) {
                                            // Only select files, not folders
                                            const fileObj = expFiles.find(f => (f.webkitRelativePath || f.path) === val && (!f.isDirectory));
                                            if (fileObj && !selectedCases.some(c => (c.path || c.name) === (fileObj.path || fileObj.name))) {
                                                onToggleCase(fileObj.path || fileObj.name);
                                            }
                                            onSelectionChange(e, 'exp_pressure');
                                        }
                                    }}
                                    className="w-full p-2.5 bg-background border border-border rounded-md text-xs text-foreground outline-none"
                                    data-testid="pressure-csv-select"
                                >
                                    <option value="">Pressure data...</option>
                                    {expPressureFiles.length > 0 && <option value="__all__">Select All</option>}
                                    {expPressureFiles.map((f, i) => (
                                        <option key={i} value={f.webkitRelativePath || f.path}>{f.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1.5 md:col-span-3">
                                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                                    <Flame size={14} className="text-primary" /> Flame Data
                                </div>
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === "__all__") {
                                            runSelectAll(expFlameFiles, 'exp_flame', e);
                                            return;
                                        }
                                        if (val) {
                                            // Only select files, not folders
                                            const fileObj = expFiles.find(f => (f.webkitRelativePath || f.path) === val && (!f.isDirectory));
                                            if (fileObj && !selectedCases.some(c => (c.path || c.name) === (fileObj.path || fileObj.name))) {
                                                onToggleCase(fileObj.path || fileObj.name);
                                            }
                                            onSelectionChange(e, 'exp_flame');
                                        }
                                    }}
                                    className="w-full p-2.5 bg-background border border-border rounded-md text-xs text-foreground outline-none"
                                    data-testid="flame-csv-select"
                                >
                                    <option value="">Flame data...</option>
                                    {expFlameFiles.length > 0 && <option value="__all__">Select All</option>}
                                    {expFlameFiles.map((f, i) => (
                                        <option key={i} value={f.webkitRelativePath || f.path}>{f.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1.5 md:col-span-3">
                                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                                    <Droplets size={14} className="text-cyan-400" /> Concentration Measurements
                                </div>
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === "__all__") {
                                            runSelectAll(expConcentrationFiles, 'exp_concentration', e);
                                            return;
                                        }
                                        if (val) {
                                            const fileObj = expFiles.find(f => (f.webkitRelativePath || f.path) === val && (!f.isDirectory));
                                            if (fileObj && !selectedCases.some(c => (c.path || c.name) === (fileObj.path || fileObj.name))) {
                                                onToggleCase(fileObj.path || fileObj.name);
                                            }
                                            onSelectionChange(e, 'exp_concentration');
                                        }
                                    }}
                                    className="w-full p-2.5 bg-background border border-border rounded-md text-xs text-foreground outline-none"
                                    data-testid="concentration-csv-select"
                                >
                                    <option value="">Concentration data (.csv)...</option>
                                    {expConcentrationFiles.length > 0 && <option value="__all__">Select All</option>}
                                    {expConcentrationFiles.map((f, i) => (
                                        <option key={i} value={f.webkitRelativePath || f.path}>{f.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="mt-4 flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1">
                            <h3 className="text-base font-semibold text-foreground mb-2">Imported Data Queue</h3>
                            {expQueue.length > 0 ? (
                                <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                                    <div className="rounded-xl border border-border/80 bg-background/25 p-2.5">
                                        <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            <Activity size={13} className="text-red-500" />
                                            Pressure Queue ({pressureQueue.length})
                                        </div>
                                        <div className="space-y-1.5">
                                            {pressureQueue.length > 0 ? pressureQueue.map((d, i) => (
                                                <div key={`pressure-${i}`} className="flex items-center gap-2.5 p-2.5 bg-background border border-border rounded-lg group">
                                                    <input type="checkbox" checked={selectedCases.some(c => (c.path || c.name) === (d.path || d.name))} onChange={() => onToggleCase(d.path || d.name)} className="mt-0.5 accent-blue-600 w-4 h-4 cursor-pointer"/>
                                                    <Activity size={15} className="text-red-500 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs text-foreground/90 font-mono break-all whitespace-normal leading-relaxed pr-2" title={getQueuePath(d)}>
                                                            {getQueueDisplayName(d)}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => onRemoveCase && onRemoveCase(d.path || d.name)}
                                                        className="text-muted-foreground hover:text-red-400 p-1 shrink-0"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            )) : (
                                                <span className="block text-xs text-muted-foreground px-1 py-1.5">No pressure files in queue.</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-border/80 bg-background/25 p-2.5">
                                        <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            <Flame size={13} className="text-amber-500" />
                                            Flame Queue ({flameQueue.length})
                                        </div>
                                        <div className="space-y-1.5">
                                            {flameQueue.length > 0 ? flameQueue.map((d, i) => (
                                                <div key={`flame-${i}`} className="flex items-center gap-2.5 p-2.5 bg-background border border-border rounded-lg group">
                                                    <input type="checkbox" checked={selectedCases.some(c => (c.path || c.name) === (d.path || d.name))} onChange={() => onToggleCase(d.path || d.name)} className="mt-0.5 accent-blue-600 w-4 h-4 cursor-pointer"/>
                                                    <Flame size={15} className="text-amber-500 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs text-foreground/90 font-mono break-all whitespace-normal leading-relaxed pr-2" title={getQueuePath(d)}>
                                                            {getQueueDisplayName(d)}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => onRemoveCase && onRemoveCase(d.path || d.name)}
                                                        className="text-muted-foreground hover:text-red-400 p-1 shrink-0"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            )) : (
                                                <span className="block text-xs text-muted-foreground px-1 py-1.5">No flame files in queue.</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-border/80 bg-background/25 p-2.5">
                                        <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            <Droplets size={13} className="text-cyan-400" />
                                            Concentration Queue ({concentrationQueue.length})
                                        </div>
                                        <div className="space-y-1.5">
                                            {concentrationQueue.length > 0 ? concentrationQueue.map((d, i) => (
                                                <div key={`concentration-${i}`} className="flex items-center gap-2.5 p-2.5 bg-background border border-border rounded-lg group">
                                                    <input type="checkbox" checked={selectedCases.some(c => (c.path || c.name) === (d.path || d.name))} onChange={() => onToggleCase(d.path || d.name)} className="mt-0.5 accent-blue-600 w-4 h-4 cursor-pointer"/>
                                                    <Droplets size={15} className="text-cyan-400 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs text-foreground/90 font-mono break-all whitespace-normal leading-relaxed pr-2" title={getQueuePath(d)}>
                                                            {getQueueDisplayName(d)}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => onRemoveCase && onRemoveCase(d.path || d.name)}
                                                        className="text-muted-foreground hover:text-red-400 p-1 shrink-0"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            )) : (
                                                <span className="block text-xs text-muted-foreground px-1 py-1.5">No concentration files in queue.</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <span className="text-xs text-muted-foreground">No experiment in queue.</span>
                            )}
                        </div>
                    </div>
                    {showSimulationSection && (
                        <div className="bg-card/60 border border-border p-6 rounded-xl flex flex-col h-full overflow-hidden shadow-sm">
                            <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                                <Layers size={20} className="text-primary" />
                                CFD Simulations Data
                            </h2>
                            <button
                                onClick={onOpenSimPicker}
                                className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:border-primary/60 hover:bg-primary/20 transition mb-2 self-start"
                            >
                                <Import size={16} /> Select Import Folder
                            </button>
                            <p className="mt-1 text-xs text-muted-foreground">Choose the CFD case folder to load pressure fields.</p>
                            <div className="mt-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                                        <Database size={14} className="text-primary" /> Case Selector
                                    </div>
                                    <select
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === "__all__") {
                                                runSelectAll(simCaseFiles, 'simulation', e);
                                                return;
                                            }
                                            onSelectionChange(e, 'simulation');
                                        }}
                                        className="w-full p-2.5 bg-background border border-border rounded-md text-xs text-foreground outline-none focus:border-ring"
                                    >
                                        <option value="">Choose Case to Activate...</option>
                                        {simCaseFiles.length > 0 && <option value="__all__">Select All</option>}
                                        {simCaseFiles.map((f, i) => {
                                            let rel = f.webkitRelativePath || f.path || '';
                                            let caseName = '';
                                            if (f.path || f.name) {
                                                caseName = formatName(f.path || f.name);
                                            }
                                            let display = '';
                                            const postProcIdx = rel.indexOf('postProcessing/');
                                            if (postProcIdx !== -1) {
                                                let after = rel.substring(postProcIdx + 'postProcessing/'.length);
                                                const afterParts = after.split('/');
                                                if (afterParts.length > 1 && caseName && afterParts[0] === caseName) {
                                                    display = 'postProcessing/' + afterParts.slice(1).join('/');
                                                } else {
                                                    display = 'postProcessing/' + after;
                                                }
                                            } else {
                                                const pTProbesIdx2 = rel.indexOf('pTProbes/');
                                                display = pTProbesIdx2 !== -1 ? rel.substring(pTProbesIdx2) : rel;
                                            }
                                            return (
                                                <option key={i} value={f.webkitRelativePath || f.path}>
                                                    {caseName ? caseName + ' — ' : ''}{display}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                            </div>
                            <div className="mt-6 flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                                <h3 className="text-base font-semibold text-foreground mb-2">Imported Data Queue</h3>
                                {simulationData.length > 0 ? simulationData.map((s, i) => (
                                    <div key={i} className="flex items-center gap-3 p-4 bg-background border border-border rounded-xl group">
                                        <input type="checkbox" checked={selectedCases.some(c => c.path === s.path)} onChange={() => onToggleCase(s.path)} className="accent-blue-600 w-4 h-4 cursor-pointer"/>
                                        <Database size={16} className="text-primary" />
                                        <div className="flex-1 text-xs text-foreground/80 font-mono break-all whitespace-normal leading-relaxed">{formatName(s.path || s.name)}</div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (onRemoveCase) {
                                                    const id = s.path || s.name;
                                                    console.log('Remove case:', id, s);
                                                    onRemoveCase(id);
                                                }
                                            }}
                                            className="text-muted-foreground hover:text-red-400 p-1"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                )) : (
                                    <span className="text-xs text-muted-foreground">No CFD simulation in queue.</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </>
    );
};

export default ImportDataPage;
