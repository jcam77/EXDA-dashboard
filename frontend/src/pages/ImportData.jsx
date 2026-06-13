import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, FileText, Database, FlaskConical, Activity, Flame, Layers, Import, Droplets, ChevronRight, ChevronDown } from 'lucide-react';
import { isSimulationCaseFile } from '../features/workspace/dataImportRules';

const ImportDataPage = (props) => {
    const { 
        apiBaseUrl = '',
        projectPath = '',
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
    const getPathKey = (item) => String(item?.path || item?.name || "");
    const getExtension = (item) => {
        const raw = getPathKey(item);
        const ext = raw.includes('.') ? raw.split('.').pop() : '';
        return String(ext || '').toLowerCase();
    };

    const inspectorCandidates = (() => {
        const supported = new Set(['csv', 'txt', 'dat', 'asc', 'ascii', 'mf4', 'tpc5']);
        const candidateMap = new Map();
        const addCandidate = (item, source) => {
            const key = getPathKey(item);
            if (!key) return;
            const ext = getExtension(item);
            if (!supported.has(ext)) return;
            if (!candidateMap.has(key)) {
                candidateMap.set(key, {
                    path: key,
                    name: getQueueDisplayName(item),
                    source,
                    type: String(item?.type || source),
                });
            }
        };

        expQueue.forEach((item) => addCandidate(item, 'experiment'));
        simulationData.forEach((item) => addCandidate(item, 'simulation'));

        return Array.from(candidateMap.values()).sort((a, b) => a.path.localeCompare(b.path));
    })();

    const [inspectorPath, setInspectorPath] = useState('');
    const [inspectionBusy, setInspectionBusy] = useState(false);
    const [inspectionError, setInspectionError] = useState('');
    const [batchResults, setBatchResults] = useState({});
    const [collapsedInspectors, setCollapsedInspectors] = useState({});

    useEffect(() => {
        if (!inspectorCandidates.length) {
            setInspectorPath('');
            setInspectionError('');
            setBatchResults({});
            setCollapsedInspectors({});
            return;
        }
        if (!inspectorPath || !inspectorCandidates.some((entry) => entry.path === inspectorPath)) {
            setInspectorPath(inspectorCandidates[0].path);
        }
    }, [inspectorCandidates, inspectorPath]);

    const readStructureForPath = useCallback(
        async (path) => {
            const query = new URLSearchParams({
                projectPath: projectPath || '',
                path,
            });
            const res = await fetch(`${apiBaseUrl}/inspect_project_file_structure?${query.toString()}`);
            const payload = await res.json();
            if (!res.ok || !payload?.success) {
                throw new Error(payload?.error || `Inspection failed (${res.status})`);
            }
            return payload.inspection;
        },
        [apiBaseUrl, projectPath]
    );

    const summarizeTimeVectorState = (summary) => {
        const hasVector = Number(summary?.samples) > 1;
        const strict = summary?.strictlyIncreasing === true;
        const noDuplicates = Number(summary?.duplicates || 0) === 0;
        if (hasVector && strict && noDuplicates) return 'PASS';
        if (!hasVector) return 'N/A';
        return 'CHECK';
    };

    const formatPreviewCell = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return 'N/A';
        if (num === 0) return '0';
        const abs = Math.abs(num);
        if (abs >= 1000 || abs < 1e-3) return num.toExponential(6);
        return num.toFixed(6);
    };

    const inspectSelectedFile = useCallback(async () => {
        if (!inspectorPath) return;
        if (!apiBaseUrl || !projectPath) {
            setInspectionError('Inspector requires an active project and backend connection.');
            return;
        }
        setInspectionBusy(true);
        setInspectionError('');
        try {
            const inspection = await readStructureForPath(inspectorPath);
            setBatchResults((prev) => ({
                ...prev,
                [inspectorPath]: {
                    ok: true,
                    inspection,
                    checkedAt: new Date().toISOString(),
                },
            }));
            setCollapsedInspectors((prev) => ({ ...prev, [inspectorPath]: false }));
        } catch (error) {
            const message = error?.message || 'Failed to inspect selected file.';
            setInspectionError(message);
            setBatchResults((prev) => ({
                ...prev,
                [inspectorPath]: {
                    ok: false,
                    error: message,
                    checkedAt: new Date().toISOString(),
                },
            }));
            setCollapsedInspectors((prev) => ({ ...prev, [inspectorPath]: false }));
        } finally {
            setInspectionBusy(false);
        }
    }, [apiBaseUrl, inspectorPath, projectPath, readStructureForPath]);

    const inspectAllQueuedFiles = useCallback(async () => {
        if (!inspectorCandidates.length) return;
        if (!apiBaseUrl || !projectPath) {
            setInspectionError('Inspector requires an active project and backend connection.');
            return;
        }
        setInspectionBusy(true);
        setInspectionError('');
        const nextResults = {};
        for (const entry of inspectorCandidates) {
            try {
                const inspection = await readStructureForPath(entry.path);
                nextResults[entry.path] = {
                    ok: true,
                    inspection,
                    checkedAt: new Date().toISOString(),
                };
            } catch (error) {
                nextResults[entry.path] = {
                    ok: false,
                    error: error?.message || 'Inspection failed',
                    checkedAt: new Date().toISOString(),
                };
            }
        }
        setBatchResults(nextResults);
        setCollapsedInspectors((prev) => {
            const next = {};
            inspectorCandidates.forEach((entry) => {
                next[entry.path] = Object.prototype.hasOwnProperty.call(prev, entry.path)
                    ? !!prev[entry.path]
                    : false;
            });
            return next;
        });
        setInspectionBusy(false);
    }, [apiBaseUrl, inspectorCandidates, inspectorPath, projectPath, readStructureForPath]);

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

    const inspectedEntries = inspectorCandidates.filter((entry) => !!batchResults[entry.path]);
    const allInspectedExpanded = inspectedEntries.length > 0 && inspectedEntries.every((entry) => collapsedInspectors[entry.path] === false);
    const allInspectedCollapsed = inspectedEntries.length > 0 && inspectedEntries.every((entry) => collapsedInspectors[entry.path] === true);

    const setAllInspectorsCollapsed = (collapsed) => {
        const next = {};
        inspectedEntries.forEach((entry) => {
            next[entry.path] = collapsed;
        });
        setCollapsedInspectors((prev) => ({ ...prev, ...next }));
    };

    const toggleInspectorCollapse = (path) => {
        setCollapsedInspectors((prev) => ({ ...prev, [path]: !prev[path] }));
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
                                    <li>Projects/XXXX-Project/Raw_Data/XXXX-01-01/DAQ-1/DAQ-1-XXXX-01-01.tpc5</li>
                                    <li>Projects/XXXX-Project/Raw_Data/XXXX-01-01/DAQ-2/DAQ-2-XXXX-01-01.mf4</li>
                                    <li>Projects/XXXX-Project/Raw_Data/XXXX-01-01/H2BGA/H2BGA-U-M-L-XXXX-01-01.csv</li>
                                </ul>
                            </div>
                            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Filename Convention</div>
                                <div className="mt-1 text-[11px] text-zinc-300 font-mono break-all">
                                    &lt;DAQ&gt;-&lt;Run&gt;.&lt;ext&gt;
                                </div>
                                <div className="mt-2 text-[11px] text-zinc-400">
                                    Recommended examples:
                                </div>
                                <ul className="mt-1 space-y-1 text-[11px] text-zinc-300 font-mono">
                                    <li>DAQ-1-XXXX-01-01.tpc5</li>
                                    <li>DAQ-2-XXXX-01-01.mf4</li>
                                    <li>H2BGA-U-M-L-XXXX-01-01.csv</li>
                                </ul>
                                <div className="mt-2 text-[11px] text-zinc-400">
                                    H2BGA legend (sampling point location in chamber): <span className="font-mono">U</span>=Upper, <span className="font-mono">M</span>=Middle, <span className="font-mono">L</span>=Lower
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
                <div className="mt-6 rounded-xl border border-border bg-card/50 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <FileText size={18} className="text-primary" />
                            <h3 className="text-base font-semibold text-foreground">Data Structure Inspector</h3>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Verifies parser structure and time vectors per queued file.
                        </div>
                    </div>

                    {inspectorCandidates.length === 0 ? (
                        <div className="mt-3 text-xs text-muted-foreground">
                            No compatible files in queue yet. Add `csv/txt/dat/asc/mf4/tpc5` files to inspect.
                        </div>
                    ) : (
                        <>
                            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-end">
                                <div className="lg:col-span-8">
                                    <div className="mb-1 text-xs font-semibold text-muted-foreground">Queued File</div>
                                    <select
                                        value={inspectorPath}
                                        onChange={(e) => {
                                            setInspectorPath(e.target.value);
                                            setInspectionError('');
                                        }}
                                        className="w-full rounded-md border border-border bg-background p-2.5 text-xs text-foreground outline-none"
                                    >
                                        {inspectorCandidates.map((entry) => (
                                            <option key={entry.path} value={entry.path}>
                                                {entry.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="lg:col-span-2">
                                    <button
                                        type="button"
                                        onClick={inspectSelectedFile}
                                        disabled={inspectionBusy}
                                        className="w-full rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition hover:border-primary/60 hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {inspectionBusy ? 'Inspecting…' : 'Inspect File'}
                                    </button>
                                </div>
                                <div className="lg:col-span-2">
                                    <button
                                        type="button"
                                        onClick={inspectAllQueuedFiles}
                                        disabled={inspectionBusy}
                                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        Verify All
                                    </button>
                                </div>
                            </div>

                            {inspectionError ? (
                                <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                                    {inspectionError}
                                </div>
                            ) : null}

                            {Object.keys(batchResults).length > 0 ? (
                                <div className="mt-3 rounded-lg border border-border/80 bg-background/30 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div className="text-xs font-semibold text-muted-foreground">Time Vector Verification Summary</div>
                                        {inspectedEntries.length > 0 ? (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setAllInspectorsCollapsed(false)}
                                                    disabled={allInspectedExpanded}
                                                    className="rounded border border-border px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
                                                >
                                                    Expand all
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setAllInspectorsCollapsed(true)}
                                                    disabled={allInspectedCollapsed}
                                                    className="rounded border border-border px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
                                                >
                                                    Collapse all
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1 text-xs">
                                        {inspectorCandidates.map((entry) => {
                                            const result = batchResults[entry.path];
                                            const status = result?.ok
                                                ? summarizeTimeVectorState(result.inspection?.timeSummary)
                                                : (result ? 'ERROR' : 'PENDING');
                                            const statusClass = status === 'PASS'
                                                ? 'text-emerald-400'
                                                : status === 'CHECK' || status === 'ERROR'
                                                    ? 'text-amber-300'
                                                    : 'text-muted-foreground';
                                            return (
                                                <div key={`status-${entry.path}`} className="flex items-center justify-between gap-3 rounded border border-border/60 px-2.5 py-1.5">
                                                    <div className="truncate text-foreground/90 font-mono" title={entry.path}>
                                                        {entry.name}
                                                    </div>
                                                    <div className={`font-semibold ${statusClass}`}>{status}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}

                            {inspectedEntries.length > 0 ? (
                                <div className="mt-3 space-y-2">
                                    {inspectedEntries.map((entry) => {
                                        const result = batchResults[entry.path];
                                        const inspection = result?.ok ? result.inspection : null;
                                        const isCollapsed = !!collapsedInspectors[entry.path];
                                        const status = result?.ok
                                            ? summarizeTimeVectorState(inspection?.timeSummary)
                                            : 'ERROR';
                                        const statusClass = status === 'PASS'
                                            ? 'text-emerald-400'
                                            : status === 'CHECK' || status === 'ERROR'
                                                ? 'text-amber-300'
                                                : 'text-muted-foreground';

                                        return (
                                            <div key={`inspection-card-${entry.path}`} className="rounded-lg border border-border/80 bg-background/35 p-3 text-xs">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleInspectorCollapse(entry.path)}
                                                    className="w-full flex items-center justify-between gap-2 text-left"
                                                >
                                                    <div className="min-w-0 flex items-center gap-2">
                                                        {isCollapsed ? <ChevronRight size={13} className="text-muted-foreground shrink-0" /> : <ChevronDown size={13} className="text-muted-foreground shrink-0" />}
                                                        <span className="font-semibold text-foreground truncate" title={entry.path}>{entry.name}</span>
                                                    </div>
                                                    <span className={`shrink-0 font-semibold ${statusClass}`}>{status}</span>
                                                </button>
                                                {!isCollapsed ? (
                                                    result?.ok && inspection ? (
                                                        <>
                                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground">
                                                                <span>{inspection.parser}</span>
                                                                <span>•</span>
                                                                <span>{inspection.channelCount} channels</span>
                                                                <span>•</span>
                                                                <span>{inspection.timeSummary?.samples || 0} samples</span>
                                                            </div>
                                                            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                                                                <div className="rounded border border-border/70 bg-background px-2 py-1.5">
                                                                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Time Vector</div>
                                                                    <div className="mt-0.5 font-semibold text-foreground">{summarizeTimeVectorState(inspection.timeSummary)}</div>
                                                                </div>
                                                                <div className="rounded border border-border/70 bg-background px-2 py-1.5">
                                                                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sample Rate (Hz)</div>
                                                                    <div className="mt-0.5 font-semibold text-foreground">
                                                                        {Number.isFinite(Number(inspection.timeSummary?.estimatedSampleRateHz))
                                                                            ? Number(inspection.timeSummary.estimatedSampleRateHz).toFixed(3)
                                                                            : 'N/A'}
                                                                    </div>
                                                                </div>
                                                                <div className="rounded border border-border/70 bg-background px-2 py-1.5">
                                                                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Duration (s)</div>
                                                                    <div className="mt-0.5 font-semibold text-foreground">
                                                                        {Number.isFinite(Number(inspection.timeSummary?.durationSeconds))
                                                                            ? Number(inspection.timeSummary.durationSeconds).toFixed(6)
                                                                            : 'N/A'}
                                                                    </div>
                                                                </div>
                                                                <div className="rounded border border-border/70 bg-background px-2 py-1.5">
                                                                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Duplicates</div>
                                                                    <div className="mt-0.5 font-semibold text-foreground">
                                                                        {Number(inspection.timeSummary?.duplicates || 0)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {inspection.preview && Array.isArray(inspection.preview.columns) && Array.isArray(inspection.preview.rows) ? (
                                                                <div className="mt-3">
                                                                    <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                                                                        Sample Preview (first {Number(inspection.preview.shownRows || inspection.preview.rows.length || 0)} / {Number(inspection.preview.rowCount || inspection.preview.rows.length || 0)} rows)
                                                                    </div>
                                                                    <div className="max-h-44 overflow-auto rounded border border-border/70">
                                                                        <table className="w-full border-collapse text-xs">
                                                                            <thead className="bg-background/80 text-muted-foreground">
                                                                                <tr>
                                                                                    {inspection.preview.columns.map((columnName, colIdx) => (
                                                                                        <th key={`preview-col-${entry.path}-${colIdx}`} className="border-b border-border px-2 py-1 text-left font-mono">
                                                                                            {columnName}
                                                                                        </th>
                                                                                    ))}
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {inspection.preview.rows.map((row, rowIdx) => (
                                                                                    <tr key={`preview-row-${entry.path}-${rowIdx}`} className="odd:bg-background/25">
                                                                                        {row.map((cell, cellIdx) => (
                                                                                            <td key={`preview-cell-${entry.path}-${rowIdx}-${cellIdx}`} className="border-b border-border/60 px-2 py-1 font-mono">
                                                                                                {formatPreviewCell(cell)}
                                                                                            </td>
                                                                                        ))}
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                </div>
                                                            ) : null}
                                                            {Array.isArray(inspection.channels) && inspection.channels.length > 0 ? (
                                                                <div className="mt-3">
                                                                    <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Channels</div>
                                                                    <div className="max-h-48 overflow-y-auto rounded border border-border/70">
                                                                        <table className="w-full border-collapse text-xs">
                                                                            <thead className="bg-background/80 text-muted-foreground">
                                                                                <tr>
                                                                                    <th className="border-b border-border px-2 py-1 text-left">#</th>
                                                                                    <th className="border-b border-border px-2 py-1 text-left">Name</th>
                                                                                    <th className="border-b border-border px-2 py-1 text-left">Samples</th>
                                                                                    <th className="border-b border-border px-2 py-1 text-left">Rate (Hz)</th>
                                                                                    <th className="border-b border-border px-2 py-1 text-left">Min</th>
                                                                                    <th className="border-b border-border px-2 py-1 text-left">Max</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {inspection.channels.map((channel) => (
                                                                                    <tr key={`channel-${inspection.fileName}-${channel.index}`} className="odd:bg-background/25">
                                                                                        <td className="border-b border-border/60 px-2 py-1">{Number(channel.index) + 1}</td>
                                                                                        <td className="border-b border-border/60 px-2 py-1 font-mono">{channel.name}</td>
                                                                                        <td className="border-b border-border/60 px-2 py-1">{channel.samples}</td>
                                                                                        <td className="border-b border-border/60 px-2 py-1">
                                                                                            {Number.isFinite(Number(channel.sampleRateHz))
                                                                                                ? Number(channel.sampleRateHz).toFixed(3)
                                                                                                : 'N/A'}
                                                                                        </td>
                                                                                        <td className="border-b border-border/60 px-2 py-1">
                                                                                            {Number.isFinite(Number(channel?.stats?.min))
                                                                                                ? Number(channel.stats.min).toFixed(4)
                                                                                                : 'N/A'}
                                                                                        </td>
                                                                                        <td className="border-b border-border/60 px-2 py-1">
                                                                                            {Number.isFinite(Number(channel?.stats?.max))
                                                                                                ? Number(channel.stats.max).toFixed(4)
                                                                                                : 'N/A'}
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                </div>
                                                            ) : null}
                                                        </>
                                                    ) : (
                                                        <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                                                            {result?.error || 'Inspection failed for this file.'}
                                                        </div>
                                                    )
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            </>
    );
};

export default ImportDataPage;
