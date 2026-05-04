import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPinned, Info, Plus, Pencil, Trash2, Copy, CheckCircle2, AlertTriangle, GripVertical, X } from 'lucide-react';

const QUANTITY_OPTIONS = [
  'pressure',
  'temperature',
  'concentration',
  'acceleration',
  'flame_arrival',
  'photodiode',
  'other',
];
const SENSITIVITY_UNIT_OPTIONS = ['pC/bar', 'pC/kPa', 'mV/bar', 'mV/kPa', 'V/bar', 'V/kPa', 'other'];
const COORDINATE_UNIT_OPTIONS = ['m', 'mm'];
const MOUNTING_OPTIONS = ['flush-mounted', 'recessed', 'tube-mounted', 'surface-mounted', 'other'];

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
  mountingMethod: 'flush-mounted',
  isActive: true,
  isBlindSensor: false,
  notes: '',
  calibrationDate: '',
  calibrationCertificateId: '',
});

const DEFAULT_SENSORS = [
  {
    ...createDefaultSensor('P1'),
    daqChannel: 'CH1',
    serialNumber: 'SN-P1-PLACEHOLDER',
    sensitivity: 10.0,
    locationLabel: 'right wall',
    x: 0.45,
    y: 0.9,
    z: 0.45,
  },
  {
    ...createDefaultSensor('P2'),
    daqChannel: 'CH2',
    serialNumber: 'SN-P2-PLACEHOLDER',
    sensitivity: 10.0,
    locationLabel: 'left wall',
    x: 0.1,
    y: 0.9,
    z: 0.45,
  },
  {
    ...createDefaultSensor('Blind-1'),
    daqChannel: 'CH8',
    serialNumber: 'SN-BLIND-1',
    sensitivity: 10.0,
    locationLabel: 'blind/control channel',
    mountingMethod: 'other',
    isBlindSensor: true,
    notes: 'Used to detect electrical/mechanical contamination and ignition-related EMI.',
  },
];

const normalize = (value) => String(value || '').trim().toLowerCase();
const isNumeric = (value) => value !== '' && Number.isFinite(Number(value));
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const validateSensorAgainstList = (sensor, allSensors, currentId = null) => {
  const errors = [];
  const warnings = [];

  if (!String(sensor.sensorId || '').trim()) errors.push('Sensor ID missing');
  if (String(sensor.isActive) === 'true' || sensor.isActive === true) {
    if (!String(sensor.daqSystem || '').trim()) errors.push('DAQ system missing');
    if (!String(sensor.daqChannel || '').trim()) errors.push('DAQ channel missing');
  }
  if (!String(sensor.serialNumber || '').trim()) errors.push('Serial number missing');
  if (!isNumeric(sensor.sensitivity)) errors.push('Sensitivity missing or not numeric');
  else if (Number(sensor.sensitivity) <= 0) errors.push('Sensitivity must be > 0');
  if (!String(sensor.sensitivityUnit || '').trim()) errors.push('Sensitivity unit missing');
  if (!String(sensor.locationLabel || '').trim()) errors.push('Location label missing');
  if (!isNumeric(sensor.x) || !isNumeric(sensor.y) || !isNumeric(sensor.z)) errors.push('Coordinates x/y/z must be numeric');
  if (!String(sensor.coordinateOrigin || '').trim()) errors.push('Coordinate origin missing');
  if (!String(sensor.mountingMethod || '').trim()) errors.push('Mounting method missing');

  const duplicateSensorId = allSensors.some((other) => {
    if (currentId && other.id === currentId) return false;
    return normalize(other.sensorId) === normalize(sensor.sensorId) && normalize(sensor.sensorId) !== '';
  });
  if (duplicateSensorId) errors.push('Duplicate sensor ID');

  const duplicateActiveChannel = allSensors.some((other) => {
    if (currentId && other.id === currentId) return false;
    if (!sensor.isActive || !other.isActive) return false;
    return normalize(other.daqSystem) === normalize(sensor.daqSystem) && normalize(other.daqChannel) === normalize(sensor.daqChannel) && normalize(sensor.daqChannel) !== '';
  });
  if (duplicateActiveChannel) errors.push('Duplicate active DAQ channel in same DAQ system');

  if (!String(sensor.calibrationDate || '').trim()) warnings.push('Calibration date missing');
  if (!String(sensor.calibrationCertificateId || '').trim()) warnings.push('Calibration certificate ID missing');
  if (sensor.isActive && sensor.isBlindSensor) warnings.push('Sensor is active and blind/control');

  return { errors, warnings };
};

const readSensorsFromStorage = (storageKey) => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_SENSORS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_SENSORS;
  } catch {
    return DEFAULT_SENSORS;
  }
};

const SensorsMappingPage = ({ projectPath = '' }) => {
  const projectName = String(projectPath || '').split(/[/\\]/).filter(Boolean).pop() || 'No project selected';
  const storageKey = `exda:sensors-mapping:${projectPath || 'global'}`;

  const [sensors, setSensors] = useState(() => readSensorsFromStorage(storageKey));
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSensor, setEditingSensor] = useState(createDefaultSensor());
  const [editingExistingId, setEditingExistingId] = useState(null);
  const [editorError, setEditorError] = useState('');
  const [editorOffset, setEditorOffset] = useState({ x: 0, y: 40 });
  const [editorDragging, setEditorDragging] = useState(false);
  const editorDragRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(sensors));
  }, [sensors, storageKey]);

  const validationById = useMemo(() => {
    const map = {};
    sensors.forEach((sensor) => {
      map[sensor.id] = validateSensorAgainstList(sensor, sensors, sensor.id);
    });
    return map;
  }, [sensors]);

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

  const openAdd = () => {
    setEditorError('');
    setEditingExistingId(null);
    setEditingSensor(createDefaultSensor(''));
    setEditorOffset({ x: 0, y: 40 });
    setEditorOpen(true);
  };

  const openEdit = (sensor) => {
    setEditorError('');
    setEditingExistingId(sensor.id);
    setEditingSensor({ ...sensor });
    setEditorOffset({ x: 0, y: 40 });
    setEditorOpen(true);
  };

  const duplicateSensor = (sensor) => {
    const clone = {
      ...sensor,
      id: `sensor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      sensorId: `${sensor.sensorId || 'Sensor'}-Copy`,
      daqChannel: '',
    };
    setSensors((prev) => [...prev, clone]);
  };

  const removeSensor = (sensorId) => {
    setSensors((prev) => prev.filter((sensor) => sensor.id !== sensorId));
  };

  const saveSensor = () => {
    const candidatePool = editingExistingId
      ? sensors.map((sensor) => (sensor.id === editingExistingId ? editingSensor : sensor))
      : [...sensors, editingSensor];
    const validation = validateSensorAgainstList(editingSensor, candidatePool, editingExistingId);
    if (validation.errors.length > 0) {
      setEditorError(validation.errors[0]);
      return;
    }
    if (editingExistingId) {
      setSensors((prev) => prev.map((sensor) => (sensor.id === editingExistingId ? { ...editingSensor } : sensor)));
    } else {
      setSensors((prev) => [...prev, { ...editingSensor }]);
    }
    setEditorError('');
    setEditorOpen(false);
  };

  const exportPdfReport = () => {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
    if (!popup) return;

    const generatedAt = new Date().toLocaleString();
    const statusLabelFor = (sensor) => {
      const result = validationById[sensor.id] || { errors: [], warnings: [] };
      if (result.errors.length > 0) return 'Error';
      if (result.warnings.length > 0) return 'Warning';
      return 'Complete';
    };

    const rowsHtml = sensors.map((sensor) => `
      <tr>
        <td>${escapeHtml(sensor.sensorId || '-')}</td>
        <td>${escapeHtml(sensor.measuredQuantity || '-')}</td>
        <td>${escapeHtml(sensor.daqSystem || '-')}</td>
        <td>${escapeHtml(sensor.daqChannel || '-')}</td>
        <td>${escapeHtml(sensor.serialNumber || '-')}</td>
        <td>${escapeHtml(`${sensor.sensitivity || '-'} ${sensor.sensitivityUnit || ''}`.trim())}</td>
        <td>${escapeHtml(sensor.locationLabel || '-')}</td>
        <td>${escapeHtml(`x=${sensor.x || '-'}, y=${sensor.y || '-'}, z=${sensor.z || '-'} ${sensor.coordinateUnit || ''}`.trim())}</td>
        <td>${escapeHtml(sensor.mountingMethod || '-')}</td>
        <td>${sensor.isActive ? 'Yes' : 'No'}</td>
        <td>${sensor.isBlindSensor ? 'Yes' : 'No'}</td>
        <td>${statusLabelFor(sensor)}</td>
      </tr>
    `).join('');

    popup.document.open();
    popup.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>EXDA Sensors Mapping</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #111; }
    h1 { margin: 0 0 6px 0; font-size: 22px; }
    p { margin: 2px 0; font-size: 12px; color: #333; }
    .summary { margin: 14px 0; display: grid; grid-template-columns: repeat(6, minmax(90px, 1fr)); gap: 8px; }
    .card { border: 1px solid #c8c8c8; border-radius: 8px; padding: 8px; }
    .card .k { font-size: 10px; text-transform: uppercase; color: #666; }
    .card .v { margin-top: 2px; font-weight: bold; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }
    th, td { border: 1px solid #d2d2d2; padding: 6px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    .footnote { margin-top: 14px; font-size: 10px; color: #555; }
  </style>
</head>
<body>
  <h1>Sensors Mapping & Traceability</h1>
  <p><strong>Project:</strong> ${escapeHtml(projectName)}</p>
  <p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
  <div class="summary">
    <div class="card"><div class="k">Total</div><div class="v">${summary.total}</div></div>
    <div class="card"><div class="k">Active</div><div class="v">${summary.active}</div></div>
    <div class="card"><div class="k">Blind/Control</div><div class="v">${summary.blind}</div></div>
    <div class="card"><div class="k">Complete</div><div class="v">${summary.complete}</div></div>
    <div class="card"><div class="k">Warnings</div><div class="v">${summary.warnings}</div></div>
    <div class="card"><div class="k">Errors</div><div class="v">${summary.errors}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Sensor ID</th><th>Quantity</th><th>DAQ System</th><th>DAQ Channel</th><th>Serial Number</th>
        <th>Sensitivity</th><th>Location</th><th>Coordinates</th><th>Mounting</th><th>Active</th><th>Blind</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p class="footnote">Exact coordinates are recommended for traceability and CFD comparison. Blind/control sensors help identify non-physical signal contamination.</p>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`);
    popup.document.close();
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
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          ['Total', summary.total],
          ['Active', summary.active],
          ['Blind/Control', summary.blind],
          ['Complete', summary.complete],
          ['Warnings', summary.warnings],
          ['Errors', summary.errors],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-sidebar-border bg-card/60 p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-sidebar-border bg-card/70 p-4">
          <div className="flex items-center gap-2 text-primary text-sm font-semibold"><Info size={14} /> Mapping Guidance</div>
          <p className="mt-2 text-xs text-muted-foreground">
            Exact sensor coordinates are recommended. Side labels such as left wall or right wall are useful, but not sufficient for traceability or CFD comparison.
          </p>
        </div>
        <div className="rounded-xl border border-sidebar-border bg-card/70 p-4">
          <div className="flex items-center gap-2 text-primary text-sm font-semibold"><Info size={14} /> Blind / Control Sensors</div>
          <p className="mt-2 text-xs text-muted-foreground">
            Blind/control sensors can help detect electrical noise, ignition-related EMI, or mechanical contamination that may not represent physical chamber pressure.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-sidebar-border bg-card/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Sensors Table</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={exportPdfReport}
              className="inline-flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/60"
            >
              Export PDF
            </button>
            <button onClick={openAdd} className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25">
              <Plus size={13} /> Add Sensor
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-sidebar-border">
                <th className="py-2 pr-3">Sensor ID</th>
                <th className="py-2 pr-3">Quantity</th>
                <th className="py-2 pr-3">DAQ</th>
                <th className="py-2 pr-3">Serial</th>
                <th className="py-2 pr-3">Sensitivity</th>
                <th className="py-2 pr-3">Location</th>
                <th className="py-2 pr-3">Coords</th>
                <th className="py-2 pr-3">Mounting</th>
                <th className="py-2 pr-3">Active</th>
                <th className="py-2 pr-3">Blind</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sensors.map((sensor) => {
                const result = validationById[sensor.id] || { errors: [], warnings: [] };
                const status = result.errors.length > 0 ? 'error' : result.warnings.length > 0 ? 'warning' : 'complete';
                return (
                  <tr key={sensor.id} className="border-b border-sidebar-border/50">
                    <td className="py-2 pr-3 font-semibold">{sensor.sensorId || '-'}</td>
                    <td className="py-2 pr-3">{sensor.measuredQuantity}</td>
                    <td className="py-2 pr-3">{sensor.daqSystem} / {sensor.daqChannel || '-'}</td>
                    <td className="py-2 pr-3">{sensor.serialNumber || '-'}</td>
                    <td className="py-2 pr-3">{sensor.sensitivity || '-'} {sensor.sensitivityUnit || ''}</td>
                    <td className="py-2 pr-3">{sensor.locationLabel || '-'}</td>
                    <td className="py-2 pr-3">x={sensor.x || '-'}, y={sensor.y || '-'}, z={sensor.z || '-'} {sensor.coordinateUnit}</td>
                    <td className="py-2 pr-3">{sensor.mountingMethod || '-'}</td>
                    <td className="py-2 pr-3">{sensor.isActive ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-3">{sensor.isBlindSensor ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-3">
                      {status === 'complete' && <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 size={12} /> Complete</span>}
                      {status === 'warning' && <span className="inline-flex items-center gap-1 text-amber-400"><AlertTriangle size={12} /> Warning</span>}
                      {status === 'error' && <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle size={12} /> Error</span>}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(sensor)} className="p-1 rounded hover:bg-muted"><Pencil size={12} /></button>
                        <button onClick={() => duplicateSensor(sensor)} className="p-1 rounded hover:bg-muted"><Copy size={12} /></button>
                        <button onClick={() => removeSensor(sensor.id)} className="p-1 rounded hover:bg-destructive/20 text-destructive"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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

            <div className="mt-4 flex-1 overflow-y-auto pr-1 px-1 md:px-2 grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-xs">Sensor ID<input value={editingSensor.sensorId} onChange={(e) => setEditingSensor((prev) => ({ ...prev, sensorId: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Measured Quantity<select value={editingSensor.measuredQuantity} onChange={(e) => setEditingSensor((prev) => ({ ...prev, measuredQuantity: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5">{QUANTITY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select></label>
              <label className="text-xs">DAQ System<input value={editingSensor.daqSystem} onChange={(e) => setEditingSensor((prev) => ({ ...prev, daqSystem: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">DAQ Channel<input value={editingSensor.daqChannel} onChange={(e) => setEditingSensor((prev) => ({ ...prev, daqChannel: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Manufacturer<input value={editingSensor.manufacturer} onChange={(e) => setEditingSensor((prev) => ({ ...prev, manufacturer: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Model<input value={editingSensor.model} onChange={(e) => setEditingSensor((prev) => ({ ...prev, model: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
              <label className="text-xs">Serial Number<input value={editingSensor.serialNumber} onChange={(e) => setEditingSensor((prev) => ({ ...prev, serialNumber: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" /></label>
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
