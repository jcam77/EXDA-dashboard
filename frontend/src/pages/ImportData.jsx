import React from 'react';
import { Trash2, FileText, Database, FlaskConical, FolderOpen, Activity, Flame, Upload, Layers,Import } from 'lucide-react';
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

    const simCaseFiles = Array.isArray(sessionFiles) ? sessionFiles.filter(isSimulationCaseFile) : [];

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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* EXPERIMENTS CARD */}
                    <div className="bg-card/60 border border-border p-6 rounded-xl flex flex-col h-full overflow-hidden shadow-2xl">
                        <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                            <FlaskConical size={20} className="text-primary" />
                            Experiments Data
                        </h2>
                        <button
                            onClick={onOpenExpPicker}
                            className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:border-primary/60 hover:bg-primary/20 transition mb-2 self-start"
                        >
                            <Import size={16} /> Select Import Folder
                        </button>
                        <p className="mt-1 text-xs text-muted-foreground">Select the folder containing experimental data files (CSV/TXT/DAT/MF4) for Pressure and Flame.</p>
                        <div className="mt-4 grid grid-cols-2 gap-4">
                            <div className="space-y-2">
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
                            <div className="space-y-2">
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
                        </div>
                        <div className="mt-6 flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                            <h3 className="text-base font-semibold text-foreground mb-2">Imported Data Queue</h3>
                            {Array.isArray(experimentalData) && experimentalData.length > 0 ? (
                                experimentalData.map((d, i) => (
                                    <div key={i} className="flex items-center gap-3 p-4 bg-background border border-border rounded-xl group">
                                        <input type="checkbox" checked={selectedCases.some(c => (c.path || c.name) === (d.path || d.name))} onChange={() => onToggleCase(d.path || d.name)} className="accent-blue-600 w-4 h-4 cursor-pointer"/>
                                        {d.type === 'flame' ? (
                                            <Flame size={16} className="text-amber-500" />
                                        ) : (
                                            <Activity size={16} className="text-red-500" />
                                        )}
                                        <div className="flex-1 text-xs text-foreground/80 truncate font-mono">
                                            {formatName(d.name)}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onRemoveCase && onRemoveCase(d.path || d.name)}
                                            className="text-muted-foreground hover:text-red-400 p-1"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))
                            ) : (
                                <span className="text-xs text-muted-foreground">No experiment in queue.</span>
                            )}
                        </div>
                    </div>
                    {/* SIMULATIONS CARD */}
                    <div className="bg-card/60 border border-border p-6 rounded-xl flex flex-col h-full overflow-hidden shadow-2xl">
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
                                        // Extract case name using the same logic as the queue (from the path or name)
                                        let caseName = '';
                                        if (f.path || f.name) {
                                            caseName = formatName(f.path || f.name);
                                        }
                                        // Build display: postProcessing/pTProbes/probe/p (omit case name after postProcessing)
                                        let display = '';
                                        const postProcIdx = rel.indexOf('postProcessing/');
                                        if (postProcIdx !== -1) {
                                            let after = rel.substring(postProcIdx + 'postProcessing/'.length);
                                            const afterParts = after.split('/');
                                            // Remove the case name if present
                                            if (afterParts.length > 1 && caseName && afterParts[0] === caseName) {
                                                display = 'postProcessing/' + afterParts.slice(1).join('/');
                                            } else {
                                                display = 'postProcessing/' + after;
                                            }
                                        } else {
                                            // fallback: show from pTProbes
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
                                    <div className="flex-1 text-xs text-foreground/80 truncate font-mono">{formatName(s.path || s.name)}</div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (onRemoveCase) {
                                                // Try both s.path and s.name for robustness
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
                </div>
            </>
    );
};

export default ImportDataPage;
