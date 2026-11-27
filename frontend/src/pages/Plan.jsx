import React, { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import PathText from '../components/PathText';
import { 
    Save, Upload, Plus, CheckSquare, Square, PenTool, Trash2, Calendar, 
    Clock, GripVertical, Layers, FlaskConical, X, 
    AlertCircle, CheckCircle2, Beaker, Zap, Cpu, TrendingUp, Thermometer, Gauge, ChevronRight, ChevronDown, Wrench, Undo2
} from 'lucide-react';
import { filesInRunFolder, linkedRunFiles, missingLinkedFiles, toPosixPath } from '../utils/runFiles';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, LabelList } from 'recharts';
import { getBackendBaseUrl } from '../utils/backendUrl';
import UnifiedModal from '../components/UnifiedModal';
import ExportFormatButtons from '../components/ExportFormatButtons';
import IsoDateInput from '../components/IsoDateInput';
import { useAppDialog } from '../hooks/useAppDialog';
import { formatPressurePa, formatTempK } from '../utils/formatting';
import ModalPortal from '../components/ModalPortal';

const RUN_NAME_ORDER_RE = /^(.*)-(\d+)(?:-([Rr])(\d+))?$/;
// Timeline colours are theme tokens, so they follow light/dark (docs/EXDA-Design-Guide.md).
const RUN_STATUS_COLORS = {
    error: 'hsl(var(--destructive))',
    canceled: 'hsl(var(--warning))',
    done: 'hsl(var(--primary) / 0.12)',
    planned: 'hsl(var(--muted-foreground) / 0.25)',
};

// Group markers: the validated categorical palette (blue, green, violet, amber,
// red, grey); more groups repeat it, and the legend names each group.
const GROUP_MARKER_COLORS = [
  'hsl(var(--cloud-methods))',
  'hsl(var(--cloud-measured))',
  'hsl(var(--cloud-skills))',
  'hsl(var(--cloud-fuels))',
  'hsl(var(--cloud-facility))',
  'hsl(var(--muted-foreground))',
];

const formatVolPercentLabel = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const numericText = raw
        .replace(/h2/gi, '')
        .replace(/vol\.?\s*%/gi, '')
        .replace(/%\s*vol\.?/gi, '')
        .replace(/%/g, '')
        .trim()
        .replace(',', '.');
    const numeric = Number.parseFloat(numericText);
    if (!Number.isFinite(numeric)) return `${raw} vol.%`;
    return `${numeric.toFixed(2).replace(/\.?0+$/, '')} vol.%`;
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
    const { dialogModal, setDialogModal, showAlert, showConfirm } = useAppDialog();
    // EXDA-Check C7: actual ignition time per run, with time zone and source.
    const [ignitionCandidates, setIgnitionCandidates] = useState({ runName: '', items: [], error: '', loading: false });
    const loadIgnitionCandidates = useCallback(async (runName) => {
        const name = String(runName || '').trim();
        if (!projectPath || !name) return;
        setIgnitionCandidates({ runName: name, items: [], error: '', loading: true });
        try {
            const query = new URLSearchParams({ projectPath, runName: name });
            const res = await fetch(`${apiBaseUrl}/run_time_candidates?${query.toString()}`);
            const data = await res.json();
            if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
            setIgnitionCandidates({
                runName: name,
                items: Array.isArray(data.candidates) ? data.candidates : [],
                error: data.note || '',
                loading: false,
            });
        } catch (err) {
            setIgnitionCandidates({ runName: name, items: [], error: err?.message || String(err), loading: false });
        }
    }, [apiBaseUrl, projectPath]);
    const [input, setInput] = useState({ group: "", objective: "", run: "1", h2: "", plannedDate: "", name: "", isPreparation: false });
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
    const [busyFormat, setBusyFormat] = useState('');
    const [rawDataFiles, setRawDataFiles] = useState([]);
    const [gasMixingByRun, setGasMixingByRun] = useState({});
    const [loadingGasMixingMirror, setLoadingGasMixingMirror] = useState(false);
    // Fold state per run group, remembered per project in this browser.
    const foldStorageKey = projectPath ? `exda-plan-open-groups:${projectPath}` : '';
    const [collapsedGroups, setCollapsedGroups] = useState({});
    const [foldStateLoadedFor, setFoldStateLoadedFor] = useState(null);
    // "New run group" form: open by default only when the plan has no runs yet.
    const [showNewGroupForm, setShowNewGroupForm] = useState(() => !(Array.isArray(experiments) && experiments.length));
    // "Add run" form inside one run group at a time (the group name is fixed there).
    const EMPTY_GROUP_RUN_DRAFT = { run: "", name: "", h2: "", plannedDate: "", isPreparation: false };
    const [groupRunFormGroup, setGroupRunFormGroup] = useState(null);
    const [groupRunDraft, setGroupRunDraft] = useState(EMPTY_GROUP_RUN_DRAFT);
    const [groupRunError, setGroupRunError] = useState("");
    const [lastDeletedRun, setLastDeletedRun] = useState(null);
    const [folderCheck, setFolderCheck] = useState({ status: 'idle', message: '' });
    const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0, rect: null });
    const runCardRef = useRef(null);
    // Field to show when the run card opens from a "Missing" badge (h2, ignition, vent, data).
    const [runCardFocusField, setRunCardFocusField] = useState('');
    // When the run card opened for a missing field, scroll to it and highlight it.
    useEffect(() => {
        if (!editingExp || !runCardFocusField) return undefined;
        const timerId = setTimeout(() => {
            const target = runCardRef.current?.querySelector(`[data-run-field="${runCardFocusField}"]`);
            if (target) {
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                target.querySelector('input, select, textarea, button')?.focus({ preventScroll: true });
                target.classList.add('ring-2', 'ring-warning', 'rounded');
                setTimeout(() => target.classList.remove('ring-2', 'ring-warning', 'rounded'), 1800);
            }
            setRunCardFocusField('');
        }, 80);
        return () => clearTimeout(timerId);
    }, [editingExp, runCardFocusField]);
    const scheduleChartAreaRef = useRef(null);
    const scheduleDragRef = useRef({ runName: '', startDay: 1, startX: 0, currentX: 0, moved: false });
    const deleteUndoTimeoutRef = useRef(null);

    const normalizeRunKey = useCallback((value) => String(value || '').trim(), []);
    const buildGasMirrorByRun = useCallback((records) => {
        const map = {};
        (Array.isArray(records) ? records : []).forEach((item) => {
            const runName = normalizeRunKey(item?.runName);
            if (!runName) return;
            const next = {
                h2InjectedGrams: String(item?.mH2InjectedG ?? '').trim(),
                mfcFlowSlpm: String(item?.mfcFlowSlpm ?? '').trim(),
                pChamberPa: String(item?.pChamberPa ?? '').trim(),
                tChamberK: String(item?.tChamberK ?? '').trim(),
                updatedAt: String(item?.updatedAt ?? '').trim(),
            };
            const prev = map[runName];
            if (!prev) {
                map[runName] = next;
                return;
            }
            const prevMs = Date.parse(prev.updatedAt || '');
            const nextMs = Date.parse(next.updatedAt || '');
            if (Number.isFinite(nextMs) && (!Number.isFinite(prevMs) || nextMs >= prevMs)) {
                map[runName] = next;
            }
        });
        return map;
    }, [normalizeRunKey]);

    const refreshGasMixingMirror = useCallback(async () => {
        if (!projectPath) {
            setGasMixingByRun({});
            return;
        }
        setLoadingGasMixingMirror(true);
        try {
            const response = await fetch(`${apiBaseUrl}/get_gas_mixing?projectPath=${encodeURIComponent(projectPath)}`);
            const payload = await response.json();
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Could not load gas mixing mirror');
            }
            setGasMixingByRun(buildGasMirrorByRun(payload?.records));
        } catch {
            setGasMixingByRun({});
        } finally {
            setLoadingGasMixingMirror(false);
        }
    }, [apiBaseUrl, buildGasMirrorByRun, projectPath]);

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
        const parsedDeadline = planMeta.deadline ? new Date(planMeta.deadline) : null;
        const deadlineDate = parsedDeadline && !Number.isNaN(parsedDeadline.getTime()) ? parsedDeadline : null;
        
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
        return { total, done, remaining, canceled, errors, preparation, hasDeadline: !!deadlineDate, daysLeft: daysLeft > 0 ? daysLeft : 0, pace, completionPercent };
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

    // EXDA-Check C2: dry run first (planned moves, conflicts), then an
    // all-or-nothing rename. Returns the payload, including on failure.
    const renameRunFolders = useCallback(async (renamePairs = [], { dryRun = false, context = null } = {}) => {
        if (!projectPath || !Array.isArray(renamePairs) || renamePairs.length === 0) {
            return { success: false, error: 'Nothing to rename.' };
        }
        try {
            const response = await fetch(`${apiBaseUrl}/rename_run_data_folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectPath, renamePairs, dryRun, context }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                return { ...payload, success: false, error: payload?.error || `HTTP ${response.status}` };
            }
            return payload;
        } catch (err) {
            return { success: false, error: err?.message || 'Could not reach the backend.' };
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

    const filesForRunName = useCallback((runName) => filesInRunFolder(rawDataFiles, runName), [rawDataFiles]);

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

        // EXDA-Check C2: show every folder that will move, refuse on conflicts,
        // require an explicit override for completed runs, and only change
        // the plan after the folders were renamed successfully.
        const preview = await renameRunFolders(renamePairs, { dryRun: true });
        if (!preview?.success) {
            setGroupRenameErrors((prev) => ({ ...prev, [groupName]: `Rename check failed: ${preview?.error || 'unknown error'}` }));
            return;
        }
        if (Array.isArray(preview.conflicts) && preview.conflicts.length > 0) {
            const list = preview.conflicts
                .map((c) => `${c.root ? `${c.root}/` : ''}${c.oldName} -> ${c.newName} (${c.reason})`)
                .join('; ');
            setGroupRenameErrors((prev) => ({ ...prev, [groupName]: `Rename blocked, nothing changed. Conflicts: ${list}` }));
            return;
        }
        const planned = Array.isArray(preview.planned) ? preview.planned : [];
        const completedRuns = affected.filter((exp) => Boolean(exp?.done));
        const confirmed = await showConfirm({
            title: `Rename group "${groupName}" to "${requestedName}"?`,
            type: 'warning',
            confirmLabel: 'Rename',
            confirmVariant: 'primary',
            content: (
                <div className="space-y-2 text-left">
                    <div>Runs: {renamePairs.map((p) => `${p.oldName} -> ${p.newName}`).join(', ')}</div>
                    <div className="font-semibold">
                        {planned.length > 0 ? `Folders that will be moved on disk (${planned.length}):` : 'No data folders exist yet for these runs; nothing will be moved.'}
                    </div>
                    {planned.length > 0 && (
                        <ul className="max-h-48 overflow-auto font-mono text-xs list-disc pl-5">
                            {planned.map((m) => (
                                <li key={`${m.root}/${m.from}`}>{`${m.root}/${m.from} -> ${m.root}/${m.to} (${m.files} files)`}</li>
                            ))}
                        </ul>
                    )}
                    <div className="text-xs">All moves succeed together or none are kept. Every move is written to History/change_log.jsonl.</div>
                </div>
            ),
        });
        if (!confirmed) return;
        if (completedRuns.length > 0) {
            const override = await showConfirm({
                title: 'Completed runs',
                type: 'error',
                confirmLabel: 'Override and rename completed runs',
                content: `${completedRuns.length} of these runs are marked done (${completedRuns.map((e) => e.name).join(', ')}). Renaming changes the names of recorded test data folders. Continue only if the current names are wrong.`,
            });
            if (!override) return;
        }
        const renameResult = await renameRunFolders(renamePairs, {
            context: { oldGroup: groupName, newGroup: requestedName, completedRunsOverride: completedRuns.map((e) => e.name) },
        });
        if (!renameResult?.success) {
            setGroupRenameErrors((prev) => ({
                ...prev,
                [groupName]: `Folders were not renamed; the plan is unchanged. ${renameResult?.error || ''}`.trim(),
            }));
            return;
        }

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
                    const remappedFiles = currentFiles.map((filePath) => remapRunFilePath(toPosixPath(filePath), oldName, newName));
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

        if (renameResult.logWarning) {
            setFolderCheck({ status: 'warning', message: renameResult.logWarning });
        }
        const metadataResult = await renameRunMetadataReferences({
            renamePairs,
            oldGroup: groupName,
            newGroup: requestedName,
        });
        if (!metadataResult) {
            setFolderCheck({
                status: 'warning',
                message: 'Run names were updated, but metadata references (Gas Mixing/Sensors Mapping/Cameras Mapping) could not be auto-renamed. Please reopen those tabs to verify.',
            });
        }
        await syncRunFolders(generatedNames);
    }, [experiments, getRunGroupKey, groupRenameDrafts, normalizeRunName, renameRunFolders, renameRunMetadataReferences, setExperiments, setPlanMeta, showConfirm, syncRunFolders]);

    // Groups are derived from run names. A numbered group (e.g. VH2D-G01 from
    // VH2D-G01-06) continues with run numbers; the catch-all GENERAL group and
    // mixture groups (e.g. 18%VOL) need a full run name instead.
    const groupUsesRunNumbers = (groupName) => groupName !== 'GENERAL' && !/%VOL$/.test(String(groupName || ''));

    // Next free run number in a group: highest run number + 1 (repeats such as
    // -06-R1 count as 6).
    const getNextRunNumber = (groupName) => {
        let highest = 0;
        experiments.forEach((exp) => {
            if (getRunGroupKey(exp?.name) !== groupName) return;
            const { runNumber } = parseRunNameOrder(exp?.name);
            if (Number.isFinite(runNumber) && runNumber > highest) highest = runNumber;
        });
        return String(highest + 1);
    };

    // Why no run name could be built from Group ID + Run #.
    const describeRunNameProblem = (groupValue, runValue) => {
        if (!String(groupValue || '').trim()) {
            return 'Enter a Group ID (e.g., TEST-01), or type a full name in "Manual run name".';
        }
        if (!String(runValue || '').trim()) {
            return 'Enter a Run # (e.g., 1, or 1-R1 for a repeat), or type a full name in "Manual run name".';
        }
        return `Run # must be a number, e.g. 1, or 1-R1 for a repeat ("${String(runValue).trim()}" is not). Or type a full name in "Manual run name".`;
    };

    // Add one planned run. Returns an error message, or "" when the run was added.
    const createRun = async ({ runName, h2, plannedDate, isPreparation }) => {
        if (isDuplicateRunName(runName)) {
            return `Run name "${runName}" already exists. Use a unique name.`;
        }
        setExperiments([...experiments, {
            id: Date.now(),
            name: runName,
            done: false,
            meta: {
                h2: String(h2 || "").trim(),
                plannedDate: String(plannedDate || "").trim(),
                isPreparation: !!isPreparation,
                hasError: false,
                errorNote: "",
                isCanceled: false,
                canceledNote: "",
                shortDescription: "",
                // Measured on the day: start blank, never a default (EXDA-Check item 2).
                p0: "",
                t0: "",
                ignition: "",
                vent: "",
                cfdHash: "",
                // Keep associated files opt-in; user selects explicitly in Run Metadata Card.
                dataFiles: []
            }
        }]);
        // Show the group the run was added to.
        setCollapsedGroups((prev) => ({ ...prev, [getRunGroupKey(runName)]: false }));
        await syncRunFolders([runName]);
        return "";
    };

    // "New run group": a group exists through its runs, so it is created with its first run.
    const addNewGroup = async () => {
        const manualRunName = String(input.name || '').trim();
        const runName = manualRunName || buildRunName(input.group, input.run);
        if (!runName) {
            setCreateError(describeRunNameProblem(input.group, input.run));
            return;
        }
        if (isDuplicateRunName(runName)) {
            setCreateError(`Run name "${runName}" already exists. Use a unique name.`);
            return;
        }
        setCreateError("");
        const groupKey = getRunGroupKey(runName);
        const objective = String(input.objective || '').trim();
        if (objective && !getGroupObjective(groupKey)) {
            setGroupObjective(groupKey, objective);
        }
        await createRun({ runName, h2: input.h2, plannedDate: input.plannedDate, isPreparation: input.isPreparation });
        setInput({ group: "", objective: "", run: "1", h2: "", plannedDate: "", name: "", isPreparation: false });
        setShowNewGroupForm(false);
    };

    const openGroupRunForm = (groupName) => {
        setGroupRunFormGroup(groupName);
        setGroupRunDraft({
            ...EMPTY_GROUP_RUN_DRAFT,
            run: groupUsesRunNumbers(groupName) ? getNextRunNumber(groupName) : "",
        });
        setGroupRunError("");
    };

    const closeGroupRunForm = () => {
        setGroupRunFormGroup(null);
        setGroupRunError("");
    };

    // The run name the group's "Add run" form would create ("" if not valid yet).
    const getGroupRunName = (groupName, draft) => (
        groupUsesRunNumbers(groupName)
            ? buildRunName(groupName, draft.run)
            : String(draft.name || '').trim()
    );

    // "Add run" inside a group: the group is fixed, only the run details are entered.
    const addRunToGroup = async (groupName) => {
        const draft = groupRunDraft;
        const numbered = groupUsesRunNumbers(groupName);
        const runName = getGroupRunName(groupName, draft);
        if (!runName) {
            setGroupRunError(numbered
                ? `Run # must be a number, e.g. ${getNextRunNumber(groupName)}, or ${getNextRunNumber(groupName)}-R1 for a repeat.`
                : 'Type a run name.');
            return;
        }
        if (getRunGroupKey(runName) !== groupName) {
            setGroupRunError(`"${runName}" would be listed in group ${getRunGroupKey(runName)}, not ${groupName}. Use New Run Group for a new group.`);
            return;
        }
        const error = await createRun({ runName, h2: draft.h2, plannedDate: draft.plannedDate, isPreparation: draft.isPreparation });
        if (error) {
            setGroupRunError(error);
            return;
        }
        setGroupRunError("");
        // Keep the form open for the next run of the series, with the next number.
        const { runNumber } = parseRunNameOrder(runName);
        setGroupRunDraft({
            ...EMPTY_GROUP_RUN_DRAFT,
            run: numbered && Number.isFinite(runNumber) ? String(runNumber + 1) : "",
        });
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
            // Keep every linked file, also ones not found in the run folder on
            // this computer (e.g. data not copied here yet); they are only
            // removed when the user unlinks them. Paths are stored with "/".
            const selected = linkedRunFiles(editingExp.meta?.dataFiles);
            const updatedEditingExp = {
                ...editingExp,
                meta: {
                    ...(editingExp.meta || {}),
                    h2InjectedGrams: String(gasMixingByRun[editedRunName]?.h2InjectedGrams || ''),
                    mfcFlowSlpm: String(gasMixingByRun[editedRunName]?.mfcFlowSlpm || ''),
                    p0: String(gasMixingByRun[editedRunName]?.pChamberPa || ''),
                    t0: String(gasMixingByRun[editedRunName]?.tChamberK || ''),
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
                    setRawDataFiles(Array.isArray(data?.files) ? data.files.map(toPosixPath) : []);
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
        const cleanPath = toPosixPath(pathValue);
        if (!cleanPath) return;
        const current = linkedRunFiles(editingExp.meta?.dataFiles);
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
                dataFiles: linkedRunFiles([...editingStaleLinkedFiles, ...editingRunScopedFiles])
            }
        });
    };

    const clearAllDataFilesForEditingExp = () => {
        if (!editingExp) return;
        // Clears the files of this run folder; links to files not found here stay.
        setEditingExp({
            ...editingExp,
            meta: {
                ...editingExp.meta,
                dataFiles: [...editingStaleLinkedFiles]
            }
        });
    };

    const unlinkMissingFilesForEditingExp = () => {
        if (!editingExp) return;
        const missing = new Set(editingStaleLinkedFiles);
        setEditingExp({
            ...editingExp,
            meta: {
                ...editingExp.meta,
                dataFiles: linkedRunFiles(editingExp.meta?.dataFiles).filter((path) => !missing.has(path))
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
    const scheduleGroupNames = Array.from(new Set(
        experiments
            .map((exp) => getRunGroupKey(exp?.name))
            .filter(Boolean)
    )).sort((a, b) => {
        if (a === "GENERAL") return 1;
        if (b === "GENERAL") return -1;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    const scheduleGroupColorByName = scheduleGroupNames.reduce((acc, groupName, index) => {
        acc[groupName] = GROUP_MARKER_COLORS[index % GROUP_MARKER_COLORS.length];
        return acc;
    }, {});
    const scheduleSource = [...experiments]
        .sort((a, b) => compareRunNames(a?.name, b?.name));
    const scheduleRunsByDay = new Map();
    scheduleSource.forEach((exp, index) => {
        const day = getPlannedDay(exp, index);
        const groupName = getRunGroupKey(exp?.name);
        if (!scheduleRunsByDay.has(day)) scheduleRunsByDay.set(day, []);
        scheduleRunsByDay.get(day).push({
            name: exp.name,
            groupName,
            groupColor: scheduleGroupColorByName[groupName] || GROUP_MARKER_COLORS[0],
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
            row[`${dayKey}Group`] = run?.groupName || '';
            row[`${dayKey}GroupColor`] = run?.groupColor || '';
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
    const scheduleGroupLegendExtraPx = scheduleGroupNames.length > 0 ? Math.ceil(scheduleGroupNames.length / 6) * 14 : 0;
    const scheduleChartHeightPx = Math.max(520 + scheduleGroupLegendExtraPx, (scheduleLaneCount * 40) + 130 + scheduleGroupLegendExtraPx);
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
        const groupColor = String(payload?.[`${dayKey}GroupColor`] || GROUP_MARKER_COLORS[0]).trim();
        const isDragging = draggingScheduleRun === runName;
        const statusStroke = visualStatus === 'done'
            ? 'hsl(var(--primary) / 0.42)'
            : (isDragging ? 'hsl(var(--foreground) / 0.55)' : 'hsl(var(--background) / 0.35)');
        const statusStrokeWidth = visualStatus === 'done'
            ? 0.9
            : (isDragging ? 1 : 0.45);
        return (
            <g
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                onMouseDown={(event) => beginScheduleRunDrag(event, runName, dayNumber)}
            >
                <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    rx={4}
                    ry={4}
                    fill={fill}
                    opacity={isDragging ? 0.88 : 1}
                    stroke={statusStroke}
                    strokeWidth={statusStrokeWidth}
                />
                <rect
                    x={x}
                    y={y}
                    width={7}
                    height={height}
                    rx={4}
                    ry={4}
                    fill="hsl(var(--card) / 0.85)"
                />
                <rect
                    x={x + 2}
                    y={y + 2}
                    width={3}
                    height={Math.max(0, height - 4)}
                    rx={3}
                    ry={3}
                    fill={groupColor}
                    opacity={1}
                />
            </g>
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
        // Done and planned bars are light tints (label in accent or text colour);
        // error and canceled bars are solid, so their label uses the background colour.
        const fill = visualStatus === 'done'
            ? 'hsl(var(--primary))'
            : (visualStatus === 'planned' ? 'hsl(var(--foreground))' : 'hsl(var(--background))');
        const stroke = visualStatus === 'done' ? 'hsl(var(--background) / 0.75)' : 'hsl(var(--background) / 0.25)';
        return (
            <text
                x={x + width / 2}
                y={y + height / 2}
                fill={fill}
                fontSize={11}
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
    // Load the remembered fold state when the project changes.
    useEffect(() => {
        let stored = {};
        if (foldStorageKey) {
            try {
                const parsed = JSON.parse(window.localStorage.getItem(foldStorageKey) || '{}');
                if (parsed && typeof parsed === 'object') stored = parsed;
            } catch {
                stored = {};
            }
        }
        setCollapsedGroups(stored);
        setFoldStateLoadedFor(foldStorageKey);
    }, [foldStorageKey]);
    // Save it after every change (only once it was loaded for this project).
    useEffect(() => {
        if (!foldStorageKey || foldStateLoadedFor !== foldStorageKey) return;
        try {
            window.localStorage.setItem(foldStorageKey, JSON.stringify(collapsedGroups));
        } catch {
            // Storage full or blocked: folding still works for this visit.
        }
    }, [collapsedGroups, foldStorageKey, foldStateLoadedFor]);
    const setAllGroupsFolded = (folded) => {
        const next = {};
        Object.keys(groupedTasks).forEach((groupName) => { next[groupName] = folded; });
        setCollapsedGroups(next);
    };
    // Groups start folded so the plan reads as a list of group summaries;
    // false means the user unfolded that group.
    const isGroupCollapsed = useCallback((groupName) => collapsedGroups[groupName] !== false, [collapsedGroups]);
    const toggleGroupCollapse = useCallback((groupName) => {
        setCollapsedGroups((prev) => ({ ...prev, [groupName]: prev[groupName] === false }));
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

        // Keep the card reachable: its title bar stays on screen and at least
        // 160 px of its width stays visible, wherever it is dragged.
        const MARGIN = 8;
        const MIN_VISIBLE_X = 160;
        const TITLE_BAR = 72;
        const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
        const onMouseMove = (event) => {
            const start = dragStartRef.current;
            let deltaX = event.clientX - start.mouseX;
            let deltaY = event.clientY - start.mouseY;
            if (start.rect) {
                deltaX = clamp(deltaX, MIN_VISIBLE_X - start.rect.right, window.innerWidth - MIN_VISIBLE_X - start.rect.left);
                deltaY = clamp(deltaY, MARGIN - start.rect.top, window.innerHeight - TITLE_BAR - start.rect.top);
            }
            setModalOffset({
                x: start.startX + deltaX,
                y: start.startY + deltaY,
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
        refreshGasMixingMirror();
    }, [refreshGasMixingMirror]);

    // The two effects below run when a different run card is opened (its id
    // changes), not on every edit inside the open card. useEffectEvent lets
    // them read the card's current values without re-running on each edit
    // (re-running would, e.g., reset a just-chosen "Custom" ignition field).
    const editingExpId = editingExp?.id;

    const onRunCardOpened = useEffectEvent(() => {
        if (!editingExp) return;
        refreshGasMixingMirror();
    });
    useEffect(() => {
        onRunCardOpened();
    }, [editingExpId]);

    const syncEditorModesWithCard = useEffectEvent(() => {
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
    });
    useEffect(() => {
        syncEditorModesWithCard();
    }, [editingExpId]);

    // Drag the run card by its title area (or the grab button). Pressing on a
    // field or button inside the title area keeps its normal behaviour.
    const beginModalDrag = (event) => {
        if (event.button !== 0) return;
        const onControl = event.target.closest?.('input, select, textarea, a, button:not([data-drag-handle])');
        if (onControl) return;
        event.preventDefault();
        const rect = runCardRef.current?.getBoundingClientRect() || null;
        dragStartRef.current = {
            mouseX: event.clientX,
            mouseY: event.clientY,
            startX: modalOffset.x,
            startY: modalOffset.y,
            rect: rect && { left: rect.left, right: rect.right, top: rect.top },
        };
        setIsModalDragging(true);
    };

    const editingSelectedFiles = linkedRunFiles(editingExp?.meta?.dataFiles);
    const editingRunScopedFiles = editingExp ? filesForRunName(editingExp.name) : [];
    const editingStaleLinkedFiles = missingLinkedFiles(editingSelectedFiles, editingRunScopedFiles);
    const editingIgnitionValue = String(editingExp?.meta?.ignition || '');
    const editingVentValue = String(editingExp?.meta?.vent || '');
    const editingIgnitionSelection = ignitionEditorMode;
    const editingVentSelection = ventEditorMode;
    const editingGasMirror = editingExp ? gasMixingByRun[normalizeRunKey(editingExp.name)] : null;
    const rawMirroredH2Injected = String(editingGasMirror?.h2InjectedGrams || '').trim();
    const mirroredH2InjectedNumeric = Number.parseFloat(rawMirroredH2Injected);
    const editingMirroredH2Injected = Number.isFinite(mirroredH2InjectedNumeric)
        ? mirroredH2InjectedNumeric.toFixed(3)
        : rawMirroredH2Injected;
    const editingMirroredMfcFlow = String(editingGasMirror?.mfcFlowSlpm || '');
    // Display only (item 8): stored values are unchanged.
    const editingMirroredPchamber = formatPressurePa(editingGasMirror?.pChamberPa);
    const editingMirroredTchamberK = formatTempK(editingGasMirror?.tChamberK);

    // Open the run card, optionally at a field (h2, ignition, vent, data).
    const openRunCard = (exp, focusField = '') => {
        setModalOffset({ x: 0, y: 40 });
        setEditError("");
        setRunCardFocusField(focusField);
        setEditingExp({ ...exp });
    };
    const MISSING_FIELD_KEYS = { 'H2%': 'h2', Ignition: 'ignition', Vent: 'vent', Data: 'data' };

    // Status parts for a run group row; "missing metadata" is shown as a warning.
    const summarizeRunGroup = (tasks) => [
        { label: 'done', count: tasks.filter((task) => task.done).length },
        { label: 'error', count: tasks.filter((task) => task.meta?.hasError).length },
        { label: 'canceled', count: tasks.filter((task) => !task.meta?.hasError && task.meta?.isCanceled).length },
        { label: 'missing metadata', count: tasks.filter((task) => !isReady(task)).length, warning: true },
    ].filter((part) => part.count > 0);

    const renderRunCard = (e) => (
        <div key={e.id} draggable onDragStart={()=>setDraggedId(e.id)} onDragOver={ev=>ev.preventDefault()} onDrop={()=>onDrop(e.id)} className={`flex flex-col p-3 bg-background/50 border rounded group transition-all ${isReady(e) ? 'border-border hover:border-border' : 'border-warning/50 hover:border-warning/70'}`}>
            <div className="flex items-center gap-2">
                <GripVertical size={14} className="text-muted-foreground cursor-grab active:cursor-grabbing"/>
                <button 
                    onClick={() => setExperiments(experiments.map(x => x.id === e.id ? {...x, done: !x.done} : x))} 
                    disabled={!isReady(e)}
                    className={`${isReady(e) ? 'text-muted-foreground hover:text-primary' : 'text-muted-foreground/50 cursor-not-allowed'}`}
                >
                    {e.done ? <CheckSquare size={16} className="text-[hsl(var(--primary))]"/> : <Square size={16}/>}
                </button>
                <span
                    title={String(e.name || '')}
                    className={`text-[13px] leading-snug flex-1 min-w-0 pr-2 font-mono font-semibold break-all ${
                        e.done ? 'text-muted-foreground' : 'text-foreground/85'
                    }`}
                >
                    {e.name}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                    <button onClick={() => openRunCard(e)} title="Edit run card" aria-label={`Edit run card ${e.name}`} className="text-muted-foreground hover:text-foreground p-1 hover:bg-muted rounded transition-colors"><PenTool size={12}/></button>
                    <button onClick={() => removeRunWithUndo(e.id)} title="Delete run" aria-label={`Delete run ${e.name}`} className="text-muted-foreground hover:text-destructive p-1 hover:bg-muted rounded transition-colors"><Trash2 size={12}/></button>
                </div>
            </div>

            <div className="ml-8 mt-2 flex flex-wrap gap-2">
                {String(e.meta?.h2 || '').trim() && (
                    <div className="flex items-center gap-1 bg-primary/10 border border-primary/30 px-1.5 py-0.5 rounded text-[11px] text-primary font-bold">
                        <Beaker size={8}/> {formatVolPercentLabel(e.meta.h2)} H2
                    </div>
                )}
                {formatRunSchedule(e) && (
                    <div className="flex items-center gap-1 border border-primary/30 bg-primary/10 px-1.5 py-0.5 rounded text-[11px] text-primary font-semibold">
                        <Calendar size={8}/> {formatRunSchedule(e)}
                    </div>
                )}
                {isPreparationRun(e) && (
                    <div className="flex items-center gap-1 border border-warning/40 bg-warning/10 px-1.5 py-0.5 rounded text-[11px] text-warning font-semibold">
                        <Wrench size={8}/> Preparation
                    </div>
                )}
                {e.meta?.hasError && (
                    <div className="flex items-center gap-1 border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 rounded text-[11px] text-destructive font-semibold">
                        <AlertCircle size={8}/> Error
                    </div>
                )}
                {!e.meta?.hasError && e.meta?.isCanceled && (
                    <div className="flex items-center gap-1 border border-warning/40 bg-warning/10 px-1.5 py-0.5 rounded text-[11px] text-warning font-semibold">
                        <X size={8}/> Canceled
                    </div>
                )}
                {isReady(e) ? (
                    <>
                        <div className="flex items-center gap-1 border border-border px-1.5 py-0.5 rounded text-[11px] text-muted-foreground">
                            <Gauge size={8}/> {formatPressurePa(e.meta.p0) || '-'} Pa
                        </div>
                        <div className="flex items-center gap-1 border border-border px-1.5 py-0.5 rounded text-[11px] text-muted-foreground">
                            <Thermometer size={8}/> {formatTempK(e.meta.t0) || '-'} K
                        </div>
                        {!!(Array.isArray(e.meta?.dataFiles) && e.meta.dataFiles.length) && (
                            <div className="flex items-center gap-1 border border-primary/30 bg-primary/10 px-1.5 py-0.5 rounded text-[11px] text-primary font-semibold">
                                <Layers size={8}/> {e.meta.dataFiles.length} data file{e.meta.dataFiles.length > 1 ? 's' : ''}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex flex-wrap items-center gap-1 bg-warning/15 border border-warning/50 px-1.5 py-0.5 rounded text-[11px] text-warning font-bold tracking-wide">
                        <AlertCircle size={8}/> Missing:
                        {getMissingMeta(e).map((label, index, all) => (
                            <React.Fragment key={label}>
                                <button
                                    type="button"
                                    onClick={() => openRunCard(e, MISSING_FIELD_KEYS[label] || '')}
                                    title={`Open the run card at ${label}`}
                                    className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                                >
                                    {label}
                                </button>
                                {index < all.length - 1 ? ',' : ''}
                            </React.Fragment>
                        ))}
                    </div>
                )}
            </div>
            {/* Short description: shown when filled in, edited in the run card. */}
            {String(e.meta?.shortDescription || '').trim() && (
                <div className="ml-8 mt-2 text-[11px] italic text-foreground/75 break-words" title="Edit in the run card (pen icon)">
                    {e.meta.shortDescription}
                </div>
            )}
        </div>
    );

    const runGroupCount = Object.keys(groupedTasks).length;
    const fieldLabelClass = "flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-muted-foreground";
    const fieldInputClass = "w-full bg-background border border-border rounded px-2 py-1.5 text-xs font-normal outline-none focus:border-primary text-foreground";
    const newGroupRunName = String(input.name || '').trim() || buildRunName(input.group, input.run);

    return (
        <div className="flex h-full flex-col gap-4 overflow-y-auto custom-scrollbar pr-2">
            {/* PLAN FILE: name, save, load, export */}
            <div className="bg-card/60 border border-border rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
                <FlaskConical size={16} className="text-primary shrink-0"/>
                <input value={planName} onChange={e=>setPlanName(e.target.value)} aria-label="Plan name" title="Plan name" className="bg-transparent border-b border-border text-sm font-bold flex-1 min-w-[12rem] outline-none focus:border-primary text-foreground"/>
                <div className="flex flex-wrap items-center gap-1">
                    <button onClick={handleSavePlan} title="Save plan" aria-label="Save plan" className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"><Save size={18}/></button>
                    <button onClick={onImport} title="Load a plan file" aria-label="Load a plan file" className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"><Upload size={18}/></button>
                    <ExportFormatButtons
                        onExportCsv={exportPlanAsCsv}
                        onExportPdf={exportPlanAsPdf}
                        busyFormat={busyFormat}
                        size="sm"
                    />
                </div>
            </div>

            {/* KPIs. The objective, description, start and deadline are edited in the
                Project Description tab (same plan data, saved with the plan). */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <div className="bg-card/60 border border-border rounded-xl flex flex-col items-center justify-center p-2 text-center">
                    <div className="text-xl font-bold text-foreground/85 leading-none mb-1">{stats.hasDeadline ? stats.daysLeft : '—'}</div>
                    <div className="text-[11px] text-muted-foreground font-bold">Days until Deadline</div>
                    {!stats.hasDeadline && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">Set a deadline in Project Description</div>
                    )}
                </div>
                <div className="bg-card/60 border border-border rounded-xl flex flex-col items-center justify-center p-2 text-center">
                    <div className="text-xl font-bold text-primary leading-none mb-1">{stats.pace || '—'}</div>
                    <div className="text-[11px] text-muted-foreground font-bold">Pace (Runs/Day)</div>
                </div>
                <div className="bg-card/60 border border-warning/30 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                    <div className="text-xl font-bold text-warning leading-none mb-1">{stats.canceled}</div>
                    <div className="text-[11px] text-muted-foreground font-bold">Canceled Runs</div>
                </div>
                <div className="bg-card/60 border border-destructive/30 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                    <div className="text-xl font-bold text-destructive leading-none mb-1">{stats.errors}</div>
                    <div className="text-[11px] text-muted-foreground font-bold">Error Runs</div>
                </div>
                <div className="bg-card/60 border border-info/30 rounded-xl flex flex-col items-center justify-center p-2 text-center">
                    <div className="text-xl font-bold text-info leading-none mb-1">{stats.preparation}</div>
                    <div className="text-[11px] text-muted-foreground font-bold">Preparation Runs</div>
                </div>
                <div className="bg-card/60 border border-border rounded-xl flex flex-col items-center justify-center p-2 text-center">
                    <div className="text-xl font-bold text-foreground leading-none mb-1">{stats.completionPercent}%</div>
                    <div className="text-[11px] text-muted-foreground font-bold">Completion ({stats.done}/{stats.total})</div>
                    <div className="mt-2 h-1 w-full max-w-[120px] rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${stats.completionPercent}%` }} />
                    </div>
                </div>
            </div>

            {/* TIMELINE */}
            <div
                className="bg-card/60 border border-border p-4 rounded-xl shrink-0 flex flex-col"
                style={{ height: `${scheduleChartHeightPx}px` }}
            >
                <h3 className="text-[11px] font-bold text-muted-foreground mb-4 flex items-center gap-2 tracking-wide"><Clock size={12}/> Campaign Schedule</h3>
                <div
                    ref={scheduleChartAreaRef}
                    className="flex-1 bg-background/50 rounded-lg border border-border/[0.58] overflow-hidden"
                    style={{ cursor: draggingScheduleRun ? 'grabbing' : 'default' }}
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            layout="vertical"
                            data={scheduleData}
                            barSize={22}
                            margin={{left: 16, right: 24, top: 16, bottom: 22}}
                        >
                            <CartesianGrid strokeDasharray="2 4" horizontal={false} stroke="hsl(var(--border))" />
                            <XAxis
                                type="number"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={11}
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
                <div className="mt-2 text-[11px] text-muted-foreground text-center">
                    Drag a run block left/right to move its planned day. Click opens Run Metadata Card.
                </div>
                <div className="mt-3 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm border border-primary/40 bg-primary/15" />
                        <span>Done</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning" />
                        <span>Canceled</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-destructive" />
                        <span>Error</span>
                    </div>
                </div>
                {scheduleGroupNames.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="font-bold uppercase tracking-wide text-muted-foreground">Groups</span>
                        {scheduleGroupNames.map((groupName) => (
                            <span key={groupName} className="inline-flex items-center gap-1.5">
                                <span
                                    className="inline-block h-2 w-2 rounded-[2px]"
                                    style={{ backgroundColor: scheduleGroupColorByName[groupName] || GROUP_MARKER_COLORS[0] }}
                                />
                                <span>{groupName}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>


            {/* RUN GROUPS */}
            <section className="flex flex-col gap-3" aria-label="Run groups">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[11px] font-bold text-muted-foreground flex items-center gap-2 tracking-wide"><Layers size={12}/> Run Groups</h3>
                    <span className="text-[11px] text-muted-foreground">
                        {runGroupCount} {runGroupCount === 1 ? 'group' : 'groups'} · {stats.total} {stats.total === 1 ? 'run' : 'runs'}
                    </span>
                    {runGroupCount > 1 && (
                        <span className="flex items-center gap-1 text-[11px]">
                            <button type="button" onClick={() => setAllGroupsFolded(false)} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Open all</button>
                            <span className="text-muted-foreground">·</span>
                            <button type="button" onClick={() => setAllGroupsFolded(true)} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Fold all</button>
                        </span>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => { setShowNewGroupForm((open) => !open); setCreateError(""); }}
                            aria-expanded={showNewGroupForm}
                            title="Start a new group of runs (e.g., a concentration series). To add a run to an existing group, open that group."
                            className="bg-primary/10 border border-primary/30 px-3 py-1.5 rounded text-primary hover:border-primary/60 hover:bg-primary/20 flex items-center justify-center gap-2 font-bold text-xs"
                        >
                            <Plus size={14}/> New Run Group
                        </button>
                        <button
                            type="button"
                            onClick={() => verifyRunFolders(true)}
                            className="border border-border px-3 py-1.5 rounded text-foreground/85 hover:border-ring hover:text-foreground flex items-center justify-center gap-2 font-semibold text-xs"
                        >
                            <Layers size={14}/> Sync run folders
                        </button>
                    </div>
                </div>
                {!!folderCheck.message && (
                    <div className={`text-[11px] ${
                        folderCheck.status === 'ok' ? 'text-primary' :
                        folderCheck.status === 'warning' ? 'text-warning' :
                        folderCheck.status === 'error' ? 'text-destructive' :
                        'text-muted-foreground'
                    }`}>
                        {folderCheck.message}
                    </div>
                )}

                {showNewGroupForm && (
                    <div className="bg-card/60 border border-border rounded-xl p-4 flex flex-col gap-3" aria-label="New run group">
                        <div className="text-xs font-bold text-foreground">New run group</div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className={fieldLabelClass}>
                                Group ID
                                <input
                                    value={input.group}
                                    onChange={e=>{ setInput({...input, group:e.target.value}); setCreateError(""); }}
                                    placeholder="e.g., VH2D-G01"
                                    className={fieldInputClass}
                                />
                            </label>
                            <label className={fieldLabelClass}>
                                Group objective (optional)
                                <input
                                    value={input.objective}
                                    onChange={e=>{ setInput({...input, objective:e.target.value}); setCreateError(""); }}
                                    placeholder="e.g., Repeatability, 16-20 vol.% H2"
                                    className={fieldInputClass}
                                />
                            </label>
                        </div>
                        <div className="text-[11px] text-muted-foreground">First run of the group (add more runs from inside the group):</div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <label className={fieldLabelClass}>
                                Run #
                                <input
                                    value={input.run}
                                    onChange={e=>{ setInput({...input, run:e.target.value}); setCreateError(""); }}
                                    placeholder="1, or 1-R1 for a repeat"
                                    className={fieldInputClass}
                                />
                            </label>
                            <label className={fieldLabelClass}>
                                H2 vol.%
                                <input
                                    value={input.h2}
                                    onChange={e=>{ setInput({...input, h2:e.target.value}); setCreateError(""); }}
                                    placeholder="e.g., 18"
                                    className={fieldInputClass}
                                />
                            </label>
                            <div className={fieldLabelClass}>
                                Planned date
                                <IsoDateInput
                                    value={input.plannedDate}
                                    onValueChange={next=>{ setInput({...input, plannedDate: next}); setCreateError(""); }}
                                    placeholder="YYYY-MM-DD"
                                    title="Planned date"
                                    className={`${fieldInputClass} pr-9`}
                                />
                            </div>
                        </div>
                        <label className={fieldLabelClass}>
                            Manual run name (optional, replaces Group ID + Run #)
                            <input
                                value={input.name}
                                onChange={e=>{ setInput({...input, name:e.target.value}); setCreateError(""); }}
                                placeholder="e.g., test5"
                                className={fieldInputClass}
                            />
                        </label>
                        <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                            <input
                                type="checkbox"
                                checked={!!input.isPreparation}
                                onChange={(e) => { setInput({ ...input, isPreparation: e.target.checked }); setCreateError(""); }}
                                className="h-3.5 w-3.5 accent-primary"
                            />
                            Preparation run (can be marked done without full metadata)
                        </label>
                        <div className="text-[11px] text-muted-foreground">
                            First run name: <span className="font-mono font-semibold text-foreground/85">{newGroupRunName || "--"}</span>
                            {newGroupRunName && (
                                <span> · group <span className="font-mono font-semibold text-foreground/85">{getRunGroupKey(newGroupRunName)}</span></span>
                            )}
                        </div>
                        {createError && (
                            <div className="text-[11px] text-destructive">{createError}</div>
                        )}
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => { setShowNewGroupForm(false); setCreateError(""); }}
                                className="border border-border px-3 py-1.5 rounded text-foreground/85 hover:border-ring hover:text-foreground font-semibold text-xs"
                            >
                                Cancel
                            </button>
                            <button type="button" onClick={addNewGroup} className="bg-primary/10 border border-primary/30 px-3 py-1.5 rounded text-primary hover:border-primary/60 hover:bg-primary/20 flex items-center justify-center gap-2 font-bold text-xs"><Plus size={14}/> Create Group</button>
                        </div>
                    </div>
                )}

                {lastDeletedRun?.experiment && (
                    <div className="mb-3 flex items-center justify-between gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                        <div className="truncate">
                            Run <span className="font-semibold">{lastDeletedRun.experiment.name}</span> deleted.
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={undoDeletedRun}
                                className="inline-flex items-center gap-1 rounded border border-warning/40 px-2 py-1 font-semibold text-warning hover:bg-warning/20"
                            >
                                <Undo2 size={12}/> Undo
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    clearDeleteUndoTimeout();
                                    setLastDeletedRun(null);
                                }}
                                className="text-warning/80 hover:text-warning"
                                aria-label="Dismiss delete notice"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    </div>
                )}
                {runGroupCount === 0 && (
                    <div className="rounded-xl border border-border bg-card/60 p-6 text-center text-xs text-muted-foreground">
                        No planned runs yet. Use New Run Group to start the campaign plan.
                    </div>
                )}
                {Object.entries(groupedTasks).map(([group, tasks]) => {
                    const folded = isGroupCollapsed(group);
                    const summary = summarizeRunGroup(tasks);
                    const objective = getGroupObjective(group);
                    const groupColor = scheduleGroupColorByName[group];
                    return (
                        <section
                            key={group}
                            className={`rounded-2xl border border-primary/25 bg-primary/[0.03] ${folded ? 'px-4 py-2.5 sm:px-5' : 'p-4 sm:p-5'}`}
                        >
                            <button
                                type="button"
                                onClick={() => toggleGroupCollapse(group)}
                                aria-expanded={!folded}
                                title={folded ? 'Show the runs in this group' : 'Fold this group'}
                                className={`flex w-full items-center gap-2 rounded-lg text-left ${folded ? '' : 'mb-4'}`}
                            >
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                                    <Layers className="text-primary" size={16} />
                                </div>
                                {groupColor && (
                                    <span
                                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                                        style={{ backgroundColor: groupColor }}
                                        title="Colour of this group in the campaign schedule"
                                    />
                                )}
                                <h2 className="shrink-0 font-mono text-base font-bold text-foreground">{group}</h2>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {tasks.length} {tasks.length === 1 ? 'run' : 'runs'}
                                    {summary.map((part) => (
                                        <React.Fragment key={part.label}>
                                            {' · '}
                                            <span className={part.warning ? 'font-semibold text-warning' : ''}>{part.count} {part.label}</span>
                                        </React.Fragment>
                                    ))}
                                </span>
                                {objective && (
                                    <span className="hidden min-w-0 truncate text-xs text-foreground/70 md:inline" title={objective}>
                                        · {objective}
                                    </span>
                                )}
                                {(() => {
                                    const doneCount = tasks.filter((task) => task.done).length;
                                    const percent = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
                                    return (
                                        <span className="ml-auto hidden shrink-0 items-center gap-2 sm:flex" title={`${doneCount} of ${tasks.length} runs done`}>
                                            <span className="h-1 w-20 overflow-hidden rounded-full bg-foreground/15">
                                                <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
                                            </span>
                                            <span className="w-9 text-right text-[11px] text-muted-foreground">{percent}%</span>
                                        </span>
                                    );
                                })()}
                                <ChevronDown
                                    size={16}
                                    className={`ml-auto shrink-0 text-muted-foreground transition-transform sm:ml-0 ${folded ? '-rotate-90' : ''}`}
                                />
                            </button>
                            {!folded && (
                                <>
                                    <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                                        <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
                                            Group objective
                                            <input
                                                value={objective}
                                                onChange={(event) => setGroupObjective(group, event.target.value)}
                                                placeholder="Group objective (short description)"
                                                className="min-w-0 bg-background border border-border rounded px-2 py-1 text-[11px] font-normal text-foreground/85 outline-none focus:border-primary"
                                            />
                                        </label>
                                        <div className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
                                            <label htmlFor={`rename-group-${group}`}>Rename group (updates all runs in this group)</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    id={`rename-group-${group}`}
                                                    value={groupRenameDrafts[group] ?? group}
                                                    onChange={(event) => {
                                                        const nextValue = event.target.value;
                                                        setGroupRenameDrafts((prev) => ({ ...prev, [group]: nextValue }));
                                                        setGroupRenameErrors((prev) => ({ ...prev, [group]: "" }));
                                                    }}
                                                    className="min-w-0 flex-1 bg-background border border-border rounded px-2 py-1 text-[11px] font-normal text-foreground/85 outline-none focus:border-primary"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => renameGroupRuns(group)}
                                                    className="shrink-0 border border-primary/40 bg-primary/10 text-primary px-2 py-1 rounded text-[11px] font-semibold hover:bg-primary/20"
                                                >
                                                    Apply Group Rename
                                                </button>
                                            </div>
                                            {!!groupRenameErrors[group] && (
                                                <div className="font-normal text-destructive">{groupRenameErrors[group]}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="mb-3 flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-semibold text-muted-foreground">Runs</span>
                                        {groupRunFormGroup !== group && (
                                            <button
                                                type="button"
                                                onClick={() => openGroupRunForm(group)}
                                                className="bg-primary/10 border border-primary/30 px-2.5 py-1 rounded text-primary hover:border-primary/60 hover:bg-primary/20 flex items-center gap-1.5 font-bold text-[11px]"
                                            >
                                                <Plus size={12}/> Add Run
                                            </button>
                                        )}
                                    </div>
                                    {groupRunFormGroup === group && (() => {
                                        const numbered = groupUsesRunNumbers(group);
                                        const previewName = getGroupRunName(group, groupRunDraft);
                                        const updateDraft = (patch) => { setGroupRunDraft((prev) => ({ ...prev, ...patch })); setGroupRunError(""); };
                                        return (
                                            <div className="mb-3 rounded-xl border border-primary/30 bg-background/50 p-3 flex flex-col gap-3" aria-label={`Add run to ${group}`}>
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                                    {numbered ? (
                                                        <label className={fieldLabelClass}>
                                                            Run #
                                                            <input
                                                                value={groupRunDraft.run}
                                                                onChange={(event) => updateDraft({ run: event.target.value })}
                                                                placeholder="e.g., 7, or 7-R1 for a repeat"
                                                                className={fieldInputClass}
                                                            />
                                                        </label>
                                                    ) : (
                                                        <label className={fieldLabelClass}>
                                                            Run name
                                                            <input
                                                                value={groupRunDraft.name}
                                                                onChange={(event) => updateDraft({ name: event.target.value })}
                                                                placeholder="e.g., test5"
                                                                className={fieldInputClass}
                                                            />
                                                        </label>
                                                    )}
                                                    <label className={fieldLabelClass}>
                                                        H2 vol.%
                                                        <input
                                                            value={groupRunDraft.h2}
                                                            onChange={(event) => updateDraft({ h2: event.target.value })}
                                                            placeholder="e.g., 18"
                                                            className={fieldInputClass}
                                                        />
                                                    </label>
                                                    <div className={fieldLabelClass}>
                                                        Planned date
                                                        <IsoDateInput
                                                            value={groupRunDraft.plannedDate}
                                                            onValueChange={(next) => updateDraft({ plannedDate: next })}
                                                            placeholder="YYYY-MM-DD"
                                                            title="Planned date"
                                                            className={`${fieldInputClass} pr-9`}
                                                        />
                                                    </div>
                                                    <label className="inline-flex items-center gap-2 self-end pb-1.5 text-[11px] text-muted-foreground">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!groupRunDraft.isPreparation}
                                                            onChange={(event) => updateDraft({ isPreparation: event.target.checked })}
                                                            className="h-3.5 w-3.5 accent-primary"
                                                        />
                                                        Preparation run
                                                    </label>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="text-[11px] text-muted-foreground">
                                                        New run: <span className="font-mono font-semibold text-foreground/85">{previewName || "--"}</span>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={closeGroupRunForm}
                                                            className="border border-border px-3 py-1.5 rounded text-foreground/85 hover:border-ring hover:text-foreground font-semibold text-xs"
                                                        >
                                                            Close
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => addRunToGroup(group)}
                                                            className="bg-primary/10 border border-primary/30 px-3 py-1.5 rounded text-primary hover:border-primary/60 hover:bg-primary/20 flex items-center justify-center gap-2 font-bold text-xs"
                                                        >
                                                            <Plus size={14}/> Add Run
                                                        </button>
                                                    </div>
                                                </div>
                                                {groupRunError && (
                                                    <div className="text-[11px] text-destructive">{groupRunError}</div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 min-[1700px]:grid-cols-4">
                                        {tasks.map(renderRunCard)}
                                    </div>
                                </>
                            )}
                        </section>
                    );
                })}
            </section>

            {/* RUN CARD MODAL */}
            {editingExp && (
                <ModalPortal>
                <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-[70] px-4 py-4 backdrop-blur-md overflow-y-auto">
                    <div
                        ref={runCardRef}
                        className="bg-background p-5 rounded-2xl border border-primary/30 w-full max-w-5xl shadow-2xl max-h-[76vh] overflow-hidden ring-1 ring-foreground/5 font-sans flex flex-col"
                        style={{ transform: `translate(${modalOffset.x}px, ${modalOffset.y}px)` }}
                    >
                        <div
                            className={`flex justify-between items-start mb-5 border-b border-border pb-4 select-none ${isModalDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                            onMouseDown={beginModalDrag}
                            title="Drag to move the run card"
                        >
                            <div className="min-w-0 flex-1">
                                <h3 className="text-foreground font-bold text-xl flex items-center gap-3 tracking-tight">
                                    <Beaker size={24} className="text-primary"/> Run Metadata Card
                                </h3>
                                <div className="mt-2 max-w-md">
                                    <label className="text-[11px] text-muted-foreground font-bold mb-1 block">Run name</label>
                                    <input
                                        value={editingExp.name || ''}
                                        onChange={(e) => { setEditingExp({ ...editingExp, name: e.target.value }); setEditError(""); }}
                                        className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                        placeholder="e.g., TEST-01-01"
                                    />
                                    {editError && (
                                        <div className="mt-2 text-[11px] text-destructive">{editError}</div>
                                    )}
                                </div>
                            </div>
                            <div className="ml-4 flex items-center gap-2">
                                <button
                                    type="button"
                                    data-drag-handle
                                    className={`text-muted-foreground hover:text-foreground/[0.92] bg-card p-2 rounded-full transition-all ${isModalDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                                    title="Drag card"
                                >
                                    <GripVertical size={16} />
                                </button>
                                <button onClick={()=>{ setEditError(""); setEditingExp(null); }} className="text-muted-foreground hover:text-foreground bg-card p-2 rounded-full transition-all hover:scale-110"><X size={20}/></button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2">
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 text-left">
                            <div className="space-y-6 md:col-span-3">
                                <div>
                                    <div className="flex items-center gap-2 text-foreground/85 font-semibold text-xs tracking-wide mb-3 border-b border-border pb-1">
                                        <TrendingUp size={12}/> Mixture Parameters
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pl-1 md:pl-2">
                                        <div data-run-field="h2"><label className="text-[11px] text-muted-foreground font-bold mb-1 block">Target H2%V</label><input value={editingExp.meta?.h2} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, h2:e.target.value}})} className="w-full bg-background border border-border rounded p-2.5 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., 10.5"/></div>
                                        <div>
                                            <label className="text-[11px] text-muted-foreground font-bold mb-1 block" title="Injected hydrogen mass">H2 injected (g) • mirrored from Gas Mixing</label>
                                            <input value={editingMirroredH2Injected} readOnly className="w-full bg-background border border-border rounded p-2.5 text-xs text-foreground/85 outline-none cursor-not-allowed" placeholder={loadingGasMixingMirror ? 'Loading...' : 'Not calculated yet'} />
                                        </div>
                                        <div>
                                            <label className="text-[11px] text-muted-foreground font-bold mb-1 block" title="Mass flow controller flow">MFC flow (SLPM) • mirrored from Gas Mixing</label>
                                            <input value={editingMirroredMfcFlow} readOnly className="w-full bg-background border border-border rounded p-2.5 text-xs text-foreground/85 outline-none cursor-not-allowed" placeholder={loadingGasMixingMirror ? 'Loading...' : 'Not calculated yet'} />
                                        </div>
                                        <div><label className="text-[11px] text-muted-foreground font-bold mb-1 block">Schedule Date</label><IsoDateInput value={editingExp.meta?.plannedDate || ''} onValueChange={next=>setEditingExp({...editingExp, meta:{...editingExp.meta, plannedDate: next, plannedDay: ''}})} placeholder="YYYY-MM-DD" className="w-full bg-background border border-border rounded p-2.5 pr-9 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary"/></div>
                                        <div>
                                            <label className="text-[11px] text-muted-foreground font-bold mb-1 block">Init. P (Pa) • mirrored from Gas Mixing</label>
                                            <input value={editingMirroredPchamber} readOnly className="w-full bg-background border border-border rounded p-2.5 text-xs text-foreground/85 outline-none cursor-not-allowed" placeholder={loadingGasMixingMirror ? 'Loading...' : 'Set in Gas Mixing'} />
                                        </div>
                                        <div>
                                            <label className="text-[11px] text-muted-foreground font-bold mb-1 block">Init. T (K) • mirrored from Gas Mixing</label>
                                            <input value={editingMirroredTchamberK} readOnly className="w-full bg-background border border-border rounded p-2.5 text-xs text-foreground/85 outline-none cursor-not-allowed" placeholder={loadingGasMixingMirror ? 'Loading...' : 'Set in Gas Mixing'} />
                                        </div>
                                        <div><label className="text-[11px] text-muted-foreground font-bold mb-1 block whitespace-nowrap">Recirc stop → ignition time (s)</label><input value={editingExp.meta?.recircStopToIgnitionSec || ''} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, recircStopToIgnitionSec:e.target.value}})} className="w-full bg-background border border-border rounded p-2.5 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., 120"/></div>
                                        <div className="md:col-span-2 lg:col-span-3 rounded border border-border p-2">
                                            <label className="text-[11px] text-muted-foreground font-bold mb-1 block">Actual ignition time (with time zone)</label>
                                            <div className="flex flex-wrap gap-2">
                                                <input
                                                    value={editingExp.meta?.actualIgnitionTime || ''}
                                                    onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, actualIgnitionTime:e.target.value, actualIgnitionTimeSource: editingExp.meta?.actualIgnitionTimeSource || 'entered manually'}})}
                                                    className="flex-1 min-w-[220px] bg-background border border-border rounded p-2.5 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                                    placeholder="e.g., 2026-07-02T18:50:35+02:00"
                                                />
                                                <input
                                                    value={editingExp.meta?.actualIgnitionTimeSource || ''}
                                                    onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, actualIgnitionTimeSource:e.target.value}})}
                                                    className="flex-1 min-w-[220px] bg-background border border-border rounded p-2.5 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                                    placeholder="Source (e.g., logbook, MF4 recording start)"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => loadIgnitionCandidates(editingExp.name)}
                                                    className="rounded border border-border px-2 py-1 text-[11px] text-foreground/85 hover:border-primary"
                                                >
                                                    {ignitionCandidates.loading ? 'Reading files…' : 'Suggest from instrument files'}
                                                </button>
                                            </div>
                                            {String(editingExp.meta?.actualIgnitionTime || '').trim() !== ''
                                                && !/(Z|[+-]\d{2}:?\d{2})$/.test(String(editingExp.meta?.actualIgnitionTime || '').trim()) && (
                                                <div className="mt-1 text-[11px] text-warning">State the time zone, e.g. +02:00 (CEST) or Z (UTC).</div>
                                            )}
                                            {ignitionCandidates.runName === editingExp.name && (ignitionCandidates.items.length > 0 || ignitionCandidates.error) && (
                                                <div className="mt-2 text-[11px] text-muted-foreground space-y-1">
                                                    {ignitionCandidates.error && <div className="text-warning">{ignitionCandidates.error}</div>}
                                                    {ignitionCandidates.items.map((c, idx) => (
                                                        <div key={`${c.source}-${c.file}-${idx}`} className="flex flex-wrap items-center gap-2">
                                                            <button
                                                                type="button"
                                                                disabled={!c.value}
                                                                onClick={() => setEditingExp({
                                                                    ...editingExp,
                                                                    meta: {
                                                                        ...editingExp.meta,
                                                                        actualIgnitionTime: c.value,
                                                                        actualIgnitionTimeSource: `${c.source} (${c.file}); ${c.timezone}`,
                                                                    },
                                                                })}
                                                                className="rounded border border-border px-1.5 py-0.5 text-foreground/[0.92] hover:border-primary disabled:opacity-40"
                                                            >
                                                                Use
                                                            </button>
                                                            <span className="font-mono text-foreground/[0.92]">{c.value || '-'}</span>
                                                            <span>{c.source}; {c.timezone}</span>
                                                            <span className="text-muted-foreground">{c.file}</span>
                                                            {c.note && <span className="text-muted-foreground">{c.note}</span>}
                                                        </div>
                                                    ))}
                                                    <div className="text-muted-foreground">Nothing is filled in automatically: choose the stamp that matches the ignition, or type the logbook time.</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 text-foreground/85 font-semibold text-xs tracking-wide mb-3 border-b border-border pb-1">
                                        <Zap size={12}/> Experimental Setup
                                    </div>
                                    <div className="space-y-4 pl-1 md:pl-2">
                                        <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                                            <input
                                                type="checkbox"
                                                checked={!!editingExp.meta?.isPreparation}
                                                onChange={(e)=>setEditingExp({...editingExp, meta:{...editingExp.meta, isPreparation:e.target.checked}})}
                                                className="h-3.5 w-3.5 accent-primary"
                                            />
                                            Preparation run (skip required metadata gate)
                                        </label>
                                        <div data-run-field="ignition">
                                            <label className="text-[11px] text-muted-foreground font-bold mb-1 block">Ignition Configuration</label>
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
                                                className="w-full bg-background border border-border rounded p-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
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
                                                    className="mt-2 w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                                    placeholder="Type custom ignition setup..."
                                                />
                                            )}
                                        </div>
                                        <div data-run-field="vent">
                                            <label className="text-[11px] text-muted-foreground font-bold mb-1 block">Venting Configuration</label>
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
                                                className="w-full bg-background border border-border rounded p-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
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
                                                    className="mt-2 w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                                    placeholder="Type custom vent setup..."
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6 md:col-span-2">
                                <div>
                                    <div className="flex items-center gap-2 text-foreground/85 font-semibold text-xs tracking-wide mb-3 border-b border-border pb-1">
                                        <Cpu size={12}/> Traceability Link
                                    </div>
                                    <div><label className="text-[11px] text-muted-foreground font-bold mb-1 block">Case ID / CFD Hash</label><input value={editingExp.meta?.cfdHash} onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, cfdHash:e.target.value}})} className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary" placeholder="e.g., #OFv2306-mesh-rev2"/></div>
                                </div>
                                <div data-run-field="data">
                                    <div className="flex items-center gap-2 text-foreground/85 font-semibold text-xs tracking-wide mb-3 border-b border-border pb-1">
                                        <Layers size={12}/> Associated Data Files
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-[11px] text-muted-foreground">
                                            Showing files detected in this run folder: <PathText className="text-foreground/85" path={`Raw_Data/${String(editingExp?.name || '').trim() || '<run>'}/`} />
                                        </div>
                                        <div className="max-h-32 overflow-y-auto pr-1 space-y-1 border border-border rounded bg-background/40 p-2">
                                            {editingRunScopedFiles.map((filePath) => {
                                                const checked = editingSelectedFiles.includes(filePath);
                                                const parts = String(filePath).split('/');
                                                const fileName = parts[parts.length - 1] || filePath;
                                                return (
                                                    <label key={filePath} className="flex items-start gap-2 text-[11px] text-foreground/85 cursor-pointer" title={filePath}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleDataFileForEditingExp(filePath)}
                                                            className="h-3 w-3 accent-primary mt-0.5"
                                                        />
                                                        <span className="min-w-0">
                                                            <span className="block break-all leading-tight text-primary font-semibold">{fileName}</span>
                                                            <PathText className="mt-0.5 block leading-tight text-muted-foreground text-[11px]" path={filePath} />
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                            {editingRunScopedFiles.length === 0 && (
                                                <div className="text-[11px] text-muted-foreground">No files found in this run folder.</div>
                                            )}
                                        </div>
                                        {editingRunScopedFiles.length > 0 && (
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={clearAllDataFilesForEditingExp}
                                                    className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground/[0.92] hover:bg-card transition-colors"
                                                >
                                                    Clear all
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={selectAllDataFilesForEditingExp}
                                                    className="text-[11px] px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                                >
                                                    Select all
                                                </button>
                                            </div>
                                        )}
                                        {editingStaleLinkedFiles.length > 0 && (
                                            <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning space-y-1">
                                                <div>
                                                    {editingStaleLinkedFiles.length} linked file(s) are not found in this run folder on this computer.
                                                    They stay linked; check that the data is in Raw_Data, or unlink them.
                                                </div>
                                                <ul className="font-mono text-[11px] text-warning/80 break-all">
                                                    {editingStaleLinkedFiles.map((path) => <li key={path}>{path}</li>)}
                                                </ul>
                                                <div className="flex justify-end">
                                                    <button
                                                        type="button"
                                                        onClick={unlinkMissingFilesForEditingExp}
                                                        className="text-[11px] px-2 py-1 rounded border border-warning/50 text-warning hover:bg-warning/10 transition-colors"
                                                    >
                                                        Unlink these files
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        <div className="text-[11px] text-muted-foreground">
                                            Selected: {editingSelectedFiles.length}
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 text-foreground/85 font-semibold text-xs tracking-wide mb-3 border-b border-border pb-1">
                                        <PenTool size={12}/> Operator Notes
                                    </div>
                                    <div className="mb-3 rounded border border-border bg-background/40 p-3 space-y-3">
                                        <div className="text-[11px] font-semibold tracking-wide text-muted-foreground">Run Status Flags</div>
                                        <label className="inline-flex items-center gap-2 text-[11px] text-foreground/85">
                                            <input
                                                type="checkbox"
                                                checked={!!editingExp.meta?.hasError}
                                                onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, hasError:e.target.checked}})}
                                                className="h-3.5 w-3.5 accent-destructive"
                                            />
                                            Error (plot color turns red)
                                        </label>
                                        <textarea
                                            value={editingExp.meta?.errorNote || ''}
                                            onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, errorNote:e.target.value}})}
                                            className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic h-16 outline-none focus:ring-1 focus:ring-destructive resize-none font-sans"
                                            placeholder="Error note (anomaly, root cause, traceback, etc.)"
                                        />
                                        <label className="inline-flex items-center gap-2 text-[11px] text-foreground/85">
                                            <input
                                                type="checkbox"
                                                checked={!!editingExp.meta?.isCanceled}
                                                onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, isCanceled:e.target.checked}})}
                                                className="h-3.5 w-3.5 accent-warning"
                                            />
                                            Canceled (plot color turns orange)
                                        </label>
                                        <textarea
                                            value={editingExp.meta?.canceledNote || ''}
                                            onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, canceledNote:e.target.value}})}
                                            className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic h-16 outline-none focus:ring-1 focus:ring-warning resize-none font-sans"
                                            placeholder="Canceled note (reason and next action)"
                                        />
                                        <div className="text-[11px] text-muted-foreground">
                                            If both are checked, chart color priority is: Error (red) over Canceled (orange).
                                        </div>
                                    </div>
                                    <div className="mb-3">
                                        <label className="text-[11px] text-muted-foreground font-bold mb-1 block">Short Description</label>
                                        <input
                                            value={editingExp.meta?.shortDescription || ''}
                                            onChange={e=>setEditingExp({...editingExp, meta:{...editingExp.meta, shortDescription:e.target.value}})}
                                            className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic outline-none focus:ring-1 focus:ring-primary"
                                            placeholder="One-line summary for this run"
                                        />
                                    </div>
                                    <textarea value={editingExp.notes} onChange={e=>setEditingExp({...editingExp, notes:e.target.value})} className="w-full bg-background border border-border rounded p-3 text-xs text-foreground placeholder:text-muted-foreground placeholder:italic h-24 outline-none focus:ring-1 focus:ring-primary resize-none font-sans" placeholder="e.g., Record sensor health, offsets, or observations..."/>
                                </div>
                            </div>
                        </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
                            <button onClick={()=>{ setEditError(""); setEditingExp(null); }} className="bg-card text-muted-foreground px-3 py-2 rounded-md font-semibold text-xs border border-border hover:bg-muted transition-all">Discard</button>
                            <button onClick={saveEdit} className="border border-primary/30 bg-primary/10 text-primary px-3 py-2 rounded-md font-semibold text-xs hover:bg-primary/20 transition-all">Save Run Card</button>
                        </div>
                    </div>
                </div>
                </ModalPortal>
            )}
            <UnifiedModal modal={dialogModal} setModal={setDialogModal} />
        </div>
    );
};

export default PlanPage;
