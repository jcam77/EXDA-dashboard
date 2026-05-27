import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPinned, Plus, Pencil, Trash2, Copy, CheckCircle2, AlertTriangle, GripVertical, X } from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';

const QUANTITY_OPTIONS = [
  'pressure',
  'temperature',
  'concentration',
  'voltage',
  'acceleration',
  'flame_arrival',
  'photodiode',
  'other',
];
const SENSITIVITY_UNIT_OPTIONS = ['pC/bar', 'pC/kPa', 'mV/bar', 'mV/kPa', 'V/bar', 'V/kPa', 'other'];
const COORDINATE_UNIT_OPTIONS = ['m', 'mm'];
const MOUNTING_OPTIONS = ['flush', 'recessed', 'tube-mounted', 'surface-mounted', 'N/A', 'other'];
const TRIGGER_METHOD_OPTIONS = ['', 'Camera', 'M-Duino', 'Other'];
const RUN_GROUP_RE = /^(.*)-(\d+)(?:-[Rr]\d+)?$/;

const normalizeMountingMethodValue = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.toLowerCase() === 'flush-mounted') return 'flush';
  if (['n/a', 'na', 'not applicable'].includes(text.toLowerCase())) return 'N/A';
  return text;
};

const normalizeTriggerMethodValue = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text === 'M-Duino Control Box') return 'M-Duino';
  return text;
};

const normalizeSensorRecord = (sensor) => {
  const record = sensor && typeof sensor === 'object' ? sensor : {};
  return {
    ...record,
    mountingMethod: normalizeMountingMethodValue(record.mountingMethod),
    triggerMethod: normalizeTriggerMethodValue(record.triggerMethod),
  };
};

const createDefaultSensor = (id = '') => ({
  id: `sensor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  sensorId: id,
  measuredQuantity: 'pressure',
  daqSystem: 'Kistler LabAmp',
  daqChannel: '',
  manufacturer: 'Kistler',
  model: '',
  serialNumber: '',
  sensitivity: '',
  sensitivityUnit: 'pC/bar',
  locationLabel: '',
  x: '',
  y: '',
  z: '',
  coordinateUnit: 'm',
  coordinateOrigin: 'internal lower-front-left corner of chamber',
  mountingMethod: 'flush',
  isActive: true,
  isBlindSensor: false,
  isTriggerChannel: false,
  triggerMethod: '',
  notes: '',
  calibrationDate: '',
  calibrationCertificateId: '',
});

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

const normalize = (value) => String(value || '').trim().toLowerCase();
const isNumeric = (value) => value !== '' && Number.isFinite(Number(value));
const validateSensorAgainstList = (sensor, allSensors, currentId = null) => {
  const errors = [];
  const warnings = [];
  const isTrigger = sensor.isTriggerChannel === true;

  if (!String(sensor.sensorId || '').trim()) errors.push('Sensor ID missing');
  if (String(sensor.isActive) === 'true' || sensor.isActive === true) {
    if (!String(sensor.daqSystem || '').trim()) errors.push('DAQ system missing');
    if (!String(sensor.daqChannel || '').trim()) errors.push('DAQ channel missing');
  }
  if (!isTrigger) {
    if (!String(sensor.serialNumber || '').trim()) errors.push('Serial number missing');
    if (!isNumeric(sensor.sensitivity)) errors.push('Sensitivity missing or not numeric');
    else if (Number(sensor.sensitivity) === 0) errors.push('Sensitivity cannot be zero');
    if (!String(sensor.sensitivityUnit || '').trim()) errors.push('Sensitivity unit missing');
    if (!String(sensor.locationLabel || '').trim()) errors.push('Location label missing');
    if (!isNumeric(sensor.x) || !isNumeric(sensor.y) || !isNumeric(sensor.z)) errors.push('Coordinates x/y/z must be numeric');
    if (!String(sensor.coordinateOrigin || '').trim()) errors.push('Coordinate origin missing');
    if (!String(sensor.mountingMethod || '').trim()) errors.push('Mounting method missing');
  }

  const duplicateSensorId = allSensors.some((other) => {
    if (currentId && other.id === currentId) return false;
    return normalize(other.sensorId) === normalize(sensor.sensorId) && normalize(sensor.sensorId) !== '';
  });
  if (duplicateSensorId) errors.push('Duplicate sensor ID');

  if (!isTrigger) {
    if (!String(sensor.calibrationDate || '').trim()) warnings.push('Calibration date missing');
  }
  if (sensor.isActive && sensor.isBlindSensor) warnings.push('Sensor is active and blind/control');
  if (isTrigger && normalize(sensor.measuredQuantity) !== 'voltage') warnings.push('Trigger channel is usually measured as voltage');
  if (isTrigger && !String(sensor.triggerMethod || '').trim()) warnings.push('Trigger method missing');

  return { errors, warnings };
};

const normalizeSensorsStatePayload = (payload) => {
  if (Array.isArray(payload)) {
    const fallbackGroup = 'Imported';
    return {
      selectedGroup: fallbackGroup,
      mappingsByGroup: {
        [fallbackGroup]: payload.map(normalizeSensorRecord),
      },
      groupNotes: {},
    };
  }
  if (payload && typeof payload === 'object' && payload.mappingsByGroup && typeof payload.mappingsByGroup === 'object') {
    const mappingsByGroup = Object.fromEntries(
      Object.entries(payload.mappingsByGroup).map(([groupName, sensors]) => ([
        groupName,
        Array.isArray(sensors) ? sensors.map(normalizeSensorRecord) : [],
      ])),
    );
    const groupNotes = payload.groupNotes && typeof payload.groupNotes === 'object' ? { ...payload.groupNotes } : {};
    const keys = Object.keys(mappingsByGroup);
    const selectedCandidate = String(payload.selectedGroup || '').trim();
    const selectedGroup = keys.includes(selectedCandidate) ? selectedCandidate : (keys[0] || '');
    return { selectedGroup, mappingsByGroup, groupNotes };
  }
  return {
    selectedGroup: '',
    mappingsByGroup: {},
    groupNotes: {},
  };
};

const readSensorsFromStorage = (storageKey) => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return normalizeSensorsStatePayload(null);
    const parsed = JSON.parse(raw);
    return normalizeSensorsStatePayload(parsed);
  } catch {
    return normalizeSensorsStatePayload(null);
  }
};

const SensorsMappingPage = ({ projectPath = '' }) => {
  const apiBaseUrl = getBackendBaseUrl();
  const projectName = String(projectPath || '').split(/[/\\]/).filter(Boolean).pop() || 'No project selected';
  const storageKey = `exda:sensors-mapping:${projectPath || 'global'}`;
  const sensorLocationDiagramUrl = `${import.meta.env.BASE_URL}SensorMountingLocation-000.pdf`;

  const initialState = useMemo(() => readSensorsFromStorage(storageKey), [storageKey]);
  const [mappingsByGroup, setMappingsByGroup] = useState(initialState.mappingsByGroup);
  const [selectedGroup, setSelectedGroup] = useState(initialState.selectedGroup);
  const [groupNotes, setGroupNotes] = useState(initialState.groupNotes || {});
  const [showAllGroups, setShowAllGroups] = useState(true);
  const [planGroups, setPlanGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupError, setGroupError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSensor, setEditingSensor] = useState(createDefaultSensor());
  const [editingExistingId, setEditingExistingId] = useState(null);
  const [editingGroup, setEditingGroup] = useState(initialState.selectedGroup || '');
  const [editorError, setEditorError] = useState('');
  const [editorOffset, setEditorOffset] = useState({ x: 0, y: 40 });
  const [editorDragging, setEditorDragging] = useState(false);
  const [showMountingPreview, setShowMountingPreview] = useState(false);
  const editorDragRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });

  useEffect(() => {
    let cancelled = false;
    const hydrateFromProjectFile = async () => {
      const storageState = readSensorsFromStorage(storageKey);
      if (!projectPath) {
        if (cancelled) return;
        setMappingsByGroup(storageState.mappingsByGroup);
        setSelectedGroup(storageState.selectedGroup);
        setGroupNotes(storageState.groupNotes || {});
        return;
      }
      try {
        const response = await fetch(`${apiBaseUrl}/get_sensors_mapping?projectPath=${encodeURIComponent(projectPath)}`);
        const payload = await response.json();
        if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load sensors mapping');
        const serverState = normalizeSensorsStatePayload(payload);
        const hasServerState = (
          Object.keys(serverState.mappingsByGroup || {}).length > 0
          || Object.keys(serverState.groupNotes || {}).length > 0
          || Boolean(serverState.selectedGroup)
        );
        const nextState = hasServerState ? serverState : storageState;
        if (cancelled) return;
        setMappingsByGroup(nextState.mappingsByGroup);
        setSelectedGroup(nextState.selectedGroup);
        setGroupNotes(nextState.groupNotes || {});
      } catch {
        if (cancelled) return;
        setMappingsByGroup(storageState.mappingsByGroup);
        setSelectedGroup(storageState.selectedGroup);
        setGroupNotes(storageState.groupNotes || {});
      }
    };
    hydrateFromProjectFile();
    return () => { cancelled = true; };
  }, [apiBaseUrl, projectPath, storageKey]);

  const availableGroups = useMemo(() => {
    const merged = new Set([...planGroups, ...Object.keys(mappingsByGroup || {}), ...Object.keys(groupNotes || {})]);
    const sorted = Array.from(merged).filter(Boolean).sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    return sorted;
  }, [mappingsByGroup, planGroups, groupNotes]);

  useEffect(() => {
    if (!availableGroups.includes(selectedGroup)) {
      setSelectedGroup(availableGroups[0] || '');
    }
  }, [availableGroups, selectedGroup]);

  const sensors = useMemo(() => mappingsByGroup[selectedGroup] || [], [mappingsByGroup, selectedGroup]);

  const updateGroupSensors = useCallback((groupName, updater) => {
    const targetGroup = String(groupName || '').trim();
    if (!targetGroup) return;
    setMappingsByGroup((prev) => {
      const current = prev[targetGroup] || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return {
        ...prev,
        [targetGroup]: Array.isArray(next) ? next : current,
      };
    });
  }, []);

  const addManualGroup = () => {
    const requested = String(newGroupName || '').trim().replace(/[/\\]/g, '-');
    if (!requested) {
      setGroupError('Group name is required.');
      return;
    }
    const exists = availableGroups.some((group) => normalize(group) === normalize(requested));
    if (exists) {
      setSelectedGroup(availableGroups.find((group) => normalize(group) === normalize(requested)) || requested);
      setNewGroupName('');
      setGroupError('');
      return;
    }
    setMappingsByGroup((prev) => ({
      ...prev,
      [requested]: prev[requested] || [],
    }));
    setSelectedGroup(requested);
    setNewGroupName('');
    setGroupError('');
  };

  const generateGroupsFromPlan = () => {
    const candidates = (planGroups || [])
      .map((group) => String(group || '').trim())
      .filter(Boolean);
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
      missing.forEach((group) => {
        next[group] = next[group] || [];
      });
      return next;
    });
    setSelectedGroup(missing[0]);
    setGroupError('');
  };

  const setNoteForGroup = (groupName, value) => {
    const key = String(groupName || '').trim();
    if (!key) return;
    const nextValue = String(value || '');
    setGroupNotes((prev) => ({
      ...prev,
      [key]: nextValue,
    }));
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

  const duplicateGroup = (sourceGroup) => {
    const source = String(sourceGroup || '').trim();
    if (!source) return;
    const sourceGroupName = availableGroups.find((group) => normalize(group) === normalize(source)) || source;
    const sourceSensors = mappingsByGroup[sourceGroupName] || [];
    const defaultTarget = makeUniqueGroupName(`${sourceGroupName}-Copy`);
    const targetRaw = window.prompt(
      `Copy sensors configuration from "${sourceGroupName}" to which group? (existing or new)`,
      defaultTarget,
    );
    if (targetRaw == null) return;
    const targetGroupName = String(targetRaw || '').trim().replace(/[/\\]/g, '-');
    if (!targetGroupName) {
      setGroupError('Target group name is required.');
      return;
    }
    if (normalize(targetGroupName) === normalize(sourceGroupName)) {
      setGroupError('Target group must be different from source group.');
      return;
    }
    const targetExists = availableGroups.some((group) => normalize(group) === normalize(targetGroupName));
    if (targetExists) {
      const confirmedOverwrite = window.confirm(
        `Group "${targetGroupName}" already exists. Replace its sensors configuration with "${sourceGroupName}"?`,
      );
      if (!confirmedOverwrite) return;
    }
    const clonedSensors = sourceSensors.map((sensor) => ({
      ...sensor,
      id: `sensor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    }));
    setMappingsByGroup((prev) => ({
      ...prev,
      [targetGroupName]: clonedSensors,
    }));
    const sourceNote = String(groupNotes[sourceGroupName] || '').trim();
    setGroupNotes((prev) => ({
      ...prev,
      [targetGroupName]: sourceNote ? `Copied from ${sourceGroupName}: ${sourceNote}` : `Copied from ${sourceGroupName}`,
    }));
    setSelectedGroup(targetGroupName);
    setGroupError('');
  };

  const deleteGroup = (groupName) => {
    const target = String(groupName || '').trim();
    if (!target) return;
    const knownGroups = availableGroups.filter(Boolean);
    if (!knownGroups.includes(target)) return;
    const confirmed = window.confirm(`Delete sensors group "${target}"?`);
    if (!confirmed) return;

    if (knownGroups.length <= 1) {
      setMappingsByGroup({});
      setSelectedGroup('');
      setGroupError('');
      return;
    }

    const remainingGroups = knownGroups.filter((group) => group !== target);
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
    setGroupError('');
  };

  const renameGroup = (sourceGroup) => {
    const source = String(sourceGroup || '').trim();
    if (!source) return;
    const proposedRaw = window.prompt(`Rename group "${source}" to:`, source);
    if (proposedRaw == null) return;
    const proposed = String(proposedRaw || '').trim().replace(/[/\\]/g, '-');
    if (!proposed) {
      setGroupError('Group name is required.');
      return;
    }
    if (normalize(proposed) === normalize(source)) {
      setGroupError('');
      return;
    }
    const exists = availableGroups.some((group) => normalize(group) === normalize(proposed));
    if (exists) {
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
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || 'Failed to load project state');
        }
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
    window.localStorage.setItem(storageKey, JSON.stringify({
      selectedGroup,
      mappingsByGroup,
      groupNotes,
    }));
  }, [groupNotes, mappingsByGroup, selectedGroup, storageKey]);

  const validationById = useMemo(() => {
    const map = {};
    sensors.forEach((sensor) => {
      map[sensor.id] = validateSensorAgainstList(sensor, sensors, sensor.id);
    });
    return map;
  }, [sensors]);

  const buildValidationMap = useCallback((groupName) => {
    const groupSensors = mappingsByGroup[groupName] || [];
    const map = {};
    groupSensors.forEach((sensor) => {
      map[sensor.id] = validateSensorAgainstList(sensor, groupSensors, sensor.id);
    });
    return map;
  }, [mappingsByGroup]);

  const summarizeGroup = useCallback((groupName) => {
    const groupSensors = mappingsByGroup[groupName] || [];
    const groupValidation = buildValidationMap(groupName);
    let complete = 0;
    let warnings = 0;
    let errors = 0;
    groupSensors.forEach((sensor) => {
      const result = groupValidation[sensor.id] || { errors: [], warnings: [] };
      if (result.errors.length > 0) errors += 1;
      else if (result.warnings.length > 0) warnings += 1;
      else complete += 1;
    });
    return {
      total: groupSensors.length,
      active: groupSensors.filter((sensor) => sensor.isActive).length,
      blind: groupSensors.filter((sensor) => sensor.isBlindSensor).length,
      complete,
      warnings,
      errors,
    };
  }, [buildValidationMap, mappingsByGroup]);

  const summary = useMemo(() => {
    let complete = 0;
    let warnings = 0;
    let errors = 0;
    sensors.forEach((sensor) => {
      const result = validationById[sensor.id] || { errors: [], warnings: [] };
      if (result.errors.length > 0) errors += 1;
      else if (result.warnings.length > 0) warnings += 1;
      else complete += 1;
    });
    return {
      total: sensors.length,
      active: sensors.filter((sensor) => sensor.isActive).length,
      blind: sensors.filter((sensor) => sensor.isBlindSensor).length,
      complete,
      warnings,
      errors,
    };
  }, [sensors, validationById]);

  const editorValidation = useMemo(() => {
    if (!editorOpen) return { errors: [], warnings: [] };
    const targetGroup = editingGroup || selectedGroup;
    const groupSensors = mappingsByGroup[targetGroup] || [];
    const candidatePool = editingExistingId
      ? groupSensors.map((sensor) => (sensor.id === editingExistingId ? editingSensor : sensor))
      : [...groupSensors, editingSensor];
    return validateSensorAgainstList(editingSensor, candidatePool, editingExistingId);
  }, [
    editorOpen,
    editingGroup,
    selectedGroup,
    mappingsByGroup,
    editingExistingId,
    editingSensor,
  ]);

  const openAdd = (groupName = selectedGroup) => {
    setSelectedGroup(groupName);
    setEditingGroup(groupName);
    setEditorError('');
    setEditingExistingId(null);
    setEditingSensor(createDefaultSensor(''));
    setEditorOffset({ x: 0, y: 40 });
    setEditorOpen(true);
  };

  const openEdit = (sensor, groupName = selectedGroup) => {
    setSelectedGroup(groupName);
    setEditingGroup(groupName);
    setEditorError('');
    setEditingExistingId(sensor.id);
    setEditingSensor(normalizeSensorRecord(sensor));
    setEditorOffset({ x: 0, y: 40 });
    setEditorOpen(true);
  };

  const duplicateSensor = (sensor, groupName = selectedGroup) => {
    const clone = {
      ...normalizeSensorRecord(sensor),
      id: `sensor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      sensorId: `${sensor.sensorId || 'Sensor'}-Copy`,
      daqChannel: '',
    };
    updateGroupSensors(groupName, (prev) => [...prev, clone]);
  };

  const removeSensor = (sensorId, groupName = selectedGroup) => {
    updateGroupSensors(groupName, (prev) => prev.filter((sensor) => sensor.id !== sensorId));
  };

  const saveSensor = () => {
    const targetGroup = editingGroup || selectedGroup;
    const sanitized = normalizeSensorRecord(editingSensor);
    if (editingExistingId) {
      updateGroupSensors(targetGroup, (prev) => prev.map((sensor) => (sensor.id === editingExistingId ? { ...sanitized } : sensor)));
    } else {
      updateGroupSensors(targetGroup, (prev) => [...prev, { ...sanitized }]);
    }
    setEditorError('');
    setEditorOpen(false);
  };

  const exportSensorsArtifact = async (format) => {
    if (!projectPath) {
      window.alert('Open a project first. Export files are saved to the project Reports folder.');
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/export_sensors_mapping_artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          mappingsByGroup,
          groupNotes,
          groupNames: availableGroups,
          format,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `Failed to export ${format.toUpperCase()}`);
      }
      window.alert(`${format.toUpperCase()} exported to:\n${payload.path}`);
    } catch (exportError) {
      window.alert(`Could not export ${format.toUpperCase()}.\n${exportError?.message || 'Unknown error'}`);
    }
  };

  useEffect(() => {
    if (!editorDragging) return undefined;

    const onMouseMove = (event) => {
      const deltaX = event.clientX - editorDragRef.current.mouseX;
      const deltaY = event.clientY - editorDragRef.current.mouseY;
      setEditorOffset({
        x: editorDragRef.current.startX + deltaX,
        y: editorDragRef.current.startY + deltaY,
      });
    };
    const onMouseUp = () => {
      setEditorDragging(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [editorDragging]);

  const beginEditorDrag = (event) => {
    if (event.button !== 0) return;
    editorDragRef.current = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      startX: editorOffset.x,
      startY: editorOffset.y,
    };
    setEditorDragging(true);
  };

  const renderSensorsTable = (groupName) => {
    const groupSensors = mappingsByGroup[groupName] || [];
    const groupValidationById = buildValidationMap(groupName);
    const groupNote = String(groupNotes[groupName] || '');
    return (
      <div className="rounded-xl border border-sidebar-border bg-card/60 p-4" key={groupName}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Sensors Table ({groupName})
            {groupNote.trim() ? <span className="ml-2 text-xs font-normal text-muted-foreground">- {groupNote}</span> : null}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => duplicateGroup(groupName)}
              className="inline-flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/60"
            >
              <Copy size={13} /> Copy To...
            </button>
            <button
              onClick={() => renameGroup(groupName)}
              className="inline-flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/60"
            >
              <Pencil size={13} /> Rename
            </button>
            <button
              onClick={() => deleteGroup(groupName)}
              className="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/25"
            >
              <Trash2 size={13} /> Delete
            </button>
            <button onClick={() => openAdd(groupName)} className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25">
              <Plus size={13} /> Add Sensor
            </button>
          </div>
        </div>
        <div className="mb-3">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Group Reference Note
            <input
              value={groupNote}
              onChange={(event) => setNoteForGroup(groupName, event.target.value)}
              placeholder="e.g., Same configuration as VH2D-01; no sensor/channel changes."
              className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5 text-xs text-foreground"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-sidebar-border">
                <th className="py-2 pr-3">Sensor ID</th>
                <th className="py-2 pr-3">Quantity</th>
                <th className="py-2 pr-3">DAQ</th>
                <th className="py-2 pr-3">Serial</th>
                <th className="py-2 pr-3">Last Cal.</th>
                <th className="py-2 pr-3">Sensitivity</th>
                <th className="py-2 pr-3">Location</th>
                <th className="py-2 pr-3">Coord.(x,y,z)m</th>
                <th className="py-2 pr-3">Mounting</th>
                <th className="py-2 pr-3">Active</th>
                <th className="py-2 pr-3">Blind</th>
                <th className="py-2 pr-3">Trigger</th>
                <th className="py-2 pr-3">Trigger Method</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupSensors.map((sensor) => {
                const result = groupValidationById[sensor.id] || { errors: [], warnings: [] };
                const status = result.errors.length > 0 ? 'error' : result.warnings.length > 0 ? 'warning' : 'complete';
                return (
                  <tr key={sensor.id} className="border-b border-sidebar-border/50">
                    <td className="py-2 pr-3 font-semibold">{sensor.sensorId || '-'}</td>
                    <td className="py-2 pr-3">{sensor.measuredQuantity}</td>
                    <td className="py-2 pr-3">{sensor.daqSystem} / {sensor.daqChannel || '-'}</td>
                    <td className="py-2 pr-3">{sensor.serialNumber || '-'}</td>
                    <td className="py-2 pr-3">{sensor.calibrationDate || '-'}</td>
                    <td className="py-2 pr-3">{sensor.sensitivity || '-'} {sensor.sensitivityUnit || ''}</td>
                    <td className="py-2 pr-3">{sensor.locationLabel || '-'}</td>
                    <td className="py-2 pr-3">({sensor.x || '-'},{sensor.y || '-'},{sensor.z || '-'})</td>
                    <td className="py-2 pr-3">{sensor.mountingMethod || '-'}</td>
                    <td className="py-2 pr-3">{sensor.isActive ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-3">{sensor.isBlindSensor ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-3">{sensor.isTriggerChannel ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-3">{normalizeTriggerMethodValue(sensor.triggerMethod) || '-'}</td>
                    <td className="py-2 pr-3">
                      {status === 'complete' && (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 size={12} /> Complete
                        </span>
                      )}
                      {status === 'warning' && (
                        <div className="space-y-1">
                          <span
                            className="inline-flex items-center gap-1 text-amber-400"
                            title={result.warnings.join(' | ')}
                          >
                            <AlertTriangle size={12} /> Warning
                          </span>
                          <p className="max-w-[220px] text-[10px] leading-tight text-amber-300">
                            {result.warnings[0]}
                          </p>
                        </div>
                      )}
                      {status === 'error' && (
                        <div className="space-y-1">
                          <span
                            className="inline-flex items-center gap-1 text-destructive"
                            title={result.errors.join(' | ')}
                          >
                            <AlertTriangle size={12} /> Error
                          </span>
                          <p className="max-w-[220px] text-[10px] leading-tight text-destructive/90">
                            {result.errors[0]}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(sensor, groupName)} className="p-1 rounded hover:bg-muted"><Pencil size={12} /></button>
                        <button onClick={() => duplicateSensor(sensor, groupName)} className="p-1 rounded hover:bg-muted"><Copy size={12} /></button>
                        <button onClick={() => removeSensor(sensor.id, groupName)} className="p-1 rounded hover:bg-destructive/20 text-destructive"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-card/80 p-5">
        <div className="flex items-center gap-2">
          <MapPinned size={18} className="text-primary" />
          <h2 className="text-lg font-bold text-foreground">Sensors Mapping &amp; Traceability</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Map physical sensors to DAQ channels, spatial locations, mounting configurations, and calibration metadata.
        </p>
        <p className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          Project: <span className="text-foreground">{projectName}</span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Mapping Group</label>
          <select
            value={selectedGroup || ''}
            onChange={(event) => {
              setSelectedGroup(event.target.value);
              setGroupError('');
            }}
            disabled={!availableGroups.length}
            className="rounded border border-sidebar-border bg-background px-2 py-1 text-xs text-foreground"
          >
            {!availableGroups.length && (
              <option value="">No groups yet</option>
            )}
            {availableGroups.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
          </select>
          <input
            value={newGroupName}
            onChange={(event) => {
              setNewGroupName(event.target.value);
              setGroupError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addManualGroup();
              }
            }}
            placeholder="New group (e.g., Test)"
            className="rounded border border-sidebar-border bg-background px-2 py-1 text-xs text-foreground"
          />
          <button
            type="button"
            onClick={addManualGroup}
            className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/15 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/25"
          >
            <Plus size={11} /> Add Group
          </button>
          <button
            type="button"
            onClick={generateGroupsFromPlan}
            className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
          >
            Generate from Plan
          </button>
          <button
            type="button"
            onClick={() => setShowAllGroups((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
          >
            {showAllGroups ? 'Single Group View' : 'All Groups View'}
          </button>
          <button
            type="button"
            onClick={() => exportSensorsArtifact('csv')}
            className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => exportSensorsArtifact('pdf')}
            className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
          >
            Export PDF
          </button>
          {groupError && (
            <span className="text-[11px] text-destructive">{groupError}</span>
          )}
        </div>
      </div>

      <div className="w-full max-w-3xl rounded-xl border border-sidebar-border bg-card/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Sensor Mounting Location Reference</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMountingPreview((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
            >
              {showMountingPreview ? 'Hide Preview' : 'Preview'}
            </button>
            <a
              href={sensorLocationDiagramUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
            >
              Open PDF
            </a>
            <a
              href={sensorLocationDiagramUrl}
              download
              className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
            >
              Download
            </a>
          </div>
        </div>
        {showMountingPreview && (
          <div className="rounded-lg border border-sidebar-border overflow-hidden bg-background">
            <iframe
              title="Sensor mounting location reference diagram"
              src={sensorLocationDiagramUrl}
              className="w-full h-[260px]"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          ['Total', showAllGroups ? availableGroups.reduce((acc, group) => acc + summarizeGroup(group).total, 0) : summary.total],
          ['Active', showAllGroups ? availableGroups.reduce((acc, group) => acc + summarizeGroup(group).active, 0) : summary.active],
          ['Blind/Control', showAllGroups ? availableGroups.reduce((acc, group) => acc + summarizeGroup(group).blind, 0) : summary.blind],
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
          No mapping groups yet. Add one manually or use <span className="text-foreground font-semibold">Generate from Plan</span>.
        </div>
      ) : (
        showAllGroups
          ? (
            <div className="space-y-4">
              {availableGroups.map((groupName) => renderSensorsTable(groupName))}
            </div>
          )
          : renderSensorsTable(selectedGroup)
      )}

      {editorOpen && (
        <div className={`fixed inset-0 z-[70] bg-background/80 flex items-center justify-center px-4 py-4 backdrop-blur-md overflow-y-auto ${editorDragging ? 'select-none' : ''}`}>
          <div
            className="w-full max-w-3xl rounded-2xl border border-primary/30 bg-zinc-950 p-5 md:p-6 shadow-2xl max-h-[76vh] overflow-hidden ring-1 ring-white/5 font-sans flex flex-col"
            style={{ transform: `translate(${editorOffset.x}px, ${editorOffset.y}px)` }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{editingExistingId ? 'Edit Sensor' : 'Add Sensor'}</h3>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={`text-zinc-500 hover:text-zinc-200 bg-zinc-900 p-2 rounded-full transition-all ${editorDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onMouseDown={beginEditorDrag}
                  title="Drag window"
                  aria-label="Drag window"
                >
                  <GripVertical size={16} />
                </button>
                <button
                  onClick={() => setEditorOpen(false)}
                  className="text-zinc-500 hover:text-white bg-zinc-900 p-2 rounded-full transition-all hover:scale-110"
                  title="Close"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {(editorValidation.errors.length > 0 || editorValidation.warnings.length > 0) && (
              <div className="mt-3 rounded-lg border border-sidebar-border bg-background/60 p-3">
                {editorValidation.errors.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive">Open Issues (can be completed later)</p>
                    <ul className="mt-1 space-y-1 text-xs text-destructive">
                      {editorValidation.errors.map((message) => (
                        <li key={`err-${message}`}>• {message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {editorValidation.warnings.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">Warnings (recommended)</p>
                    <ul className="mt-1 space-y-1 text-xs text-amber-200">
                      {editorValidation.warnings.map((message) => (
                        <li key={`warn-${message}`}>• {message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex-1 overflow-y-auto pr-1 px-1 md:px-2 grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-xs">Sensor ID<input value={editingSensor.sensorId} onChange={(e) => setEditingSensor((prev) => ({ ...prev, sensorId: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Measured Quantity<select value={editingSensor.measuredQuantity} onChange={(e) => setEditingSensor((prev) => ({ ...prev, measuredQuantity: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{QUANTITY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select></label>
              <label className="text-xs">DAQ System<input value={editingSensor.daqSystem} onChange={(e) => setEditingSensor((prev) => ({ ...prev, daqSystem: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">DAQ Channel<input value={editingSensor.daqChannel} onChange={(e) => setEditingSensor((prev) => ({ ...prev, daqChannel: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Manufacturer<input value={editingSensor.manufacturer} onChange={(e) => setEditingSensor((prev) => ({ ...prev, manufacturer: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Model<input value={editingSensor.model} onChange={(e) => setEditingSensor((prev) => ({ ...prev, model: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Serial Number<input value={editingSensor.serialNumber} onChange={(e) => setEditingSensor((prev) => ({ ...prev, serialNumber: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Last Calibration Date<input type="date" value={editingSensor.calibrationDate || ''} onChange={(e) => setEditingSensor((prev) => ({ ...prev, calibrationDate: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Calibration Certificate ID<input value={editingSensor.calibrationCertificateId || ''} onChange={(e) => setEditingSensor((prev) => ({ ...prev, calibrationCertificateId: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Sensitivity<input value={editingSensor.sensitivity} onChange={(e) => setEditingSensor((prev) => ({ ...prev, sensitivity: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Sensitivity Unit<select value={editingSensor.sensitivityUnit} onChange={(e) => setEditingSensor((prev) => ({ ...prev, sensitivityUnit: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{SENSITIVITY_UNIT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select></label>
              <label className="text-xs">Location Label<input value={editingSensor.locationLabel} onChange={(e) => setEditingSensor((prev) => ({ ...prev, locationLabel: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">X<input value={editingSensor.x} onChange={(e) => setEditingSensor((prev) => ({ ...prev, x: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Y<input value={editingSensor.y} onChange={(e) => setEditingSensor((prev) => ({ ...prev, y: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Z<input value={editingSensor.z} onChange={(e) => setEditingSensor((prev) => ({ ...prev, z: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Coordinate Unit<select value={editingSensor.coordinateUnit} onChange={(e) => setEditingSensor((prev) => ({ ...prev, coordinateUnit: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{COORDINATE_UNIT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select></label>
              <label className="text-xs md:col-span-2">Coordinate Origin<input value={editingSensor.coordinateOrigin} onChange={(e) => setEditingSensor((prev) => ({ ...prev, coordinateOrigin: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Mounting Method<select value={editingSensor.mountingMethod} onChange={(e) => setEditingSensor((prev) => ({ ...prev, mountingMethod: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{MOUNTING_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select></label>
              <label className="inline-flex items-center gap-2 text-xs mt-5"><input type="checkbox" checked={!!editingSensor.isActive} onChange={(e) => setEditingSensor((prev) => ({ ...prev, isActive: e.target.checked }))} /> Active Sensor</label>
              <label className="inline-flex items-center gap-2 text-xs mt-5"><input type="checkbox" checked={!!editingSensor.isBlindSensor} onChange={(e) => setEditingSensor((prev) => ({ ...prev, isBlindSensor: e.target.checked }))} /> Blind / Control Sensor</label>
              <label className="inline-flex items-center gap-2 text-xs mt-5"><input type="checkbox" checked={!!editingSensor.isTriggerChannel} onChange={(e) => setEditingSensor((prev) => ({ ...prev, isTriggerChannel: e.target.checked }))} /> Trigger Channel (metadata exception)</label>
              <label className="text-xs md:col-span-2">Trigger Method<select value={editingSensor.triggerMethod || ''} onChange={(e) => setEditingSensor((prev) => ({ ...prev, triggerMethod: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{TRIGGER_METHOD_OPTIONS.map((opt) => <option key={opt || 'blank'} value={opt}>{opt || 'Select trigger method'}</option>)}</select></label>
              <label className="text-xs md:col-span-2">Notes<textarea value={editingSensor.notes} onChange={(e) => setEditingSensor((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5 min-h-20" /></label>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-sidebar-border pt-3 px-1 md:px-2">
              {editorError && <p className="mr-auto self-center text-xs text-destructive">{editorError}</p>}
              <button onClick={() => setEditorOpen(false)} className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-semibold">Cancel</button>
              <button onClick={saveSensor} className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-semibold text-primary">Save Sensor</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SensorsMappingPage;
