import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Plus, Pencil, Trash2, Copy, CheckCircle2, AlertTriangle, GripVertical, X, ChevronRight, ChevronDown } from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';
import UnifiedModal from '../components/UnifiedModal';
import ExportFormatButtons from '../components/ExportFormatButtons';
import { useAppDialog } from '../hooks/useAppDialog';

const COORDINATE_UNIT_OPTIONS = ['m', 'mm'];
const DEFAULT_COORDINATE_ORIGIN = '((0,0,0)) is defined at the centre of the internal back wall, at floor level. Positions are measured from this point inside the chamber.';
const CUSTOM_COORDINATE_ORIGIN = '__custom_coordinate_origin__';
const CAMERA_TYPE_OPTIONS = ['', 'High-speed camera', 'Infrared camera', 'Standard video camera', 'Other'];
const METHOD_USED_OPTIONS = ['', 'BOS (Background Oriented Schlieren)', 'Schlieren', 'Other'];
const TRIGGER_MODE_OPTIONS = ['', 'External trigger (M-Duino)', 'External trigger (DAQ)', 'Camera internal trigger', 'Manual trigger', 'Software trigger', 'Free run', 'Other'];
const RUN_GROUP_RE = /^(.*)-(\d+)(?:-[Rr]\d+)?$/;

const normalize = (value) => String(value || '').trim().toLowerCase();
const isNumeric = (value) => value !== '' && Number.isFinite(Number(value));

const createDefaultCamera = () => ({
  id: `camera-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  cameraId: '',
  cameraType: '',
  customCameraType: '',
  methodUsed: '',
  customMethodUsed: '',
  model: '',
  serialNumber: '',
  frameRate: '',
  resolution: '',
  lensFocalLength: '',
  shutterSpeed: '',
  aperture: '',
  iso: '',
  whiteBalance: '',
  x: '',
  y: '',
  z: '',
  coordinateUnit: 'm',
  coordinateOrigin: DEFAULT_COORDINATE_ORIGIN,
  mountingLocation: '',
  fieldOfView: '',
  triggerMode: '',
  customTriggerMode: '',
  synchronizationNotes: '',
  isActive: true,
  calibrationReference: '',
  emissivity: '',
  temperatureRange: '',
  notes: '',
});

const normalizeCameraRecord = (camera) => {
  const record = camera && typeof camera === 'object' ? camera : {};
  const normalized = {
    ...createDefaultCamera(),
    ...record,
    isActive: record.isActive !== false,
  };
  if (normalize(normalized.cameraType) === 'schlieren camera') {
    normalized.cameraType = '';
    normalized.customCameraType = '';
    if (!String(normalized.methodUsed || '').trim()) normalized.methodUsed = 'Schlieren';
  }
  if (!String(normalized.triggerMode || '').trim() && String(record.triggerSource || '').trim()) {
    const legacyTrigger = String(record.triggerSource || '').trim();
    const mappedLegacyTrigger = {
      'M-Duino': 'External trigger (M-Duino)',
      'DAQ trigger': 'External trigger (DAQ)',
    }[legacyTrigger] || legacyTrigger;
    normalized.triggerMode = mappedLegacyTrigger;
    normalized.customTriggerMode = String(record.customTriggerSource || '').trim();
  }
  return normalized;
};

const normalizeCamerasStatePayload = (payload) => {
  if (Array.isArray(payload)) {
    const fallbackGroup = 'Imported';
    return {
      selectedGroup: fallbackGroup,
      mappingsByGroup: {
        [fallbackGroup]: payload.map(normalizeCameraRecord),
      },
      groupNotes: {},
    };
  }
  if (payload && typeof payload === 'object' && payload.mappingsByGroup && typeof payload.mappingsByGroup === 'object') {
    const mappingsByGroup = Object.fromEntries(
      Object.entries(payload.mappingsByGroup).map(([groupName, cameras]) => ([
        String(groupName || '').trim(),
        Array.isArray(cameras) ? cameras.map(normalizeCameraRecord) : [],
      ])).filter(([groupName]) => Boolean(groupName)),
    );
    const groupNotes = payload.groupNotes && typeof payload.groupNotes === 'object' ? { ...payload.groupNotes } : {};
    const keys = Object.keys(mappingsByGroup);
    const selectedCandidate = String(payload.selectedGroup || '').trim();
    const selectedGroup = keys.includes(selectedCandidate) ? selectedCandidate : (keys[0] || '');
    return { selectedGroup, mappingsByGroup, groupNotes };
  }
  return { selectedGroup: '', mappingsByGroup: {}, groupNotes: {} };
};

const readCamerasFromStorage = (storageKey) => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return normalizeCamerasStatePayload(null);
    return normalizeCamerasStatePayload(JSON.parse(raw));
  } catch {
    return normalizeCamerasStatePayload(null);
  }
};

const getGroupFromRunName = (runName) => {
  const clean = String(runName || '').trim();
  if (!clean) return '';
  const match = clean.match(RUN_GROUP_RE);
  if (match && String(match[1] || '').trim()) return String(match[1]).trim();
  return '';
};

const listGroupsFromExperiments = (experiments) => {
  const names = new Set();
  (Array.isArray(experiments) ? experiments : []).forEach((item) => {
    const group = getGroupFromRunName(item?.name);
    if (group) names.add(group);
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
};

const displayCameraType = (camera) => {
  const type = String(camera.cameraType || '').trim();
  if (type === 'Other') return String(camera.customCameraType || '').trim() || 'Other';
  return type || '-';
};

const displayMethodUsed = (camera) => {
  const method = String(camera.methodUsed || '').trim();
  if (method === 'Other') return String(camera.customMethodUsed || '').trim() || 'Other';
  return method || '-';
};

const displayTriggerMode = (camera) => {
  const mode = String(camera.triggerMode || camera.triggerSource || '').trim();
  if (mode === 'Other') return String(camera.customTriggerMode || camera.customTriggerSource || '').trim() || 'Other';
  if (mode === 'M-Duino') return 'External trigger (M-Duino)';
  if (mode === 'DAQ trigger') return 'External trigger (DAQ)';
  return mode || '-';
};

const displayExposureSettings = (camera) => {
  const parts = [
    camera.shutterSpeed ? `Shutter ${camera.shutterSpeed}` : '',
    camera.aperture ? `Iris ${camera.aperture}` : '',
    camera.iso ? `ISO ${camera.iso}` : '',
    camera.whiteBalance ? `WB ${camera.whiteBalance}` : '',
  ].filter(Boolean);
  return parts.join(' | ') || '-';
};

const isInfraredCamera = (camera) => {
  const type = `${displayCameraType(camera)} ${camera.model || ''}`.toLowerCase();
  return type.includes('infrared') || type.includes('ir') || type.includes('thermal');
};

const validateCameraAgainstList = (camera, allCameras, currentId = null) => {
  const errors = [];
  const warnings = [];

  if (!String(camera.cameraId || '').trim()) errors.push('Camera ID missing');
  const duplicateCameraId = allCameras.some((other) => {
    if (currentId && other.id === currentId) return false;
    return normalize(other.cameraId) === normalize(camera.cameraId) && normalize(camera.cameraId) !== '';
  });
  if (duplicateCameraId) errors.push('Duplicate camera ID');

  if (!String(displayCameraType(camera) || '').trim() || displayCameraType(camera) === '-') warnings.push('Camera type missing');
  if (!String(displayMethodUsed(camera) || '').trim() || displayMethodUsed(camera) === '-') warnings.push('Method used missing');
  if (!String(camera.model || '').trim()) warnings.push('Model missing');
  if (!String(camera.serialNumber || '').trim()) warnings.push('Serial number missing');
  if (!String(camera.frameRate || '').trim()) warnings.push('Frame rate missing');
  if (!String(camera.resolution || '').trim()) warnings.push('Resolution missing');
  if (!String(camera.lensFocalLength || '').trim()) warnings.push('Lens / focal length missing');
  if (!String(camera.shutterSpeed || '').trim()) warnings.push('Shutter speed missing');
  if (!String(camera.aperture || '').trim()) warnings.push('Iris / aperture missing');
  if (!String(camera.iso || '').trim()) warnings.push('ISO missing');
  if (!String(camera.mountingLocation || '').trim()) warnings.push('Mounting description missing');
  if (!String(camera.fieldOfView || '').trim()) warnings.push('Field of view / target region missing');
  if (!String(displayTriggerMode(camera) || '').trim() || displayTriggerMode(camera) === '-') warnings.push('Trigger mode missing');
  if (!String(camera.synchronizationNotes || '').trim()) warnings.push('Synchronization notes missing');
  if (!String(camera.coordinateOrigin || '').trim()) warnings.push('Coordinate origin missing');
  if (!isNumeric(camera.x) || !isNumeric(camera.y) || !isNumeric(camera.z)) warnings.push('Coordinates x/y/z should be numeric');

  if (isInfraredCamera(camera)) {
    if (!String(camera.emissivity || '').trim()) warnings.push('IR emissivity missing');
    if (!String(camera.temperatureRange || '').trim()) warnings.push('IR temperature range missing');
  }

  return { errors, warnings };
};

const CamerasMappingPage = ({ projectPath = '' }) => {
  const apiBaseUrl = getBackendBaseUrl();
  const projectName = String(projectPath || '').split(/[/\\]/).filter(Boolean).pop() || 'No project selected';
  const storageKey = `exda:cameras-mapping:${projectPath || 'global'}`;
  const initialState = useMemo(() => readCamerasFromStorage(storageKey), [storageKey]);

  const [mappingsByGroup, setMappingsByGroup] = useState(initialState.mappingsByGroup);
  const [selectedGroup, setSelectedGroup] = useState(initialState.selectedGroup);
  const [groupNotes, setGroupNotes] = useState(initialState.groupNotes || {});
  const [showAllGroups, setShowAllGroups] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [planGroups, setPlanGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupError, setGroupError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState(createDefaultCamera());
  const [editingExistingId, setEditingExistingId] = useState(null);
  const [editingGroup, setEditingGroup] = useState(initialState.selectedGroup || '');
  const [coordinateOriginMode, setCoordinateOriginMode] = useState(DEFAULT_COORDINATE_ORIGIN);
  const [editorOffset, setEditorOffset] = useState({ x: 0, y: 40 });
  const [editorDragging, setEditorDragging] = useState(false);
  const [busyFormat, setBusyFormat] = useState('');
  const { dialogModal, setDialogModal, showAlert, showConfirm, showPrompt } = useAppDialog();
  const editorDragRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });
  const autoSaveRef = useRef({ ready: false });

  useEffect(() => {
    let cancelled = false;
    const hydrateFromProjectFile = async () => {
      if (!projectPath) {
        const storageState = readCamerasFromStorage(storageKey);
        if (cancelled) return;
        setMappingsByGroup(storageState.mappingsByGroup);
        setSelectedGroup(storageState.selectedGroup);
        setGroupNotes(storageState.groupNotes || {});
        return;
      }
      try {
        const response = await fetch(`${apiBaseUrl}/get_cameras_mapping?projectPath=${encodeURIComponent(projectPath)}`);
        const payload = await response.json();
        if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load cameras mapping');
        const serverState = normalizeCamerasStatePayload(payload);
        if (cancelled) return;
        setMappingsByGroup(serverState.mappingsByGroup || {});
        setSelectedGroup(serverState.selectedGroup || '');
        setGroupNotes(serverState.groupNotes || {});
      } catch {
        if (cancelled) return;
        setMappingsByGroup({});
        setSelectedGroup('');
        setGroupNotes({});
      }
    };
    hydrateFromProjectFile();
    return () => { cancelled = true; };
  }, [apiBaseUrl, projectPath, storageKey]);

  useEffect(() => {
    let cancelled = false;
    const loadPlanGroups = async () => {
      if (!projectPath) {
        if (!cancelled) setPlanGroups([]);
        return;
      }
      try {
        const response = await fetch(`${apiBaseUrl}/get_project_state?projectPath=${encodeURIComponent(projectPath)}`);
        const payload = await response.json();
        if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load project state');
        const groups = listGroupsFromExperiments(payload?.plan?.experiments || []);
        if (!cancelled) setPlanGroups(groups);
      } catch {
        if (!cancelled) setPlanGroups([]);
      }
    };
    loadPlanGroups();
    return () => { cancelled = true; };
  }, [apiBaseUrl, projectPath]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({ selectedGroup, mappingsByGroup, groupNotes }));
  }, [groupNotes, mappingsByGroup, selectedGroup, storageKey]);

  useEffect(() => {
    if (!projectPath) {
      autoSaveRef.current.ready = false;
      return undefined;
    }
    if (!autoSaveRef.current.ready) {
      autoSaveRef.current.ready = true;
      return undefined;
    }
    const timerId = window.setTimeout(async () => {
      try {
        await fetch(`${apiBaseUrl}/save_cameras_mapping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath,
            mappingsByGroup,
            groupNotes,
            selectedGroup: String(selectedGroup || ''),
          }),
        });
      } catch {
        // Continuous save is intentionally silent. Manual Save Now still reports errors.
      }
    }, 1200);
    return () => window.clearTimeout(timerId);
  }, [apiBaseUrl, groupNotes, mappingsByGroup, projectPath, selectedGroup]);

  const availableGroups = useMemo(() => {
    const merged = new Set([...planGroups, ...Object.keys(mappingsByGroup || {}), ...Object.keys(groupNotes || {})]);
    return Array.from(merged).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }, [mappingsByGroup, planGroups, groupNotes]);

  useEffect(() => {
    if (!availableGroups.includes(selectedGroup)) {
      setSelectedGroup(availableGroups[0] || '');
    }
  }, [availableGroups, selectedGroup]);

  useEffect(() => {
    setCollapsedGroups((prev) => {
      const next = {};
      availableGroups.forEach((group) => {
        if (group === selectedGroup) next[group] = false;
        else if (Object.prototype.hasOwnProperty.call(prev, group)) next[group] = prev[group];
        else next[group] = true;
      });
      return next;
    });
  }, [availableGroups, selectedGroup]);

  const cameras = useMemo(() => mappingsByGroup[selectedGroup] || [], [mappingsByGroup, selectedGroup]);
  const allGroupsExpanded = useMemo(() => availableGroups.length > 0 && availableGroups.every((group) => collapsedGroups[group] === false), [availableGroups, collapsedGroups]);
  const allGroupsCollapsed = useMemo(() => availableGroups.length > 0 && availableGroups.every((group) => collapsedGroups[group] === true), [availableGroups, collapsedGroups]);

  const updateGroupCameras = useCallback((groupName, updater) => {
    const targetGroup = String(groupName || '').trim();
    if (!targetGroup) return;
    setMappingsByGroup((prev) => {
      const current = prev[targetGroup] || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [targetGroup]: Array.isArray(next) ? next : current };
    });
  }, []);

  const buildValidationMap = useCallback((groupName) => {
    const groupCameras = mappingsByGroup[groupName] || [];
    const map = {};
    groupCameras.forEach((camera) => {
      map[camera.id] = validateCameraAgainstList(camera, groupCameras, camera.id);
    });
    return map;
  }, [mappingsByGroup]);

  const summarizeGroup = useCallback((groupName) => {
    const groupCameras = mappingsByGroup[groupName] || [];
    const groupValidation = buildValidationMap(groupName);
    let complete = 0;
    let warnings = 0;
    let errors = 0;
    groupCameras.forEach((camera) => {
      const result = groupValidation[camera.id] || { errors: [], warnings: [] };
      if (result.errors.length > 0) errors += 1;
      else if (result.warnings.length > 0) warnings += 1;
      else complete += 1;
    });
    return {
      total: groupCameras.length,
      active: groupCameras.filter((camera) => camera.isActive !== false).length,
      complete,
      warnings,
      errors,
    };
  }, [buildValidationMap, mappingsByGroup]);

  const validationById = useMemo(() => {
    const map = {};
    cameras.forEach((camera) => {
      map[camera.id] = validateCameraAgainstList(camera, cameras, camera.id);
    });
    return map;
  }, [cameras]);

  const summary = useMemo(() => {
    let complete = 0;
    let warnings = 0;
    let errors = 0;
    cameras.forEach((camera) => {
      const result = validationById[camera.id] || { errors: [], warnings: [] };
      if (result.errors.length > 0) errors += 1;
      else if (result.warnings.length > 0) warnings += 1;
      else complete += 1;
    });
    return {
      total: cameras.length,
      active: cameras.filter((camera) => camera.isActive !== false).length,
      complete,
      warnings,
      errors,
    };
  }, [cameras, validationById]);

  const resolveCoordinateOriginMode = useCallback((originValue) => {
    const origin = String(originValue || '').trim();
    if (!origin) return CUSTOM_COORDINATE_ORIGIN;
    if (origin === DEFAULT_COORDINATE_ORIGIN) return DEFAULT_COORDINATE_ORIGIN;
    return CUSTOM_COORDINATE_ORIGIN;
  }, []);

  const coordinateOriginSelection = useMemo(() => {
    const origin = String(editingCamera.coordinateOrigin || '').trim();
    if (coordinateOriginMode === CUSTOM_COORDINATE_ORIGIN) return CUSTOM_COORDINATE_ORIGIN;
    if (origin === DEFAULT_COORDINATE_ORIGIN) return DEFAULT_COORDINATE_ORIGIN;
    return CUSTOM_COORDINATE_ORIGIN;
  }, [coordinateOriginMode, editingCamera.coordinateOrigin]);

  const editorValidation = useMemo(() => {
    if (!editorOpen) return { errors: [], warnings: [] };
    const targetGroup = editingGroup || selectedGroup;
    const groupCameras = mappingsByGroup[targetGroup] || [];
    const candidatePool = editingExistingId
      ? groupCameras.map((camera) => (camera.id === editingExistingId ? editingCamera : camera))
      : [...groupCameras, editingCamera];
    return validateCameraAgainstList(editingCamera, candidatePool, editingExistingId);
  }, [editorOpen, editingGroup, selectedGroup, mappingsByGroup, editingExistingId, editingCamera]);

  const addManualGroup = () => {
    const requested = String(newGroupName || '').trim().replace(/[/\\]/g, '-');
    if (!requested) {
      setGroupError('Group name is required.');
      return;
    }
    const existing = availableGroups.find((group) => normalize(group) === normalize(requested));
    if (existing) {
      setSelectedGroup(existing);
      setNewGroupName('');
      setGroupError('');
      return;
    }
    setMappingsByGroup((prev) => ({ ...prev, [requested]: prev[requested] || [] }));
    setSelectedGroup(requested);
    setNewGroupName('');
    setGroupError('');
  };

  const generateGroupsFromPlan = () => {
    const candidates = (planGroups || []).map((group) => String(group || '').trim()).filter(Boolean);
    if (!candidates.length) {
      setGroupError('No plan groups found. Create runs in Plan first.');
      return;
    }
    const existing = new Set(Object.keys(mappingsByGroup || {}).map((group) => normalize(group)));
    const missing = candidates.filter((group) => !existing.has(normalize(group)));
    if (!missing.length) {
      setGroupError('All plan groups are already available.');
      return;
    }
    setMappingsByGroup((prev) => {
      const next = { ...prev };
      missing.forEach((group) => { next[group] = next[group] || []; });
      return next;
    });
    setSelectedGroup(missing[0]);
    setGroupError('');
  };

  const setNoteForGroup = (groupName, value) => {
    const key = String(groupName || '').trim();
    if (!key) return;
    setGroupNotes((prev) => ({ ...prev, [key]: String(value || '') }));
  };

  const makeUniqueGroupName = useCallback((baseName) => {
    const base = String(baseName || '').trim() || 'Group';
    const existing = new Set(availableGroups.map((group) => normalize(group)));
    if (!existing.has(normalize(base))) return base;
    let suffix = 1;
    while (suffix < 5000) {
      const candidate = `${base}-Copy${suffix === 1 ? '' : `-${suffix}`}`;
      if (!existing.has(normalize(candidate))) return candidate;
      suffix += 1;
    }
    return `${base}-${Date.now()}`;
  }, [availableGroups]);

  const duplicateGroup = async (sourceGroup) => {
    const source = String(sourceGroup || '').trim();
    if (!source) return;
    const defaultTarget = makeUniqueGroupName(`${source}-Copy`);
    const targetRaw = await showPrompt({
      title: 'Copy Camera Group',
      content: `Copy camera configuration from "${source}" to which group?`,
      label: 'Target Group',
      defaultValue: defaultTarget,
      placeholder: 'VH2D-Group-Copy',
      confirmLabel: 'Copy',
      type: 'success',
      confirmVariant: 'primary',
    });
    if (targetRaw == null) return;
    const target = String(targetRaw || '').trim().replace(/[/\\]/g, '-');
    if (!target || normalize(target) === normalize(source)) return;
    const targetExists = availableGroups.some((group) => normalize(group) === normalize(target));
    if (targetExists) {
      const confirmed = await showConfirm({
        title: 'Overwrite Existing Group?',
        content: `Group "${target}" already exists. Replace its camera configuration with "${source}"?`,
        type: 'error',
        confirmLabel: 'Overwrite',
        confirmVariant: 'destructive',
      });
      if (!confirmed) return;
    }
    const cloned = (mappingsByGroup[source] || []).map((camera) => ({
      ...camera,
      id: `camera-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    }));
    setMappingsByGroup((prev) => ({ ...prev, [target]: cloned }));
    setGroupNotes((prev) => ({ ...prev, [target]: String(prev[source] || '').trim() ? `Copied from ${source}: ${prev[source]}` : `Copied from ${source}` }));
    setSelectedGroup(target);
    setGroupError('');
  };

  const deleteGroup = async (groupName) => {
    const target = String(groupName || '').trim();
    if (!target) return;
    const confirmed = await showConfirm({
      title: 'Delete Camera Group?',
      content: `Delete camera group "${target}"?`,
      type: 'error',
      confirmLabel: 'Delete',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;
    const remainingGroups = availableGroups.filter((group) => group !== target);
    setMappingsByGroup((prev) => {
      const next = { ...prev };
      delete next[target];
      return next;
    });
    setGroupNotes((prev) => {
      const next = { ...prev };
      delete next[target];
      return next;
    });
    setSelectedGroup(remainingGroups[0] || '');
  };

  const renameGroup = async (sourceGroup) => {
    const source = String(sourceGroup || '').trim();
    if (!source) return;
    const proposedRaw = await showPrompt({
      title: 'Rename Camera Group',
      content: `Rename group "${source}" to:`,
      label: 'New Group Name',
      defaultValue: source,
      placeholder: 'Group-Name',
      confirmLabel: 'Rename',
      type: 'success',
      confirmVariant: 'primary',
    });
    if (proposedRaw == null) return;
    const proposed = String(proposedRaw || '').trim().replace(/[/\\]/g, '-');
    if (!proposed || normalize(proposed) === normalize(source)) return;
    if (availableGroups.some((group) => normalize(group) === normalize(proposed))) {
      setGroupError(`Group "${proposed}" already exists.`);
      return;
    }
    setMappingsByGroup((prev) => {
      const next = { ...prev };
      const sourceData = Array.isArray(next[source]) ? next[source] : [];
      delete next[source];
      next[proposed] = sourceData;
      return next;
    });
    setGroupNotes((prev) => {
      const next = { ...prev };
      const sourceNote = String(next[source] || '');
      delete next[source];
      next[proposed] = sourceNote;
      return next;
    });
    if (selectedGroup === source) setSelectedGroup(proposed);
    if (editingGroup === source) setEditingGroup(proposed);
    setGroupError('');
  };

  const openAdd = (groupName = selectedGroup) => {
    setSelectedGroup(groupName);
    setCollapsedGroups((prev) => ({ ...prev, [groupName]: false }));
    setEditingGroup(groupName);
    setEditingExistingId(null);
    setEditingCamera(createDefaultCamera());
    setCoordinateOriginMode(DEFAULT_COORDINATE_ORIGIN);
    setEditorOffset({ x: 0, y: 40 });
    setEditorOpen(true);
  };

  const openEdit = (camera, groupName = selectedGroup) => {
    const normalizedCamera = normalizeCameraRecord(camera);
    setSelectedGroup(groupName);
    setCollapsedGroups((prev) => ({ ...prev, [groupName]: false }));
    setEditingGroup(groupName);
    setEditingExistingId(normalizedCamera.id);
    setEditingCamera(normalizedCamera);
    setCoordinateOriginMode(resolveCoordinateOriginMode(normalizedCamera.coordinateOrigin));
    setEditorOffset({ x: 0, y: 40 });
    setEditorOpen(true);
  };

  const duplicateCamera = (camera, groupName = selectedGroup) => {
    const clone = {
      ...normalizeCameraRecord(camera),
      id: `camera-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      cameraId: `${camera.cameraId || 'Camera'}-Copy`,
      serialNumber: '',
    };
    updateGroupCameras(groupName, (prev) => [...prev, clone]);
  };

  const removeCamera = (cameraId, groupName = selectedGroup) => {
    updateGroupCameras(groupName, (prev) => prev.filter((camera) => camera.id !== cameraId));
  };

  const saveCamera = () => {
    const targetGroup = editingGroup || selectedGroup;
    const sanitized = normalizeCameraRecord(editingCamera);
    if (editingExistingId) {
      updateGroupCameras(targetGroup, (prev) => prev.map((camera) => (camera.id === editingExistingId ? { ...sanitized } : camera)));
    } else {
      updateGroupCameras(targetGroup, (prev) => [...prev, { ...sanitized }]);
    }
    setEditorOpen(false);
  };

  const exportCamerasArtifact = async (format) => {
    if (!projectPath) {
      await showAlert({ title: 'Project Required', content: 'Open a project first. Export files are saved to the project Reports folder.', type: 'error' });
      return;
    }
    try {
      setBusyFormat(format);
      const response = await fetch(`${apiBaseUrl}/export_cameras_mapping_artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, mappingsByGroup, groupNotes, groupNames: availableGroups, format }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error || `Failed to export ${format.toUpperCase()}`);
      await showAlert({ title: `${format.toUpperCase()} Exported`, content: payload.path, type: 'success', closeLabel: 'OK' });
    } catch (exportError) {
      await showAlert({ title: `${format.toUpperCase()} Export Failed`, content: exportError?.message || 'Unknown error', type: 'error' });
    } finally {
      setBusyFormat('');
    }
  };

  useEffect(() => {
    if (!editorDragging) return undefined;
    const onMouseMove = (event) => {
      const deltaX = event.clientX - editorDragRef.current.mouseX;
      const deltaY = event.clientY - editorDragRef.current.mouseY;
      setEditorOffset({ x: editorDragRef.current.startX + deltaX, y: editorDragRef.current.startY + deltaY });
    };
    const onMouseUp = () => setEditorDragging(false);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [editorDragging]);

  const beginEditorDrag = (event) => {
    if (event.button !== 0) return;
    editorDragRef.current = { mouseX: event.clientX, mouseY: event.clientY, startX: editorOffset.x, startY: editorOffset.y };
    setEditorDragging(true);
  };

  const renderCamerasTable = (groupName) => {
    const groupCameras = mappingsByGroup[groupName] || [];
    const groupValidationById = buildValidationMap(groupName);
    const groupNote = String(groupNotes[groupName] || '');
    const groupSummary = summarizeGroup(groupName);
    const isCollapsed = showAllGroups ? Boolean(collapsedGroups[groupName]) : false;
    return (
      <div className="rounded-xl border border-sidebar-border bg-card/60 p-4" key={groupName}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {showAllGroups && (
              <button
                type="button"
                onClick={() => setCollapsedGroups((prev) => ({ ...prev, [groupName]: !isCollapsed }))}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-sidebar-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                title={isCollapsed ? 'Expand group' : 'Collapse group'}
                aria-label={isCollapsed ? `Expand ${groupName}` : `Collapse ${groupName}`}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
            <h3 className="text-sm font-semibold text-foreground">
              Cameras Table ({groupName})
              {groupNote.trim() ? <span className="ml-2 text-xs font-normal text-muted-foreground">- {groupNote}</span> : null}
            </h3>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => duplicateGroup(groupName)} className="inline-flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/60"><Copy size={13} /> Copy To...</button>
            <button onClick={() => renameGroup(groupName)} className="inline-flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/60"><Pencil size={13} /> Rename</button>
            <button onClick={() => deleteGroup(groupName)} className="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/25"><Trash2 size={13} /> Delete</button>
            <button onClick={() => openAdd(groupName)} className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25"><Plus size={13} /> Add Camera</button>
          </div>
        </div>
        {isCollapsed ? (
          <div className="rounded-md border border-sidebar-border/60 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
            {groupSummary.total} cameras, {groupSummary.complete} complete, {groupSummary.warnings} warnings, {groupSummary.errors} errors
          </div>
        ) : (
          <>
            <div className="mb-3">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Group Reference Note
                <input
                  value={groupNote}
                  onChange={(event) => setNoteForGroup(groupName, event.target.value)}
                  placeholder="e.g., Same camera layout as previous group; no optical setup changes."
                  className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5 text-xs text-foreground"
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1780px] text-xs">
                <thead>
                  <tr className="border-b border-sidebar-border text-left text-muted-foreground">
                    <th className="py-2 pr-3">Camera ID</th>
                    <th className="py-2 pr-3">Type / Model</th>
                    <th className="py-2 pr-3">Method Used</th>
                    <th className="py-2 pr-3">Serial</th>
                    <th className="py-2 pr-3">FPS</th>
                    <th className="py-2 pr-3">Resolution</th>
                    <th className="py-2 pr-3">Lens</th>
                    <th className="py-2 pr-3">Exposure</th>
                    <th className="py-2 pr-3">Coord.(x,y,z)m</th>
                    <th className="py-2 pr-3">Mounting</th>
                    <th className="py-2 pr-3">FOV / Target</th>
                    <th className="py-2 pr-3">Trigger Mode</th>
                    <th className="py-2 pr-3">Emissivity</th>
                    <th className="py-2 pr-3">Temp Range</th>
                    <th className="py-2 pr-3">Active</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groupCameras.map((camera) => {
                    const result = groupValidationById[camera.id] || { errors: [], warnings: [] };
                    const status = result.errors.length > 0 ? 'error' : result.warnings.length > 0 ? 'warning' : 'complete';
                    return (
                      <tr key={camera.id} className="border-b border-sidebar-border/50">
                        <td className="py-2 pr-3 font-semibold text-foreground">{camera.cameraId || '-'}</td>
                        <td className="py-2 pr-3">{displayCameraType(camera)} / {camera.model || '-'}</td>
                        <td className="py-2 pr-3">{displayMethodUsed(camera)}</td>
                        <td className="py-2 pr-3">{camera.serialNumber || '-'}</td>
                        <td className="py-2 pr-3">{camera.frameRate || '-'}</td>
                        <td className="py-2 pr-3">{camera.resolution || '-'}</td>
                        <td className="py-2 pr-3">{camera.lensFocalLength || '-'}</td>
                        <td className="py-2 pr-3">{displayExposureSettings(camera)}</td>
                        <td className="py-2 pr-3">({camera.x || '-'},{camera.y || '-'},{camera.z || '-'}) {camera.coordinateUnit || 'm'}</td>
                        <td className="py-2 pr-3">{camera.mountingLocation || '-'}</td>
                        <td className="py-2 pr-3">{camera.fieldOfView || '-'}</td>
                        <td className="py-2 pr-3">{displayTriggerMode(camera)}</td>
                        <td className="py-2 pr-3">{camera.emissivity || '-'}</td>
                        <td className="py-2 pr-3">{camera.temperatureRange || '-'}</td>
                        <td className="py-2 pr-3">{camera.isActive !== false ? 'Yes' : 'No'}</td>
                        <td className="py-2 pr-3">
                          {status === 'complete' && <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 size={12} /> Complete</span>}
                          {status === 'warning' && (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 text-amber-400" title={result.warnings.join(' | ')}><AlertTriangle size={12} /> Warning</span>
                              <p className="max-w-[220px] text-[10px] leading-tight text-amber-300">{result.warnings[0]}</p>
                            </div>
                          )}
                          {status === 'error' && (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 text-destructive" title={result.errors.join(' | ')}><AlertTriangle size={12} /> Error</span>
                              <p className="max-w-[220px] text-[10px] leading-tight text-destructive/90">{result.errors[0]}</p>
                            </div>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEdit(camera, groupName)} className="rounded p-1 hover:bg-muted" title="Edit camera"><Pencil size={12} /></button>
                            <button onClick={() => duplicateCamera(camera, groupName)} className="rounded p-1 hover:bg-muted" title="Duplicate camera"><Copy size={12} /></button>
                            <button onClick={() => removeCamera(camera.id, groupName)} className="rounded p-1 text-destructive hover:bg-destructive/20" title="Remove camera"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="w-full space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-card/80 p-5">
        <div className="flex items-center gap-2">
          <Camera size={18} className="text-primary" />
          <h2 className="text-lg font-bold text-foreground">Cameras Mapping &amp; Traceability</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Track high-speed and infrared cameras, optical geometry, exposure settings, trigger mode/synchronization notes, and calibration references per campaign group.
        </p>
        <p className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          Project: <span className="text-foreground">{projectName}</span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Mapping Group</label>
          <select
            value={selectedGroup || ''}
            onChange={(event) => { setSelectedGroup(event.target.value); setGroupError(''); }}
            disabled={!availableGroups.length}
            className="rounded border border-sidebar-border bg-background px-2 py-1 text-xs text-foreground"
          >
            {!availableGroups.length && <option value="">No groups yet</option>}
            {availableGroups.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
          <input
            value={newGroupName}
            onChange={(event) => { setNewGroupName(event.target.value); setGroupError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addManualGroup(); } }}
            placeholder="New group (e.g., Test)"
            className="rounded border border-sidebar-border bg-background px-2 py-1 text-xs text-foreground"
          />
          <button type="button" onClick={addManualGroup} className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/15 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/25"><Plus size={11} /> Add Group</button>
          <button type="button" onClick={generateGroupsFromPlan} className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60">Generate from Plan</button>
          <button type="button" onClick={() => setShowAllGroups((prev) => !prev)} className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60">{showAllGroups ? 'Single Group View' : 'All Groups View'}</button>
          <button
            type="button"
            disabled={!showAllGroups || !availableGroups.length || allGroupsExpanded}
            onClick={() => {
              const next = {};
              availableGroups.forEach((group) => { next[group] = false; });
              setCollapsedGroups(next);
            }}
            className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Expand All
          </button>
          <button
            type="button"
            disabled={!showAllGroups || !availableGroups.length || allGroupsCollapsed}
            onClick={() => {
              const next = {};
              availableGroups.forEach((group) => { next[group] = true; });
              setCollapsedGroups(next);
            }}
            className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Collapse All
          </button>
          <ExportFormatButtons onExportCsv={() => exportCamerasArtifact('csv')} onExportPdf={() => exportCamerasArtifact('pdf')} busyFormat={busyFormat} size="sm" />
          {groupError && <span className="text-[11px] text-destructive">{groupError}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Total', showAllGroups ? availableGroups.reduce((acc, group) => acc + summarizeGroup(group).total, 0) : summary.total],
          ['Active', showAllGroups ? availableGroups.reduce((acc, group) => acc + summarizeGroup(group).active, 0) : summary.active],
          ['Complete', showAllGroups ? availableGroups.reduce((acc, group) => acc + summarizeGroup(group).complete, 0) : summary.complete],
          ['Warnings', showAllGroups ? availableGroups.reduce((acc, group) => acc + summarizeGroup(group).warnings, 0) : summary.warnings],
          ['Errors', showAllGroups ? availableGroups.reduce((acc, group) => acc + summarizeGroup(group).errors, 0) : summary.errors],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-sidebar-border bg-card/60 p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {availableGroups.length === 0 ? (
        <div className="rounded-xl border border-sidebar-border bg-card/60 p-4 text-sm text-muted-foreground">
          No camera mapping groups yet. Add one manually or use <span className="font-semibold text-foreground">Generate from Plan</span>.
        </div>
      ) : (
        showAllGroups
          ? <div className="space-y-4">{availableGroups.map((groupName) => renderCamerasTable(groupName))}</div>
          : renderCamerasTable(selectedGroup)
      )}

      {editorOpen && (
        <div className={`fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-background/80 px-4 py-4 backdrop-blur-md ${editorDragging ? 'select-none' : ''}`}>
          <div
            className="flex max-h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-primary/30 bg-zinc-950 p-5 font-sans shadow-2xl ring-1 ring-white/5 md:p-6"
            style={{ transform: `translate(${editorOffset.x}px, ${editorOffset.y}px)` }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{editingExistingId ? 'Edit Camera' : 'Add Camera'}</h3>
              <div className="flex items-center gap-3">
                <button type="button" className={`rounded-full bg-zinc-900 p-2 text-zinc-500 transition-all hover:text-zinc-200 ${editorDragging ? 'cursor-grabbing' : 'cursor-grab'}`} onMouseDown={beginEditorDrag} title="Drag window" aria-label="Drag window"><GripVertical size={16} /></button>
                <button onClick={() => setEditorOpen(false)} className="rounded-full bg-zinc-900 p-2 text-zinc-500 transition-all hover:scale-110 hover:text-white" title="Close" aria-label="Close"><X size={16} /></button>
              </div>
            </div>

            {(editorValidation.errors.length > 0 || editorValidation.warnings.length > 0) && (
              <div className="mt-3 rounded-lg border border-sidebar-border bg-background/60 p-3">
                {editorValidation.errors.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive">Open Issues</p>
                    <ul className="mt-1 space-y-1 text-xs text-destructive">
                      {editorValidation.errors.map((message) => <li key={`err-${message}`}>- {message}</li>)}
                    </ul>
                  </div>
                )}
                {editorValidation.warnings.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">Warnings</p>
                    <ul className="mt-1 space-y-1 text-xs text-amber-200">
                      {editorValidation.warnings.map((message) => <li key={`warn-${message}`}>- {message}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 grid flex-1 grid-cols-1 gap-4 overflow-y-auto px-1 pr-1 md:grid-cols-2 md:px-2">
              <label className="text-xs">Camera ID<input value={editingCamera.cameraId} onChange={(e) => setEditingCamera((prev) => ({ ...prev, cameraId: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Camera Type<select value={editingCamera.cameraType} onChange={(e) => setEditingCamera((prev) => ({ ...prev, cameraType: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{CAMERA_TYPE_OPTIONS.map((opt) => <option key={opt || 'blank'} value={opt}>{opt || 'Select camera type'}</option>)}</select></label>
              {editingCamera.cameraType === 'Other' && <label className="text-xs md:col-span-2">Custom Camera Type<input value={editingCamera.customCameraType || ''} onChange={(e) => setEditingCamera((prev) => ({ ...prev, customCameraType: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>}
              <label className="text-xs">Method Used<select value={editingCamera.methodUsed || ''} onChange={(e) => setEditingCamera((prev) => ({ ...prev, methodUsed: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{METHOD_USED_OPTIONS.map((opt) => <option key={opt || 'blank'} value={opt}>{opt || 'Select method'}</option>)}</select></label>
              {editingCamera.methodUsed === 'Other' && <label className="text-xs">Custom Method<input value={editingCamera.customMethodUsed || ''} onChange={(e) => setEditingCamera((prev) => ({ ...prev, customMethodUsed: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>}
              <label className="text-xs">Model<input value={editingCamera.model} onChange={(e) => setEditingCamera((prev) => ({ ...prev, model: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Serial Number<input value={editingCamera.serialNumber} onChange={(e) => setEditingCamera((prev) => ({ ...prev, serialNumber: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Frame Rate<input value={editingCamera.frameRate} onChange={(e) => setEditingCamera((prev) => ({ ...prev, frameRate: e.target.value }))} placeholder="e.g., 10000 fps" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Resolution<input value={editingCamera.resolution} onChange={(e) => setEditingCamera((prev) => ({ ...prev, resolution: e.target.value }))} placeholder="e.g., 1024 x 512" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Lens / Focal Length<input value={editingCamera.lensFocalLength} onChange={(e) => setEditingCamera((prev) => ({ ...prev, lensFocalLength: e.target.value }))} placeholder="e.g., 50 mm" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Shutter Speed<input value={editingCamera.shutterSpeed} onChange={(e) => setEditingCamera((prev) => ({ ...prev, shutterSpeed: e.target.value }))} placeholder="e.g., 1/10000 s or 100 us" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Iris / Aperture (F-number)<input value={editingCamera.aperture} onChange={(e) => setEditingCamera((prev) => ({ ...prev, aperture: e.target.value }))} placeholder="e.g., f/2.8" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">ISO<input value={editingCamera.iso} onChange={(e) => setEditingCamera((prev) => ({ ...prev, iso: e.target.value }))} placeholder="e.g., 800" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">White Balance<input value={editingCamera.whiteBalance} onChange={(e) => setEditingCamera((prev) => ({ ...prev, whiteBalance: e.target.value }))} placeholder="Optional; may not apply to monochrome cameras" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">X<input value={editingCamera.x} onChange={(e) => setEditingCamera((prev) => ({ ...prev, x: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Y<input value={editingCamera.y} onChange={(e) => setEditingCamera((prev) => ({ ...prev, y: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Z<input value={editingCamera.z} onChange={(e) => setEditingCamera((prev) => ({ ...prev, z: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Coordinate Unit<select value={editingCamera.coordinateUnit} onChange={(e) => setEditingCamera((prev) => ({ ...prev, coordinateUnit: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{COORDINATE_UNIT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select></label>
              <div className="text-xs md:col-span-2">
                <label className="block">Coordinate Origin</label>
                <select
                  value={coordinateOriginSelection}
                  onChange={(e) => {
                    const selected = e.target.value;
                    setCoordinateOriginMode(selected || CUSTOM_COORDINATE_ORIGIN);
                    setEditingCamera((prev) => ({
                      ...prev,
                      coordinateOrigin: selected === CUSTOM_COORDINATE_ORIGIN
                        ? (String(prev.coordinateOrigin || '').trim() === DEFAULT_COORDINATE_ORIGIN ? '' : prev.coordinateOrigin)
                        : selected,
                    }));
                  }}
                  className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5"
                >
                  <option value="">Select coordinate origin...</option>
                  <option value={DEFAULT_COORDINATE_ORIGIN}>{DEFAULT_COORDINATE_ORIGIN}</option>
                  <option value={CUSTOM_COORDINATE_ORIGIN}>Custom</option>
                </select>
                {coordinateOriginSelection === CUSTOM_COORDINATE_ORIGIN && (
                  <textarea value={editingCamera.coordinateOrigin} onChange={(e) => setEditingCamera((prev) => ({ ...prev, coordinateOrigin: e.target.value }))} className="mt-2 min-h-20 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" placeholder="Describe the coordinate origin used for this camera setup..." />
                )}
              </div>
              <label className="text-xs">Mounting Description<input value={editingCamera.mountingLocation} onChange={(e) => setEditingCamera((prev) => ({ ...prev, mountingLocation: e.target.value }))} placeholder="e.g., tripod outside left window, top rail bracket" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Field of View / Target Region<input value={editingCamera.fieldOfView} onChange={(e) => setEditingCamera((prev) => ({ ...prev, fieldOfView: e.target.value }))} placeholder="e.g., flame front first 1.5 m after chamber venting" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Trigger Mode<select value={editingCamera.triggerMode || ''} onChange={(e) => setEditingCamera((prev) => ({ ...prev, triggerMode: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{TRIGGER_MODE_OPTIONS.map((opt) => <option key={opt || 'blank'} value={opt}>{opt || 'Select trigger mode'}</option>)}</select></label>
              {editingCamera.triggerMode === 'Other' && <label className="text-xs">Custom Trigger Mode<input value={editingCamera.customTriggerMode || ''} onChange={(e) => setEditingCamera((prev) => ({ ...prev, customTriggerMode: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>}
              <label className="text-xs md:col-span-2">Synchronization Notes<textarea value={editingCamera.synchronizationNotes} onChange={(e) => setEditingCamera((prev) => ({ ...prev, synchronizationNotes: e.target.value }))} className="mt-1 min-h-20 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" placeholder="Trigger alignment, timing offsets, shared clocks, external sync, etc." /></label>
              <label className="text-xs">Emissivity<input value={editingCamera.emissivity} onChange={(e) => setEditingCamera((prev) => ({ ...prev, emissivity: e.target.value }))} placeholder="IR camera only, e.g., 0.95" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Temperature Range<input value={editingCamera.temperatureRange} onChange={(e) => setEditingCamera((prev) => ({ ...prev, temperatureRange: e.target.value }))} placeholder="IR camera only, e.g., -20 to 650 °C" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs md:col-span-2">Calibration / Reference Image<input value={editingCamera.calibrationReference} onChange={(e) => setEditingCamera((prev) => ({ ...prev, calibrationReference: e.target.value }))} placeholder="File name, folder path, or reference image ID" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="mt-5 inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={editingCamera.isActive !== false} onChange={(e) => setEditingCamera((prev) => ({ ...prev, isActive: e.target.checked }))} /> Active / enabled camera</label>
              <label className="text-xs md:col-span-2">Notes<textarea value={editingCamera.notes} onChange={(e) => setEditingCamera((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 min-h-20 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-sidebar-border px-1 pt-3 md:px-2">
              <button onClick={() => setEditorOpen(false)} className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-semibold">Cancel</button>
              <button onClick={saveCamera} className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-semibold text-primary">Save Camera</button>
            </div>
          </div>
        </div>
      )}
      <UnifiedModal modal={dialogModal} setModal={setDialogModal} />
    </div>
  );
};

export default CamerasMappingPage;
