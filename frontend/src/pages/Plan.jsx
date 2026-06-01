import React, { useCallback, useEffect, useRef, useState } from 'react';
import { 
    Save, Upload, Plus, CheckSquare, Square, PenTool, Trash2, Calendar, 
    Clock, Target, GripVertical, Layers, FlaskConical, X, 
    AlertCircle, CheckCircle2, Beaker, Zap, Cpu, TrendingUp, Thermometer, Gauge, ChevronRight, ChevronDown, Wrench, Undo2
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, LabelList } from 'recharts';
import { getBackendBaseUrl } from '../utils/backendUrl';
import UnifiedModal from '../components/UnifiedModal';
import ExportFormatButtons from '../components/ExportFormatButtons';
import { useAppDialog } from '../hooks/useAppDialog';

const RUN_NAME_ORDER_RE = /^(.*)-(\d+)(?:-([Rr])(\d+))?$/;
const RUN_STATUS_COLORS = {
    error: '#dc2626',
    canceled: '#f97316',
    done: 'hsl(var(--primary))',
    planned: '#3f3f46',
};
const IGNITION_PRESET_OPTIONS = [
    'Back Wall',
    'Center',
];
const VENT_PRESET_OPTIONS = [
    'Thin Film with Hotwire Activated',
    'Thin Film with Hotwire NOT Activated',
];
const CUSTOM_OPTION_VALUE = '__custom__';

const parseRunNameOrder = (runName) => {
    const cleanName = String(runName || '').trim();
    const match = cleanName.match(RUN_NAME_ORDER_RE);
    if (!match) {
        return {
            group: cleanName,
            runNumber: Number.POSITIVE_INFINITY,
            repetitionNumber: -1,
            raw: cleanName,
        };
    }
    return {
        group: String(match[1] || '').trim(),
        runNumber: Number.parseInt(match[2], 10),
        repetitionNumber: match[4] ? Number.parseInt(match[4], 10) : -1,
        raw: cleanName,
    };
};

const compareRunNames = (leftName, rightName) => {
    const left = parseRunNameOrder(leftName);
    const right = parseRunNameOrder(rightName);

    const groupCompare = left.group.localeCompare(right.group, undefined, { numeric: true, sensitivity: 'base' });
    if (groupCompare !== 0) return groupCompare;

    if (left.runNumber !== right.runNumber) {
        return left.runNumber - right.runNumber;
    }

    if (left.repetitionNumber !== right.repetitionNumber) {
        return left.repetitionNumber - right.repetitionNumber;
    }

    return left.raw.localeCompare(right.raw, undefined, { numeric: true, sensitivity: 'base' });
};

const PlanPage = ({ 
    experiments = [], 
    setExperiments, 
    planName, 
    setPlanName, 
    planMeta = { objective: "", description: "", startDate: "", deadline: "" },
    setPlanMeta,
    onSave, 
    onImport,
    projectPath = ""
}) => {
    const apiBaseUrl = getBackendBaseUrl();
    const { dialogModal, setDialogModal, showAlert } = useAppDialog();
    const [input, setInput] = useState({ group: "", run: "", h2: "", plannedDate: "", name: "", isPreparation: false });
    const [editingExp, setEditingExp] = useState(null);
    const [createError, setCreateError] = useState("");
    const [editError, setEditError] = useState("");
    const [groupRenameDrafts, setGroupRenameDrafts] = useState({});
    const [groupRenameErrors, setGroupRenameErrors] = useState({});
    const [draggedId, setDraggedId] = useState(null);
    const [draggingScheduleRun, setDraggingScheduleRun] = useState(null);
    const [ignitionEditorMode, setIgnitionEditorMode] = useState('');
    const [ventEditorMode, setVentEditorMode] = useState('');
    const [modalOffset, setModalOffset] = useState({ x: 0, y: 40 });
    const [isModalDragging, setIsModalDragging] = useState(false);
    const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
    const [busyFormat, setBusyFormat] = useState('');
    const [rawDataFiles, setRawDataFiles] = useState([]);
    const [collapsedGroups, setCollapsedGroups] = useState({});
    const [lastDeletedRun, setLastDeletedRun] = useState(null);
    const [folderCheck, setFolderCheck] = useState({ status: 'idle', message: '' });
    const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });
    const scheduleChartAreaRef = useRef(null);
    const scheduleDragRef = useRef({ runName: '', startDay: 1, startX: 0, currentX: 0, moved: false });
    const deleteUndoTimeoutRef = useRef(null);

    // --- ANALYTICS & GATING ---
    const isPreparationRun = useCallback((exp) => !!exp?.meta?.isPreparation, []);
    const isReady = (exp) => {
        if (isPreparationRun(exp)) return true;
        // Gates: Mandatory fields for scientific integrity
        return exp.meta?.h2 && exp.meta?.ignition && exp.meta?.vent && Array.isArray(exp.meta?.dataFiles) && exp.meta.dataFiles.length > 0;
    };

    const getStats = () => {
        const total = experiments.length;
        const done = experiments.filter(e => e.done).length;
        const remaining = total - done;
        const canceled = experiments.filter((e) => !!e?.meta?.isCanceled).length;
        const errors = experiments.filter((e) => !!e?.meta?.hasError).length;
        const preparation = experiments.filter((e) => !!e?.meta?.isPreparation).length;

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
        return { total, done, remaining, canceled, errors, preparation, daysLeft: daysLeft > 0 ? daysLeft : 0, pace, completionPercent };
    };
    
    const stats = getStats();

    const getMissingMeta = (exp) => {
        if (isPreparationRun(exp)) return [];
        const missing = [];
        if (!exp.meta?.h2) missing.push('H2%');
        if (!exp.meta?.ignition) missing.push('Ignition');
        if (!exp.meta?.vent) missing.push('Vent');
        if (!Array.isArray(exp.meta?.dataFiles) || exp.meta.dataFiles.length === 0) missing.push('Data');
        return missing;
    };

    const getRunVisualStatus = useCallback((exp) => {
        if (exp?.meta?.hasError) return 'error';
        if (exp?.meta?.isCanceled) return 'canceled';
        if (exp?.done) return 'done';
        return 'planned';
    }, []);

    // --- CRUD ---
    const syncRunFolders = useCallback(async (runNames = []) => {
        if (!projectPath || !Array.isArray(runNames) || runNames.length === 0) return;
        try {
            const response = await fetch(`${apiBaseUrl}/sync_run_data_folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectPath, runNames })
            });
            const payload = await response.json();
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Could not sync run data folders');
            }
            return payload;
        } catch {
            // Keep UI flow non-blocking even if sync fails.
            return null;
        }
    }, [apiBaseUrl, projectPath]);

    const renameRunFolders = useCallback(async (renamePairs = []) => {
        if (!projectPath || !Array.isArray(renamePairs) || renamePairs.length === 0) return null;
        try {
            const response = await fetch(`${apiBaseUrl}/rename_run_data_folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectPath, renamePairs }),
            });
            const payload = await response.json();
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Could not rename run data folders');
            }
            return payload;
        } catch {
            return null;
        }
    }, [apiBaseUrl, projectPath]);

    const renameRunMetadataReferences = useCallback(async ({ renamePairs = [], oldGroup = "", newGroup = "" } = {}) => {
        if (!projectPath || !Array.isArray(renamePairs) || renamePairs.length === 0) return null;
        try {
            const response = await fetch(`${apiBaseUrl}/rename_run_metadata_references`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectPath,
                    renamePairs,
                    oldGroup: String(oldGroup || '').trim(),
                    newGroup: String(newGroup || '').trim(),
                }),
            });
            const payload = await response.json();
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Could not rename metadata references');
            }
            return payload;
        } catch {
            return null;
        }
    }, [apiBaseUrl, projectPath]);

    const verifyRunFolders = useCallback(async (manual = false) => {
        const runNames = Array.from(new Set(
            experiments
                .map((exp) => String(exp?.name || '').trim())
                .filter(Boolean)
        ));

        if (!projectPath || runNames.length === 0) {
            setFolderCheck({ status: 'idle', message: '' });
            return;
        }

        setFolderCheck((prev) => ({ ...prev, status: 'checking', message: manual ? 'Checking run folders...' : prev.message }));
        const result = await syncRunFolders(runNames);
        if (!result) {
            setFolderCheck({ status: 'error', message: 'Folder verification failed. Try Sync run folders.' });
            return;
        }

        const skippedCount = Array.isArray(result.skipped) ? result.skipped.length : 0;
        const ensuredCount = Array.isArray(result.ensured) ? result.ensured.length : 0;

        if (skippedCount > 0) {
            setFolderCheck({
                status: 'warning',
                message: `Verified ${ensuredCount}/${runNames.length}. ${skippedCount} run name(s) need cleanup.`,
            });
            return;
        }

        setFolderCheck({
            status: 'ok',
            message: `Verified folders for ${ensuredCount} run${ensuredCount === 1 ? '' : 's'}.`,
        });
    }, [experiments, projectPath, syncRunFolders]);

    const filesForRunName = useCallback((runName) => {
        const cleanName = String(runName || '').trim();
        if (!cleanName) return [];
        const prefix = `${cleanName}/`;
        return rawDataFiles.filter((filePath) => String(filePath || '').startsWith(prefix));
    }, [rawDataFiles]);

    const areStringArraysEqual = useCallback((left, right) => {
        if (!Array.isArray(left) || !Array.isArray(right)) return false;
        if (left.length !== right.length) return false;
        for (let idx = 0; idx < left.length; idx += 1) {
            if (String(left[idx]) !== String(right[idx])) return false;
        }
        return true;
    }, []);

    const buildRunName = useCallback((groupValue, runValue) => {
        const cleanGroup = String(groupValue || '').trim().replace(/[/\\]/g, '-');
        const cleanRun = String(runValue || '').trim();
        if (!cleanGroup || !cleanRun) return "";
        const runMatch = cleanRun.match(/^(\d+)(?:\s*-\s*([A-Za-z][A-Za-z0-9_-]*))?$/);
        if (!runMatch) return "";
        const runDigits = runMatch[1];
        const runSuffix = runMatch[2] ? `-${runMatch[2].toUpperCase()}` : "";
        const padded = String(parseInt(runDigits, 10)).padStart(2, '0');
        return `${cleanGroup}-${padded}${runSuffix}`;
    }, []);

    const getRunGroupKey = useCallback((runName) => {
        const cleanName = String(runName || '').trim();
        if (!cleanName) return "GENERAL";
        const familyMatch = cleanName.match(/^(.*)-(\d+)(?:-[Rr]\d+)?$/);
        if (familyMatch && familyMatch[1]) {
            return familyMatch[1];
        }
        const mixtureMatch = cleanName.match(/(\d+(?:\.\d+)?)\s*pctv/i);
        if (mixtureMatch) {
            return `${mixtureMatch[1]}%VOL`;
        }
        return "GENERAL";
    }, []);

    const ymdToOrdinal = useCallback((rawDate) => {
        const value = String(rawDate || '').trim();
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const year = Number.parseInt(match[1], 10);
        const month = Number.parseInt(match[2], 10);
        const day = Number.parseInt(match[3], 10);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
        return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
    }, []);

    const ordinalToYmd = useCallback((ordinal) => {
        if (!Number.isFinite(ordinal)) return null;
        const dateObj = new Date(ordinal * 86400000);
        const year = dateObj.getUTCFullYear();
        const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }, []);

    const getScheduleBaseDateRaw = useCallback(() => {
        const candidates = [
            String(planMeta?.startDate || '').trim(),
            ...experiments.map((exp) => String(exp?.meta?.plannedDate || '').trim()),
        ].filter(Boolean);
        if (!candidates.length) return "";

        const ordinals = candidates
            .map((raw) => ymdToOrdinal(raw))
            .filter((ord) => Number.isFinite(ord));
        if (!ordinals.length) return "";
        const minOrdinal = Math.min(...ordinals);
        return ordinalToYmd(minOrdinal) || "";
    }, [experiments, planMeta?.startDate, ymdToOrdinal, ordinalToYmd]);

    const getPlannedDay = useCallback((exp, fallbackIndex) => {
        const plannedDateRaw = String(exp?.meta?.plannedDate || '').trim();
        const baseDateRaw = getScheduleBaseDateRaw();
        const plannedOrdinal = ymdToOrdinal(plannedDateRaw);
        const baseOrdinal = ymdToOrdinal(baseDateRaw);
        if (Number.isFinite(plannedOrdinal) && Number.isFinite(baseOrdinal)) {
            const diffDays = plannedOrdinal - baseOrdinal;
            if (diffDays >= 0) return diffDays + 1;
        }
        const raw = String(exp?.meta?.plannedDay ?? '').trim();
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        return fallbackIndex + 1;
    }, [getScheduleBaseDateRaw, ymdToOrdinal]);

    const formatRunSchedule = useCallback((exp) => {
        const plannedDate = String(exp?.meta?.plannedDate || '').trim();
        if (plannedDate) return plannedDate;
        const plannedDay = String(exp?.meta?.plannedDay || '').trim();
        return plannedDay ? `D${plannedDay}` : '';
    }, []);

    const normalizeRunName = useCallback((value) => String(value || '').trim().toLowerCase(), []);
    const isDuplicateRunName = useCallback((candidateName, ignoreId = null) => {
        const normalized = normalizeRunName(candidateName);
        if (!normalized) return false;
        return experiments.some((exp) => {
            if (ignoreId !== null && exp.id === ignoreId) return false;
            return normalizeRunName(exp.name) === normalized;
        });
    }, [experiments, normalizeRunName]);

    const renameGroupRuns = useCallback(async (groupName) => {
        const requestedName = String(groupRenameDrafts[groupName] ?? groupName).trim().replace(/[/\\]/g, '-');
        if (!requestedName) {
            setGroupRenameErrors((prev) => ({ ...prev, [groupName]: "Group name cannot be empty." }));
            return;
        }
        if (requestedName === groupName) {
            setGroupRenameErrors((prev) => ({ ...prev, [groupName]: "" }));
            return;
        }

        const affected = experiments.filter((exp) => getRunGroupKey(exp.name) === groupName);
        if (!affected.length) return;

        const generatedNames = affected.map((exp, index) => {
            const raw = String(exp.name || '').trim();
            const match = raw.match(/-(\d+(?:-[Rr]\d+)?)$/);
            const fallback = String(index + 1).padStart(2, '0');
            const tail = match ? String(match[1]).replace(/-r/i, '-R') : fallback;
            return `${requestedName}-${tail}`;
        });

        const generatedLower = generatedNames.map((name) => normalizeRunName(name));
        const hasInternalCollision = new Set(generatedLower).size !== generatedLower.length;
        if (hasInternalCollision) {
            setGroupRenameErrors((prev) => ({ ...prev, [groupName]: "Rename would create duplicate run names inside this group." }));
            return;
        }

        const otherRuns = experiments.filter((exp) => getRunGroupKey(exp.name) !== groupName);
        const hasExternalCollision = generatedNames.some((name) => otherRuns.some((exp) => normalizeRunName(exp.name) === normalizeRunName(name)));
        if (hasExternalCollision) {
            setGroupRenameErrors((prev) => ({ ...prev, [groupName]: "Rename would conflict with run names from another group." }));
            return;
        }

        const renameMap = new Map();
        affected.forEach((exp, index) => {
            renameMap.set(exp.id, generatedNames[index]);
        });

        const renamePairs = affected.map((exp, index) => ({
            oldName: String(exp?.name || '').trim(),
            newName: String(generatedNames[index] || '').trim(),
        }));

        const remapRunFilePath = (filePath, oldRunName, newRunName) => {
            const file = String(filePath || '');
            const oldPrefix = `${String(oldRunName || '').trim()}/`;
            const newPrefix = `${String(newRunName || '').trim()}/`;
            if (!oldPrefix.trim() || !newPrefix.trim()) return file;
            if (file === String(oldRunName || '').trim()) return String(newRunName || '').trim();
            return file.startsWith(oldPrefix) ? `${newPrefix}${file.slice(oldPrefix.length)}` : file;
        };

        setExperiments((prev) => prev.map((exp) => (
            renameMap.has(exp.id)
                ? (() => {
                    const oldName = String(exp?.name || '').trim();
                    const newName = String(renameMap.get(exp.id) || '').trim();
                    const currentFiles = Array.isArray(exp?.meta?.dataFiles) ? exp.meta.dataFiles : [];
                    const remappedFiles = currentFiles.map((filePath) => remapRunFilePath(filePath, oldName, newName));
                    return {
                        ...exp,
                        name: newName,
                        meta: {
                            ...(exp.meta || {}),
                            dataFiles: remappedFiles,
                        },
                    };
                })()
                : exp
        )));

        setPlanMeta((prev) => {
            const previous = prev && typeof prev === 'object' ? prev : {};
            const objectives = previous.groupObjectives && typeof previous.groupObjectives === 'object'
                ? { ...previous.groupObjectives }
                : {};
            if (Object.prototype.hasOwnProperty.call(objectives, groupName)) {
                objectives[requestedName] = objectives[groupName];
                delete objectives[groupName];
            }
            return { ...previous, groupObjectives: objectives };
        });

        setGroupRenameErrors((prev) => ({ ...prev, [groupName]: "" }));
        setGroupRenameDrafts((prev) => {
            const next = { ...prev };
            delete next[groupName];
            next[requestedName] = requestedName;
            return next;
        });

        const renameResult = await renameRunFolders(renamePairs);
        if (renameResult && Array.isArray(renameResult.conflicts) && renameResult.conflicts.length > 0) {
            setFolderCheck({
                status: 'warning',
                message: `Some run folder renames conflicted (${renameResult.conflicts.length}). Review folder names and retry.`,
            });
        }
        const metadataResult = await renameRunMetadataReferences({
            renamePairs,
            oldGroup: groupName,
            newGroup: requestedName,
        });
        if (!metadataResult) {
            setFolderCheck({
                status: 'warning',
                message: 'Run names were updated, but metadata references (Gas Mixing/Sensors Mapping) could not be auto-renamed. Please reopen those tabs to verify.',
            });
        }
        await syncRunFolders(generatedNames);
    }, [experiments, getRunGroupKey, groupRenameDrafts, normalizeRunName, renameRunFolders, renameRunMetadataReferences, setExperiments, setPlanMeta, syncRunFolders]);

    const addExp = async () => {
        const manualRunName = String(input.name || '').trim();
        const generatedRunName = buildRunName(input.group, input.run);
        const runName = manualRunName || generatedRunName;
        if (!runName) {
            setCreateError("Run name is required.");
            return;
        }
        if (isDuplicateRunName(runName)) {
            setCreateError(`Run name "${runName}" already exists. Use a unique name.`);
            return;
        }
        setCreateError("");
        setExperiments([...experiments, {
            id: Date.now(),
            name: runName,
            done: false,
            meta: {
                h2: String(input.h2 || "").trim(),
                plannedDate: String(input.plannedDate || "").trim(),
                isPreparation: !!input.isPreparation,
                hasError: false,
                errorNote: "",
                isCanceled: false,
                canceledNote: "",
                shortDescription: "",
                p0: "101325",
                t0: "293",
                ignition: "",
                vent: "",
                cfdHash: "",
                // Keep associated files opt-in; user selects explicitly in Run Metadata Card.
                dataFiles: []
            }
        }]);
        setInput((prev) => ({ ...prev, run: "", name: "", isPreparation: false }));
        await syncRunFolders([runName]);
    };

    const saveEdit = async () => {
        if (editingExp) {
            const editedRunName = String(editingExp.name || '').trim();
            if (!editedRunName) {
                setEditError("Run name is required.");
                return;
            }
            if (isDuplicateRunName(editedRunName, editingExp.id)) {
                setEditError(`Run name "${editedRunName}" already exists. Use a unique name.`);
                return;
            }
            setEditError("");
            const current = Array.isArray(editingExp.meta?.dataFiles) ? editingExp.meta.dataFiles : [];
            const runScoped = new Set(filesForRunName(editingExp.name));
            // Respect user selection: keep only checked files that belong to this run folder.
            const selected = current.filter((filePath) => runScoped.has(filePath));
            const updatedEditingExp = {
                ...editingExp,
                meta: {
                    ...(editingExp.meta || {}),
                    dataFiles: selected
                }
            };
            setExperiments(experiments.map(e => e.id === updatedEditingExp.id ? updatedEditingExp : e));
            const runName = String(editingExp.name || '').trim();
            setEditingExp(null);
            if (runName) {
                await syncRunFolders([runName]);
            }
        }
    };

    const clearDeleteUndoTimeout = useCallback(() => {
        if (deleteUndoTimeoutRef.current) {
            clearTimeout(deleteUndoTimeoutRef.current);
            deleteUndoTimeoutRef.current = null;
        }
    }, []);

    const queueDeleteUndoExpiry = useCallback(() => {
        clearDeleteUndoTimeout();
        deleteUndoTimeoutRef.current = setTimeout(() => {
            setLastDeletedRun(null);
            deleteUndoTimeoutRef.current = null;
        }, 12000);
    }, [clearDeleteUndoTimeout]);

    const removeRunWithUndo = useCallback((runId) => {
        const index = experiments.findIndex((item) => item.id === runId);
        if (index < 0) return;
        const removed = experiments[index];
        setExperiments(experiments.filter((item) => item.id !== runId));
        setLastDeletedRun({
            experiment: removed,
            index,
        });
        queueDeleteUndoExpiry();
    }, [experiments, queueDeleteUndoExpiry, setExperiments]);

    const undoDeletedRun = useCallback(() => {
        if (!lastDeletedRun?.experiment) return;
        const { experiment, index } = lastDeletedRun;
        setExperiments((previous) => {
            if (previous.some((item) => item.id === experiment.id)) return previous;
            const next = [...previous];
            const safeIndex = Math.max(0, Math.min(Number(index) || 0, next.length));
            next.splice(safeIndex, 0, experiment);
            return next;
        });
        clearDeleteUndoTimeout();
        setLastDeletedRun(null);
    }, [clearDeleteUndoTimeout, lastDeletedRun, setExperiments]);

    const updateRunShortDescription = useCallback((runId, value) => {
        setExperiments((previous) => previous.map((exp) => {
            if (exp.id !== runId) return exp;
            return {
                ...exp,
                meta: {
                    ...(exp.meta || {}),
                    shortDescription: value,
                },
            };
        }));
    }, [setExperiments]);

    const exportPlanArtifact = useCallback(async (format) => {
        if (!projectPath) {
            await showAlert({
                title: 'Project Required',
                content: 'Open a project first. Export files are saved to the project Plan folder.',
                type: 'error',
            });
            return;
        }
        try {
            setBusyFormat(format);
            const response = await fetch(`${apiBaseUrl}/export_plan_artifact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectPath,
                    planName,
                    planMeta,
                    experiments,
                    format,
                }),
            });
            const payload = await response.json();
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || `Failed to export ${format.toUpperCase()}`);
            }
            await showAlert({
                title: `${format.toUpperCase()} Exported`,
                content: payload.path,
                type: 'success',
                closeLabel: 'OK',
            });
        } catch (error) {
            await showAlert({
                title: `${format.toUpperCase()} Export Failed`,
                content: error?.message || 'Unknown error',
                type: 'error',
            });
        } finally {
            setBusyFormat('');
        }
    }, [apiBaseUrl, experiments, planMeta, planName, projectPath, showAlert]);

    const exportPlanAsCsv = useCallback(() => {
        exportPlanArtifact('csv');
    }, [exportPlanArtifact]);

    const exportPlanAsPdf = useCallback(() => {
        exportPlanArtifact('pdf');
    }, [exportPlanArtifact]);

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

    useEffect(() => {
        let cancelled = false;
        const loadRawDataFiles = async () => {
            if (!projectPath) {
                if (!cancelled) setRawDataFiles([]);
                return;
            }
            try {
                const res = await fetch(`${apiBaseUrl}/list_raw_data?projectPath=${encodeURIComponent(projectPath)}`);
                const data = await res.json();
                if (!cancelled) {
                    setRawDataFiles(Array.isArray(data?.files) ? data.files : []);
                }
            } catch {
                if (!cancelled) setRawDataFiles([]);
            }
        };
        loadRawDataFiles();
        return () => { cancelled = true; };
    }, [apiBaseUrl, projectPath]);

    const toggleDataFileForEditingExp = (pathValue) => {
        if (!editingExp) return;
        const cleanPath = (pathValue || '').trim();
        if (!cleanPath) return;
        const current = Array.isArray(editingExp.meta?.dataFiles) ? editingExp.meta.dataFiles : [];
        const next = current.includes(cleanPath)
            ? current.filter((item) => item !== cleanPath)
            : [...current, cleanPath];
        setEditingExp({
            ...editingExp,
            meta: {
                ...editingExp.meta,
                dataFiles: next
            }
        });
    };

    const selectAllDataFilesForEditingExp = () => {
        if (!editingExp) return;
        setEditingExp({
            ...editingExp,
            meta: {
                ...editingExp.meta,
                dataFiles: [...editingRunScopedFiles]
            }
        });
    };

    const clearAllDataFilesForEditingExp = () => {
        if (!editingExp) return;
        setEditingExp({
            ...editingExp,
            meta: {
                ...editingExp.meta,
                dataFiles: []
            }
        });
    };

    // --- NUMERICAL GROUPING FIX ---
    const getGroupedExperiments = () => {
        const groups = {};
        experiments.forEach(exp => {
            const g = getRunGroupKey(exp.name);
            if (!groups[g]) groups[g] = [];
            groups[g].push(exp);
        });

        const sortedGroupNames = Object.keys(groups).sort((a, b) => {
            if (a === "GENERAL") return 1;
            if (b === "GENERAL") return -1;
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });

        const ordered = {};
        sortedGroupNames.forEach(name => { ordered[name] = groups[name]; });
        return ordered;
    };

    const groupedTasks = getGroupedExperiments();
    const scheduleBarSpan = 0.68;
    const scheduleBarOffset = (1 - scheduleBarSpan) / 2;
    const scheduleSource = [...experiments]
        .sort((a, b) => compareRunNames(a?.name, b?.name));
    const scheduleRunsByDay = new Map();
    scheduleSource.forEach((exp, index) => {
        const day = getPlannedDay(exp, index);
        if (!scheduleRunsByDay.has(day)) scheduleRunsByDay.set(day, []);
        scheduleRunsByDay.get(day).push({
            name: exp.name,
            day,
            visualStatus: getRunVisualStatus(exp),
            runSortKey: String(exp?.name || ''),
        });
    });
    const scheduleDays = Array.from(scheduleRunsByDay.keys()).sort((a, b) => a - b);
    scheduleDays.forEach((day) => {
        const dayRuns = scheduleRunsByDay.get(day) || [];
        dayRuns.sort((a, b) => compareRunNames(a.runSortKey, b.runSortKey));
    });
    const scheduleMaxLane = Math.max(1, ...Array.from(scheduleRunsByDay.values()).map((runs) => runs.length));
    const scheduleDayKeys = scheduleDays.map((day) => `d${day}`);
    const scheduleData = Array.from({ length: scheduleMaxLane }, (_, laneIndex) => {
        const row = { laneLabel: `L${laneIndex + 1}` };
        let laneCursor = 0;
        scheduleDays.forEach((day) => {
            const dayKey = `d${day}`;
            const run = (scheduleRunsByDay.get(day) || [])[laneIndex];
            if (run) {
                const start = Math.max(0, day - 1) + scheduleBarOffset;
                const gap = Math.max(0, start - laneCursor);
                row[`${dayKey}Gap`] = gap;
                row[`${dayKey}Duration`] = scheduleBarSpan;
                laneCursor = start + scheduleBarSpan;
            } else {
                row[`${dayKey}Gap`] = 0;
                row[`${dayKey}Duration`] = 0;
            }
            row[`${dayKey}Name`] = run?.name || '';
            row[`${dayKey}Status`] = run?.visualStatus || 'planned';
            row[`${dayKey}Day`] = day;
        });
        return row;
    });
    const scheduleMaxDay = scheduleDays.length ? Math.max(...scheduleDays) : 1;
    const scheduleTickStep = scheduleMaxDay > 14 ? Math.ceil(scheduleMaxDay / 7) : 1;
    const scheduleTicks = [];
    for (let dayNumber = 1; dayNumber <= scheduleMaxDay; dayNumber += scheduleTickStep) {
        scheduleTicks.push(dayNumber - 0.5);
    }
    if (!scheduleTicks.includes(scheduleMaxDay - 0.5)) {
        scheduleTicks.push(scheduleMaxDay - 0.5);
    }
    const scheduleLaneCount = Math.max(1, scheduleData.length);
    const scheduleChartHeightPx = Math.max(520, (scheduleLaneCount * 40) + 130);
    const getCalendarDateForDay = useCallback((dayNumber) => {
        const startRaw = getScheduleBaseDateRaw();
        const parsedDay = Number.parseInt(String(dayNumber || ''), 10);
        if (!startRaw || !Number.isFinite(parsedDay) || parsedDay < 1) return null;
        const startOrdinal = ymdToOrdinal(startRaw);
        if (!Number.isFinite(startOrdinal)) return null;
        return ordinalToYmd(startOrdinal + parsedDay - 1);
    }, [getScheduleBaseDateRaw, ymdToOrdinal, ordinalToYmd]);
    const formatScheduleTick = useCallback((axisValue) => {
        const parsed = Number(axisValue);
        if (!Number.isFinite(parsed)) return '';
        const dayNumber = Math.round(parsed + 0.5);
        const dateLabel = getCalendarDateForDay(dayNumber);
        return dateLabel || `D${dayNumber}`;
    }, [getCalendarDateForDay]);
    const openRunMetadataFromChart = useCallback((runName) => {
        const target = String(runName || '').trim();
        if (!target) return;
        const found = experiments.find((exp) => String(exp?.name || '').trim() === target);
        if (!found) return;
        setModalOffset({ x: 0, y: 40 });
        setEditError("");
        setEditingExp({ ...found });
    }, [experiments]);

    const updateRunPlannedDayFromChart = useCallback((runName, nextDay) => {
        const cleanRunName = String(runName || '').trim();
        const boundedDay = Math.max(1, Number.parseInt(String(nextDay || ''), 10) || 1);
        if (!cleanRunName) return;

        const baseDateRaw = getScheduleBaseDateRaw();
        const baseOrdinal = ymdToOrdinal(baseDateRaw);
        const nextDate = Number.isFinite(baseOrdinal)
            ? ordinalToYmd(baseOrdinal + boundedDay - 1)
            : null;

        setExperiments((previous) => previous.map((exp) => {
            if (String(exp?.name || '').trim() !== cleanRunName) return exp;
            return {
                ...exp,
                meta: {
                    ...(exp.meta || {}),
                    plannedDay: String(boundedDay),
                    plannedDate: nextDate || String(exp?.meta?.plannedDate || ''),
                },
            };
        }));
    }, [getScheduleBaseDateRaw, ordinalToYmd, setExperiments, ymdToOrdinal]);

    const beginScheduleRunDrag = useCallback((event, runName, startDay) => {
        if (event?.button !== undefined && event.button !== 0) return;
        const cleanRunName = String(runName || '').trim();
        const cleanStartDay = Math.max(1, Number.parseInt(String(startDay || ''), 10) || 1);
        if (!cleanRunName) return;
        if (event?.preventDefault) event.preventDefault();
        if (event?.stopPropagation) event.stopPropagation();
        scheduleDragRef.current = {
            runName: cleanRunName,
            startDay: cleanStartDay,
            startX: Number(event?.clientX || 0),
            currentX: Number(event?.clientX || 0),
            moved: false,
        };
        setDraggingScheduleRun(cleanRunName);
    }, []);

    useEffect(() => {
        if (!draggingScheduleRun) return undefined;

        const onMouseMove = (event) => {
            const nextX = Number(event?.clientX || 0);
            const delta = Math.abs(nextX - scheduleDragRef.current.startX);
            scheduleDragRef.current.currentX = nextX;
            if (delta >= 4) scheduleDragRef.current.moved = true;
        };

        const onMouseUp = () => {
            const drag = scheduleDragRef.current;
            const chartRect = scheduleChartAreaRef.current?.getBoundingClientRect?.();
            const chartWidth = Math.max(1, Number(chartRect?.width || 1));
            const chartInnerWidth = Math.max(1, chartWidth - 32);
            const pxPerDay = chartInnerWidth / Math.max(1, scheduleMaxDay);
            const deltaX = drag.currentX - drag.startX;
            const deltaDays = Math.round(deltaX / pxPerDay);
            const targetDay = Math.max(1, drag.startDay + deltaDays);

            if (drag.moved && deltaDays !== 0) {
                updateRunPlannedDayFromChart(drag.runName, targetDay);
            } else {
                openRunMetadataFromChart(drag.runName);
            }
            setDraggingScheduleRun(null);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [draggingScheduleRun, openRunMetadataFromChart, scheduleMaxDay, updateRunPlannedDayFromChart]);

    const renderScheduleBarShape = useCallback((props, dayKey) => {
        const { x, y, width, height, payload } = props || {};
        if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
            return null;
        }
        const runName = String(payload?.[`${dayKey}Name`] || '').trim();
        const dayNumber = Number.parseInt(String(payload?.[`${dayKey}Day`] || ''), 10) || 1;
        const visualStatus = String(payload?.[`${dayKey}Status`] || 'planned');
        const hasRun = width > 0 && runName.length > 0;
        if (!hasRun) {
            return <rect x={x} y={y} width={width} height={height} fill="transparent" />;
        }
        const fill = RUN_STATUS_COLORS[visualStatus] || RUN_STATUS_COLORS.planned;
        const isDragging = draggingScheduleRun === runName;
        return (
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={4}
                ry={4}
                fill={fill}
                opacity={isDragging ? 0.88 : 1}
                stroke={isDragging ? 'rgba(255,255,255,0.55)' : 'none'}
                strokeWidth={isDragging ? 1 : 0}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                onMouseDown={(event) => beginScheduleRunDrag(event, runName, dayNumber)}
            />
        );
    }, [beginScheduleRunDrag, draggingScheduleRun]);

    const renderScheduleLabel = useCallback((props, dayKey) => {
        const { x, y, width, height, value, payload } = props || {};
        if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
            return null;
        }
        const runName = String(payload?.[`${dayKey}Name`] || value || '').trim();
        if (!runName || width <= 0) return null;
        const runFromList = experiments.find((exp) => String(exp?.name || '').trim() === runName);
        const visualStatus = runFromList
            ? getRunVisualStatus(runFromList)
            : String(payload?.[`${dayKey}Status`] || 'planned');
        const dayNumber = Number.parseInt(String(payload?.[`${dayKey}Day`] || ''), 10) || 1;
        const fill = visualStatus === 'done' ? '#020617' : '#f8fafc';
        const stroke = visualStatus === 'done' ? 'rgba(2,6,23,0.35)' : 'rgba(2,6,23,0.25)';
        return (
            <text
                x={x + width / 2}
                y={y + height / 2}
                fill={fill}
                fontSize={10}
                fontWeight={700}
                dominantBaseline="middle"
                textAnchor="middle"
                paintOrder="stroke"
                stroke={stroke}
                strokeWidth={0.35}
                style={{ cursor: draggingScheduleRun === runName ? 'grabbing' : 'grab' }}
                onMouseDown={(event) => beginScheduleRunDrag(event, runName, dayNumber)}
            >
                {runName}
            </text>
        );
    }, [beginScheduleRunDrag, draggingScheduleRun, experiments, getRunVisualStatus]);
    const isGroupCollapsed = useCallback((groupName) => collapsedGroups[groupName] === true, [collapsedGroups]);
    const toggleGroupCollapse = useCallback((groupName) => {
        setCollapsedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
    }, []);
    const getGroupObjective = useCallback((groupName) => {
        const objectives = planMeta?.groupObjectives;
        if (!objectives || typeof objectives !== 'object') return "";
        return String(objectives[groupName] || "");
    }, [planMeta]);
    const setGroupObjective = useCallback((groupName, nextValue) => {
        setPlanMeta((prev) => {
            const previous = prev && typeof prev === 'object' ? prev : {};
            const objectives = previous.groupObjectives && typeof previous.groupObjectives === 'object'
                ? { ...previous.groupObjectives }
                : {};
            objectives[groupName] = nextValue;
            return { ...previous, groupObjectives: objectives };
        });
    }, [setPlanMeta]);

    // IMPORTANT:
    // Do not auto-overwrite dataFiles from Raw_Data discovery.
    // File linking is user-curated in Run Metadata Card checkboxes.

    const handleSavePlan = useCallback(async () => {
        await verifyRunFolders(true);
        if (typeof onSave === 'function') {
            await onSave();
        }
    }, [onSave, verifyRunFolders]);

    useEffect(() => {
        if (!isModalDragging) return undefined;

        const onMouseMove = (event) => {
            const deltaX = event.clientX - dragStartRef.current.mouseX;
            const deltaY = event.clientY - dragStartRef.current.mouseY;
            setModalOffset({
                x: dragStartRef.current.startX + deltaX,
                y: dragStartRef.current.startY + deltaY,
            });
        };

        const onMouseUp = () => setIsModalDragging(false);

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [isModalDragging]);

    useEffect(() => () => clearDeleteUndoTimeout(), [clearDeleteUndoTimeout]);

    useEffect(() => {
        if (!editingExp) {
            setIgnitionEditorMode('');
            setVentEditorMode('');
            return;
        }
        const ignitionValue = String(editingExp?.meta?.ignition || '').trim();
        const ventValue = String(editingExp?.meta?.vent || '').trim();
        setIgnitionEditorMode(
            !ignitionValue ? '' : (IGNITION_PRESET_OPTIONS.includes(ignitionValue) ? ignitionValue : CUSTOM_OPTION_VALUE)
        );
        setVentEditorMode(
            !ventValue ? '' : (VENT_PRESET_OPTIONS.includes(ventValue) ? ventValue : CUSTOM_OPTION_VALUE)
        );
    }, [editingExp?.id]);

    const beginModalDrag = (event) => {
        if (event.button !== 0) return;
        dragStartRef.current = {
            mouseX: event.clientX,
            mouseY: event.clientY,
            startX: modalOffset.x,
            startY: modalOffset.y,
        };
        setIsModalDragging(true);
    };

    const editingSelectedFiles = Array.isArray(editingExp?.meta?.dataFiles) ? editingExp.meta.dataFiles : [];
    const editingRunScopedFiles = editingExp ? filesForRunName(editingExp.name) : [];
    const editingStaleLinkedFiles = editingSelectedFiles.filter((pathValue) => !editingRunScopedFiles.includes(pathValue));
    const editingIgnitionValue = String(editingExp?.meta?.ignition || '');
    const editingVentValue = String(editingExp?.meta?.vent || '');
    const editingIgnitionSelection = ignitionEditorMode;
    const editingVentSelection = ventEditorMode;

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
                       <button onClick={handleSavePlan} className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"><Save size={18}/></button>
                       <button onClick={onImport} className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"><Upload size={18}/></button>
                       <ExportFormatButtons
                           onExportCsv={exportPlanAsCsv}
                           onExportPdf={exportPlanAsPdf}
                           busyFormat={busyFormat}
                           size="sm"
                       />
                   </div>
                </div>
                
                <div className="flex flex-col gap-2 mb-4 bg-black/20 p-3 rounded border border-zinc-800/50">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <input
                            value={input.group}
                            onChange={e=>{ setInput({...input, group:e.target.value}); setCreateError(""); }}
                            placeholder="Group ID (e.g., TEST-01)"
                            className="bg-black border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-primary text-white"
                        />
                        <input
                            value={input.run}
                            onChange={e=>{ setInput({...input, run:e.target.value}); setCreateError(""); }}
                            placeholder="Run # (e.g., 1 or 1-R1)"
                            className="bg-black border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-primary text-white"
                        />
                        <input
                            value={input.h2}
                            onChange={e=>{ setInput({...input, h2:e.target.value}); setCreateError(""); }}
                            placeholder="H2 %vol (e.g., 18)"
                            className="bg-black border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-primary text-white"
                        />
                        <input
                            type="date"
                            value={input.plannedDate}
                            onChange={e=>{ setInput({...input, plannedDate:e.target.value}); setCreateError(""); }}
                            title="Schedule date"
                            className="bg-black border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-primary text-white"
                        />
                    </div>
                    <input
                        value={input.name}
                        onChange={e=>{ setInput({...input, name:e.target.value}); setCreateError(""); }}
                        placeholder="Manual run name override (optional)"
                        className="bg-black border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-primary text-white"
                    />
                    <div className="text-[10px] text-zinc-500">
                        Auto run name: <span className="text-zinc-300 font-semibold">{buildRunName(input.group, input.run) || "--"}</span>
                    </div>
                    <div className="text-[10px] text-zinc-600">
                        Naming is fully editable. You can use any project prefix and override the generated name.
                    </div>
                    <label className="inline-flex items-center gap-2 text-[10px] text-zinc-400">
                        <input
                            type="checkbox"
                            checked={!!input.isPreparation}
                            onChange={(e) => { setInput({ ...input, isPreparation: e.target.checked }); setCreateError(""); }}
                            className="h-3.5 w-3.5 accent-primary"
                        />
                        Preparation run (can be marked done without full metadata)
                    </label>
                    {createError && (
                        <div className="text-[10px] text-red-400">{createError}</div>
                    )}
                    <button onClick={addExp} className="bg-primary/10 border border-primary/30 px-3 py-1.5 rounded text-primary hover:border-primary/60 hover:bg-primary/20 flex items-center justify-center gap-2 font-bold text-xs"><Plus size={14}/> Add Planned Run</button>
                    <button
                        onClick={() => verifyRunFolders(true)}
                        className="border border-zinc-700 px-3 py-1.5 rounded text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 flex items-center justify-center gap-2 font-semibold text-xs"
                    >
                        <Layers size={14}/> Sync run folders
                    </button>
                    {!!folderCheck.message && (
                        <div className={`text-[10px] ${
                            folderCheck.status === 'ok' ? 'text-primary' :
                            folderCheck.status === 'warning' ? 'text-amber-400' :
                            folderCheck.status === 'error' ? 'text-red-400' :
                            'text-zinc-500'
                        }`}>
                            {folderCheck.message}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                    {lastDeletedRun?.experiment && (
                        <div className="mb-3 flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                            <div className="truncate">
                                Run <span className="font-semibold">{lastDeletedRun.experiment.name}</span> deleted.
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={undoDeletedRun}
                                    className="inline-flex items-center gap-1 rounded border border-amber-300/40 px-2 py-1 font-semibold text-amber-100 hover:bg-amber-400/20"
                                >
                                    <Undo2 size={12}/> Undo
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        clearDeleteUndoTimeout();
                                        setLastDeletedRun(null);
                                    }}
                                    className="text-amber-200/80 hover:text-amber-100"
                                    aria-label="Dismiss delete notice"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        </div>
                    )}
                    {Object.entries(groupedTasks).map(([group, tasks]) => (
                        <div key={group} className="mb-4">
                            <div className="mb-2 flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => toggleGroupCollapse(group)}
                                    className="shrink-0 text-[10px] font-bold text-zinc-500 flex items-center gap-2 tracking-wide hover:text-zinc-300 transition-colors"
                                    title={isGroupCollapsed(group) ? 'Expand group' : 'Collapse group'}
                                >
                                    {isGroupCollapsed(group) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                    <Layers size={10}/>
                                    {group}
                                    <span className="text-[9px] text-zinc-600">({tasks.length})</span>
                                </button>
                                <input
                                    value={getGroupObjective(group)}
                                    onChange={(event) => setGroupObjective(group, event.target.value)}
                                    placeholder="Group objective (short description)"
                                    className="min-w-0 flex-1 bg-black border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-300 outline-none focus:border-primary"
                                />
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        value={groupRenameDrafts[group] ?? group}
                                        onChange={(event) => {
                                            const nextValue = event.target.value;
                                            setGroupRenameDrafts((prev) => ({ ...prev, [group]: nextValue }));
                                            setGroupRenameErrors((prev) => ({ ...prev, [group]: "" }));
                                        }}
                                        placeholder="Rename group (updates all runs in this group)"
                                        className="min-w-0 flex-1 bg-black border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-300 outline-none focus:border-primary"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => renameGroupRuns(group)}
                                        className="shrink-0 border border-primary/40 bg-primary/10 text-primary px-2 py-1 rounded text-[10px] font-semibold hover:bg-primary/20"
                                    >
                                        Apply Group Rename
                                    </button>
                                </div>
                                {!!groupRenameErrors[group] && (
                                    <div className="text-[10px] text-red-400">{groupRenameErrors[group]}</div>
                                )}
                            </div>
                            {!isGroupCollapsed(group) && tasks.map(e => (
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
                                        <span
                                            title={String(e.name || '')}
                                            className={`text-[13px] leading-snug flex-1 min-w-0 pr-2 font-mono font-semibold break-all ${
                                                e.done ? 'line-through text-zinc-600' : 'text-zinc-300'
                                            }`}
                                        >
                                            {e.name}
                                        </span>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                                            <button onClick={()=>{ setModalOffset({ x: 0, y: 40 }); setEditError(""); setEditingExp({...e}); }} className="text-zinc-600 hover:text-white p-1 hover:bg-zinc-800 rounded transition-colors"><PenTool size={12}/></button>
                                            <button onClick={() => removeRunWithUndo(e.id)} className="text-zinc-600 hover:text-red-500 p-1 hover:bg-zinc-800 rounded transition-colors"><Trash2 size={12}/></button>
                                        </div>
                                    </div>
                                    
                                    <div className="ml-8 mt-2 flex flex-wrap gap-2">
                                        {String(e.meta?.h2 || '').trim() && (
                                            <div className="flex items-center gap-1 bg-primary/10 border border-primary/30 px-1.5 py-0.5 rounded text-[9px] text-primary font-bold">
                                                <Beaker size={8}/> {e.meta.h2}% vol H2
                                            </div>
                                        )}
                                        {formatRunSchedule(e) && (
                                            <div className="flex items-center gap-1 border border-primary/30 bg-primary/10 px-1.5 py-0.5 rounded text-[9px] text-primary font-semibold">
                                                <Calendar size={8}/> {formatRunSchedule(e)}
                                            </div>
                                        )}
                                        {isPreparationRun(e) && (
                                            <div className="flex items-center gap-1 border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 rounded text-[9px] text-amber-300 font-semibold">
                                                <Wrench size={8}/> Preparation
                                            </div>
                                        )}
                                        {e.meta?.hasError && (
                                            <div className="flex items-center gap-1 border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 rounded text-[9px] text-red-300 font-semibold">
                                                <AlertCircle size={8}/> Error
                                            </div>
                                        )}
                                        {!e.meta?.hasError && e.meta?.isCanceled && (
                                            <div className="flex items-center gap-1 border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 rounded text-[9px] text-orange-300 font-semibold">
                                                <X size={8}/> Canceled
                                            </div>
                                        )}
                                        {isReady(e) ? (
                                            <>
                                                <div className="flex items-center gap-1 border border-zinc-800 px-1.5 py-0.5 rounded text-[9px] text-zinc-500">
                                                    <Gauge size={8}/> {e.meta.p0} Pa
                                                </div>
                                                <div className="flex items-center gap-1 border border-zinc-800 px-1.5 py-0.5 rounded text-[9px] text-zinc-500">
                                                    <Thermometer size={8}/> {e.meta.t0} K
                                                </div>
                                                {!!(Array.isArray(e.meta?.dataFiles) && e.meta.dataFiles.length) && (
                                                    <div className="flex items-center gap-1 border border-primary/30 bg-primary/10 px-1.5 py-0.5 rounded text-[9px] text-primary font-semibold">
                                                        <Layers size={8}/> {e.meta.dataFiles.length} data file{e.meta.dataFiles.length > 1 ? 's' : ''}
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <div className="flex items-center gap-1 bg-yellow-950/20 border border-yellow-900/30 px-1.5 py-0.5 rounded text-[9px] text-yellow-600 font-bold tracking-wide">
                                                <AlertCircle size={8}/> Missing: {getMissingMeta(e).join(', ')}
                                            </div>
                                        )}
                                    </div>
                                    <div className="ml-8 mt-2">
                                        <input
                                            value={String(e.meta?.shortDescription || '')}
                                            onChange={(event) => updateRunShortDescription(e.id, event.target.value)}
                                            onClick={(event) => event.stopPropagation()}
                                            placeholder="Short run description (e.g., baseline vented run)"
                                            className="w-full bg-black/20 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-300 outline-none focus:border-primary"
                                        />
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
                            <div className="flex items-center gap-2 text-primary font-bold text-xs tracking-wide"><Target size={16}/> Project Objectives</div>
                            <div className="flex gap-4 bg-black/40 p-2 rounded-lg border border-zinc-800/50">
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-zinc-500 font-bold text-center">Start</span>
                                    <input type="date" value={planMeta.startDate} onChange={e=>setPlanMeta({...planMeta, startDate: e.target.value})} className="bg-transparent text-[10px] text-zinc-400 border-none p-0 outline-none w-24 cursor-pointer text-center"/>
                                </div>
                                <div className="w-px bg-zinc-800 h-6 mx-1"></div>
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-zinc-500 font-bold text-center">Deadline</span>
                                    <input type="date" value={planMeta.deadline} onChange={e=>setPlanMeta({...planMeta, deadline: e.target.value})} className="bg-transparent text-[10px] text-primary border-none p-0 outline-none w-24 cursor-pointer font-bold text-center"/>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] tracking-wide text-zinc-500 font-bold">
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
                            <div className="flex items-center justify-between gap-2">
                                <label className="text-[10px] tracking-wide text-zinc-500 font-bold">
                                    Description (details)
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setIsDescriptionExpanded((value) => !value)}
                                    className="text-[10px] font-semibold text-zinc-400 hover:text-zinc-200 border border-zinc-800 rounded px-2 py-1 transition-colors"
                                >
                                    {isDescriptionExpanded ? 'Collapse' : 'Expand'}
                                </button>
                            </div>
                            <textarea
                                value={planMeta.description}
                                onChange={e=>setPlanMeta({...planMeta, description:e.target.value})}
                                className={`w-full bg-black/30 text-xs p-3 rounded-lg outline-none border border-zinc-800 text-zinc-300 resize-y focus:border-primary transition-all ${isDescriptionExpanded ? 'h-56' : 'h-20'}`}
                                placeholder="Add a longer description, scope, and notes..."
                            />
                        </div>
                    </div>

                    {/* KPI GRID */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                            <div className="text-xl font-bold text-zinc-300 leading-none mb-1">{stats.daysLeft}</div>
                            <div className="text-[9px] text-zinc-500 font-bold">Days until Deadline</div>
                        </div>
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                            <div className="text-xl font-bold text-primary leading-none mb-1">{stats.pace || '--'}</div>
                            <div className="text-[9px] text-zinc-500 font-bold">Pace (Runs/Day)</div>
                        </div>
                        <div className="col-span-2 grid grid-cols-3 gap-2">
                            <div className="bg-zinc-900/50 border border-orange-500/30 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                                <div className="text-xl font-bold text-orange-400 leading-none mb-1">{stats.canceled}</div>
                                <div className="text-[9px] text-zinc-500 font-bold">Canceled Runs</div>
                            </div>
                            <div className="bg-zinc-900/50 border border-red-500/30 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                                <div className="text-xl font-bold text-red-400 leading-none mb-1">{stats.errors}</div>
                                <div className="text-[9px] text-zinc-500 font-bold">Error Runs</div>
                            </div>
                            <div className="bg-zinc-900/50 border border-yellow-500/30 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                                <div className="text-xl font-bold text-yellow-300 leading-none mb-1">{stats.preparation}</div>
                                <div className="text-[9px] text-zinc-500 font-bold">Preparation Runs</div>
                            </div>
                        </div>
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-2 text-center col-span-2">
                            <div className="text-xl font-bold text-white leading-none mb-1">{stats.completionPercent}%</div>
                            <div className="text-[9px] text-zinc-500 font-bold">Completion ({stats.done}/{stats.total})</div>
                            <div className="mt-2 h-1 w-full max-w-[120px] rounded-full bg-zinc-800 overflow-hidden">
                                <div className="h-full bg-primary" style={{ width: `${stats.completionPercent}%` }} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* TIMELINE */}
                <div
                    className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl shrink-0 flex flex-col"
                    style={{ height: `${scheduleChartHeightPx}px` }}
                >
                    <h3 className="text-[10px] font-bold text-zinc-500 mb-4 flex items-center gap-2 tracking-wide"><Clock size={12}/> Campaign Schedule</h3>
                    <div
                        ref={scheduleChartAreaRef}
                        className="flex-1 bg-black/40 rounded-lg border border-zinc-800/50 overflow-hidden"
                        style={{ cursor: draggingScheduleRun ? 'grabbing' : 'default' }}
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                layout="vertical"
                                data={scheduleData}
                                barSize={22}
                                margin={{left: 16, right: 16, top: 16, bottom: 22}}
                            >
                                <CartesianGrid strokeDasharray="2 4" horizontal={false} stroke="#334155" />
                                <XAxis
                                    type="number"
                                    stroke="#a1a1aa"
                                    fontSize={9}
                                    tickFormatter={formatScheduleTick}
                                    domain={[0, scheduleMaxDay]}
                                    ticks={scheduleTicks}
                                    allowDecimals={false}
                                />
                                <YAxis
                                    type="category"
                                    dataKey="laneLabel"
                                    width={0}
                                    tick={false}
                                    axisLine={false}
                                    tickLine={false}
                                    padding={{ top: 10, bottom: 10 }}
                                />
                                {scheduleDayKeys.map((dayKey) => (
                                    <React.Fragment key={dayKey}>
                                        <Bar dataKey={`${dayKey}Gap`} stackId="scheduleLane" fill="transparent" isAnimationActive={false} barSize={22} />
                                        <Bar
                                            dataKey={`${dayKey}Duration`}
                                            stackId="scheduleLane"
                                            isAnimationActive={false}
                                            barSize={22}
                                            shape={(props) => renderScheduleBarShape(props, dayKey)}
                                        >
                                            <LabelList
                                                dataKey={`${dayKey}Name`}
                                                content={(props) => renderScheduleLabel(props, dayKey)}
                                            />
                                        </Bar>
                                    </React.Fragment>
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-2 text-[10px] text-zinc-500 text-center">
                        Drag a run block left/right to move its planned day. Click opens Run Metadata Card.
                    </div>
                    <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-zinc-400">
                        <div className="flex items-center gap-1.5">
                            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-cyan-400" />
                            <span>Done</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-500" />
                            <span>Canceled</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />
                            <span>Error</span>
                        </div>
                    </div>
                </div>

            </div>

            {/* RUN CARD MODAL */}
            {editingExp && (
                <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50 px-4 py-4 backdrop-blur-md overflow-y-auto">
                    <div
                        className="bg-zinc-950 p-5 rounded-2xl border border-primary/30 w-full max-w-5xl shadow-2xl max-h-[76vh] overflow-hidden ring-1 ring-white/5 font-sans flex flex-col"
                        style={{ transform: `translate(${modalOffset.x}px, ${modalOffset.y}px)` }}
                    >
                        <div className="flex justify-between items-start mb-5 border-b border-zinc-800 pb-4">
                            <div className="min-w-0 flex-1">
                                <h3 className="text-white font-bold text-xl flex items-center gap-3 tracking-tight">
                                    <Beaker size={24} className="text-primary"/> Run Metadata Card
                                </h3>
                                <div className="mt-2 max-w-md">
                                    <label className="text-[9px] text-zinc-500 font-bold mb-1 block">Run name</label>
                                    <input
                                        value={editingExp.name || ''}
                                        onChange={(e) => { setEditingExp({ ...editingExp, name: e.target.value }); setEditError(""); }}
                                        className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                        placeholder="e.g., TEST-01-01"
                                    />
                                    {editError && (
                                        <div className="mt-2 text-[10px] text-red-400">{editError}</div>
                                    )}
                                </div>
                            </div>
                            <div className="ml-4 flex items-center gap-2">
                                <button
                                    type="button"
                                    onMouseDown={beginModalDrag}
                                    className={`text-zinc-500 hover:text-zinc-200 bg-zinc-900 p-2 rounded-full transition-all ${isModalDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                                    title="Drag card"
                                >
                                    <GripVertical size={16} />
                                </button>
                                <button onClick={()=>{ setEditError(""); setEditingExp(null); }} className="text-zinc-500 hover:text-white bg-zinc-900 p-2 rounded-full transition-all hover:scale-110"><X size={20}/></button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2">
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 text-left">
                            <div className="space-y-6 md:col-span-3">
                                <div>
                                    <div className="flex items-center gap-2 text-zinc-300 font-semibold text-xs tracking-wide mb-3 border-b border-zinc-900 pb-1">
                                        <TrendingUp size={12}/> Mixture Parameters
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pl-1 md:pl-2">
                                        <div><label className="text-[9px] text-zinc-500 font-bold mb-1 block">Target H2%V</label><input value={editingExp.meta?.h2} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, h2:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., 10.5"/></div>
                                        <div><label className="text-[9px] text-zinc-500 font-bold mb-1 block" title="Injected hydrogen mass">H2 injected (g)</label><input value={editingExp.meta?.h2InjectedGrams || ''} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, h2InjectedGrams:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., 8"/></div>
                                        <div><label className="text-[9px] text-zinc-500 font-bold mb-1 block" title="Mass flow controller flow">MFC flow (SLPM)</label><input value={editingExp.meta?.mfcFlowSlpm || ''} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, mfcFlowSlpm:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., 12.5"/></div>
                                        <div><label className="text-[9px] text-zinc-500 font-bold mb-1 block">Schedule Date</label><input type="date" value={editingExp.meta?.plannedDate || ''} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, plannedDate:e.target.value, plannedDay: ''}})} className="w-full bg-black border border-zinc-800 rounded p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary"/></div>
                                        <div><label className="text-[9px] text-zinc-500 font-bold mb-1 block">Init. P (Pa)</label><input value={editingExp.meta?.p0} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, p0:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., 101325"/></div>
                                        <div><label className="text-[9px] text-zinc-500 font-bold mb-1 block">Init. T (K)</label><input value={editingExp.meta?.t0} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, t0:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., 293"/></div>
                                        <div><label className="text-[9px] text-zinc-500 font-bold mb-1 block whitespace-nowrap">Recirc stop → ignition time (s)</label><input value={editingExp.meta?.recircStopToIgnitionSec || ''} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, recircStopToIgnitionSec:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., 120"/></div>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 text-zinc-300 font-semibold text-xs tracking-wide mb-3 border-b border-zinc-900 pb-1">
                                        <Zap size={12}/> Experimental Setup
                                    </div>
                                    <div className="space-y-4 pl-1 md:pl-2">
                                        <label className="inline-flex items-center gap-2 text-[10px] text-zinc-400">
                                            <input
                                                type="checkbox"
                                                checked={!!editingExp.meta?.isPreparation}
                                                onChange={(e)=>setEditingExp({...editingExp, meta:{...editingExp.meta, isPreparation:e.target.checked}})}
                                                className="h-3.5 w-3.5 accent-primary"
                                            />
                                            Preparation run (skip required metadata gate)
                                        </label>
                                        <div>
                                            <label className="text-[9px] text-zinc-500 font-bold mb-1 block">Ignition Configuration</label>
                                            <select
                                                value={editingIgnitionSelection}
                                                onChange={(e) => {
                                                    const selected = e.target.value;
                                                    setIgnitionEditorMode(selected);
                                                    if (selected === '') {
                                                        setEditingExp({ ...editingExp, meta: { ...editingExp.meta, ignition: '' } });
                                                        return;
                                                    }
                                                    if (selected === CUSTOM_OPTION_VALUE) {
                                                        const keepCustom = !IGNITION_PRESET_OPTIONS.includes(editingIgnitionValue);
                                                        setEditingExp({ ...editingExp, meta: { ...editingExp.meta, ignition: keepCustom ? editingIgnitionValue : '' } });
                                                        return;
                                                    }
                                                    setEditingExp({ ...editingExp, meta: { ...editingExp.meta, ignition: selected } });
                                                }}
                                                className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-primary"
                                            >
                                                <option value="">Select ignition setup...</option>
                                                {IGNITION_PRESET_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>{option}</option>
                                                ))}
                                                <option value={CUSTOM_OPTION_VALUE}>Other (custom)</option>
                                            </select>
                                            {editingIgnitionSelection === CUSTOM_OPTION_VALUE && (
                                                <input
                                                    value={editingIgnitionValue}
                                                    onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, ignition:e.target.value}})}
                                                    className="mt-2 w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                                    placeholder="Type custom ignition setup..."
                                                />
                                            )}
                                        </div>
                                        <div>
                                            <label className="text-[9px] text-zinc-500 font-bold mb-1 block">Venting Configuration</label>
                                            <select
                                                value={editingVentSelection}
                                                onChange={(e) => {
                                                    const selected = e.target.value;
                                                    setVentEditorMode(selected);
                                                    if (selected === '') {
                                                        setEditingExp({ ...editingExp, meta: { ...editingExp.meta, vent: '' } });
                                                        return;
                                                    }
                                                    if (selected === CUSTOM_OPTION_VALUE) {
                                                        const keepCustom = !VENT_PRESET_OPTIONS.includes(editingVentValue);
                                                        setEditingExp({ ...editingExp, meta: { ...editingExp.meta, vent: keepCustom ? editingVentValue : '' } });
                                                        return;
                                                    }
                                                    setEditingExp({ ...editingExp, meta: { ...editingExp.meta, vent: selected } });
                                                }}
                                                className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-primary"
                                            >
                                                <option value="">Select vent setup...</option>
                                                {VENT_PRESET_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>{option}</option>
                                                ))}
                                                <option value={CUSTOM_OPTION_VALUE}>Other (custom)</option>
                                            </select>
                                            {editingVentSelection === CUSTOM_OPTION_VALUE && (
                                                <input
                                                    value={editingVentValue}
                                                    onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, vent:e.target.value}})}
                                                    className="mt-2 w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                                    placeholder="Type custom vent setup..."
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6 md:col-span-2">
                                <div>
                                    <div className="flex items-center gap-2 text-zinc-300 font-semibold text-xs tracking-wide mb-3 border-b border-zinc-900 pb-1">
                                        <Cpu size={12}/> Traceability Link
                                    </div>
                                    <div><label className="text-[9px] text-zinc-500 font-bold mb-1 block">Case ID / CFD Hash</label><input value={editingExp.meta?.cfdHash} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, cfdHash:e.target.value}})} className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., #OFv2306-mesh-rev2"/></div>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 text-zinc-300 font-semibold text-xs tracking-wide mb-3 border-b border-zinc-900 pb-1">
                                        <Layers size={12}/> Associated Data Files
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-[10px] text-zinc-500">
                                            Showing files detected in this run folder: <span className="text-zinc-300 font-mono">Raw_Data/{String(editingExp?.name || '').trim() || '<run>'}/</span>
                                        </div>
                                        <div className="max-h-32 overflow-y-auto pr-1 space-y-1 border border-zinc-800 rounded bg-black/30 p-2">
                                            {editingRunScopedFiles.map((filePath) => {
                                                const checked = (editingExp.meta?.dataFiles || []).includes(filePath);
                                                const parts = String(filePath).split('/');
                                                const fileName = parts[parts.length - 1] || filePath;
                                                return (
                                                    <label key={filePath} className="flex items-start gap-2 text-[10px] text-zinc-300 cursor-pointer" title={filePath}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleDataFileForEditingExp(filePath)}
                                                            className="h-3 w-3 accent-primary mt-0.5"
                                                        />
                                                        <span className="min-w-0">
                                                            <span className="block break-all leading-tight text-primary font-semibold">{fileName}</span>
                                                            <span className="mt-0.5 block break-all leading-tight text-zinc-500 text-[9px]">{filePath}</span>
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                            {editingRunScopedFiles.length === 0 && (
                                                <div className="text-[10px] text-zinc-500">No files found in this run folder.</div>
                                            )}
                                        </div>
                                        {editingRunScopedFiles.length > 0 && (
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={clearAllDataFilesForEditingExp}
                                                    className="text-[10px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
                                                >
                                                    Clear all
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={selectAllDataFilesForEditingExp}
                                                    className="text-[10px] px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                                >
                                                    Select all
                                                </button>
                                            </div>
                                        )}
                                        {editingStaleLinkedFiles.length > 0 && (
                                            <div className="rounded border border-amber-600/40 bg-amber-900/15 px-2 py-1.5 text-[10px] text-amber-300">
                                                {editingStaleLinkedFiles.length} linked file(s) are outside this run folder and will be removed when you save this run card.
                                            </div>
                                        )}
                                        <div className="text-[10px] text-zinc-500">
                                            Selected: {(editingExp.meta?.dataFiles || []).length}
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 text-zinc-300 font-semibold text-xs tracking-wide mb-3 border-b border-zinc-900 pb-1">
                                        <PenTool size={12}/> Operator Notes
                                    </div>
                                    <div className="mb-3 rounded border border-zinc-800 bg-black/30 p-3 space-y-3">
                                        <div className="text-[10px] font-semibold tracking-wide text-zinc-400">Run Status Flags</div>
                                        <label className="inline-flex items-center gap-2 text-[10px] text-zinc-300">
                                            <input
                                                type="checkbox"
                                                checked={!!editingExp.meta?.hasError}
                                                onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, hasError:e.target.checked}})}
                                                className="h-3.5 w-3.5 accent-red-500"
                                            />
                                            Error (plot color turns red)
                                        </label>
                                        <textarea
                                            value={editingExp.meta?.errorNote || ''}
                                            onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, errorNote:e.target.value}})}
                                            className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic h-16 outline-none focus:ring-1 focus:ring-red-500 resize-none font-sans"
                                            placeholder="Error note (anomaly, root cause, traceback, etc.)"
                                        />
                                        <label className="inline-flex items-center gap-2 text-[10px] text-zinc-300">
                                            <input
                                                type="checkbox"
                                                checked={!!editingExp.meta?.isCanceled}
                                                onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, isCanceled:e.target.checked}})}
                                                className="h-3.5 w-3.5 accent-orange-500"
                                            />
                                            Canceled (plot color turns orange)
                                        </label>
                                        <textarea
                                            value={editingExp.meta?.canceledNote || ''}
                                            onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, canceledNote:e.target.value}})}
                                            className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic h-16 outline-none focus:ring-1 focus:ring-orange-500 resize-none font-sans"
                                            placeholder="Canceled note (reason and next action)"
                                        />
                                        <div className="text-[10px] text-zinc-500">
                                            If both are checked, chart color priority is: Error (red) over Canceled (orange).
                                        </div>
                                    </div>
                                    <div className="mb-3">
                                        <label className="text-[9px] text-zinc-500 font-bold mb-1 block">Short Description</label>
                                        <input
                                            value={editingExp.meta?.shortDescription || ''}
                                            onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, shortDescription:e.target.value}})}
                                            className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                            placeholder="One-line summary for this run"
                                        />
                                    </div>
                                    <textarea value={editingExp.notes} onChange={e=>setEditingExp({...editingExp, notes:e.target.value})} className="w-full bg-black border border-zinc-800 rounded p-3 text-xs text-zinc-100 placeholder:text-zinc-600 placeholder:italic h-24 outline-none focus:ring-1 focus:ring-primary resize-none font-sans" placeholder="e.g., Record sensor health, offsets, or observations..."/>
                                </div>
                            </div>
                        </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-2 border-t border-zinc-800 pt-4">
                            <button onClick={()=>{ setEditError(""); setEditingExp(null); }} className="bg-zinc-900 text-zinc-400 px-3 py-2 rounded-md font-semibold text-xs border border-zinc-800 hover:bg-zinc-800 transition-all">Discard</button>
                            <button onClick={saveEdit} className="border border-primary/30 bg-primary/10 text-primary px-3 py-2 rounded-md font-semibold text-xs hover:bg-primary/20 transition-all">Save Run Card</button>
                        </div>
                    </div>
                </div>
            )}
            <UnifiedModal modal={dialogModal} setModal={setDialogModal} />
        </div>
    );
};

export default PlanPage;
