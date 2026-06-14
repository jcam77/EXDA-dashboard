import React, { useEffect, useMemo, useState } from 'react';
import { HardDrive, Plus, Pencil, Trash2, Save, X } from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';
import { EXDA_DISPLAY_TIME_ZONE, formatExdaClock } from '../utils/timezone';
import UnifiedModal from '../components/UnifiedModal';
import ExportFormatButtons from '../components/ExportFormatButtons';
import IsoDateInput from '../components/IsoDateInput';
import { useAppDialog } from '../hooks/useAppDialog';

const createDefaultDaq = () => ({
  id: `daq-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  name: '',
  measuredQuantity: 'pressure',
  vendor: '',
  model: '',
  serialNumber: '',
  samplingRateHz: '',
  channelCount: '',
  owner: '',
  lastCalibrationDate: '',
  calibrationCertificateId: '',
  notes: '',
  isActive: true,
});

const normalize = (value) => String(value || '').trim().toLowerCase();

const DaqSystemsPage = ({ projectPath = '' }) => {
  const apiBaseUrl = getBackendBaseUrl();
  const baseUrl = import.meta.env.BASE_URL || '/';
  const daqReferenceDocs = [
    {
      title: 'LU-DBI Measurement Chain',
      fileName: 'LU-DBI_MeasurementChain_v001.pdf',
      url: `${baseUrl}LU-DBI_MeasurementChain_v001.pdf`,
    },
    {
      title: 'Mixture Sampling Sub-System',
      fileName: 'MixtureSampling_Sub-System_000.pdf',
      url: `${baseUrl}MixtureSampling_Sub-System_000.pdf`,
    },
  ];
  const projectName = String(projectPath || '').split(/[/\\]/).filter(Boolean).pop() || 'No project selected';
  const [daqSystems, setDaqSystems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyFormat, setBusyFormat] = useState('');
  const [saveInfo, setSaveInfo] = useState('');
  const [error, setError] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(createDefaultDaq());
  const [openPreviews, setOpenPreviews] = useState({});
  const { dialogModal, setDialogModal, showAlert } = useAppDialog();

  const validation = useMemo(() => {
    const messages = [];
    if (!String(draft.name || '').trim()) messages.push('DAQ system name is required.');
    if (!String(draft.measuredQuantity || '').trim()) messages.push('Measured quantity is required.');
    const duplicateName = daqSystems.some((item) => item.id !== editingId && normalize(item.name) === normalize(draft.name) && normalize(draft.name) !== '');
    if (duplicateName) messages.push('DAQ system name must be unique.');
    if (String(draft.samplingRateHz || '').trim() && !Number.isFinite(Number(draft.samplingRateHz))) {
      messages.push('Sampling rate must be numeric.');
    }
    if (String(draft.channelCount || '').trim() && !Number.isFinite(Number(draft.channelCount))) {
      messages.push('Channel count must be numeric.');
    }
    return messages;
  }, [daqSystems, draft, editingId]);

  const loadDaqSystems = async () => {
    if (!projectPath) {
      setDaqSystems([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/get_daq_systems?projectPath=${encodeURIComponent(projectPath)}`);
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      const normalized = (Array.isArray(data.daqSystems) ? data.daqSystems : []).map((item) => ({
        ...item,
        owner: String(item?.owner || item?.location || '').trim(),
        lastCalibrationDate: String(item?.lastCalibrationDate || '').trim(),
        calibrationCertificateId: String(item?.calibrationCertificateId || '').trim(),
      }));
      setDaqSystems(normalized);
    } catch (loadError) {
      setError(loadError?.message || 'Failed to load DAQ systems.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDaqSystems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  const persistDaqSystems = async (nextSystems, successMessage = 'DAQ systems saved.') => {
    if (!projectPath) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/save_daq_systems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, daqSystems: nextSystems }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      setSaveInfo(`${successMessage} (${formatExdaClock(new Date())} ${EXDA_DISPLAY_TIME_ZONE})`);
    } catch (saveError) {
      setError(saveError?.message || 'Failed to save DAQ systems.');
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setDraft(createDefaultDaq());
    setEditorOpen(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setDraft({ ...item });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
    setDraft(createDefaultDaq());
  };

  const saveDraft = async () => {
    if (validation.length > 0) return;
    const normalizedDraft = {
      ...draft,
      name: String(draft.name || '').trim(),
      measuredQuantity: String(draft.measuredQuantity || '').trim(),
      vendor: String(draft.vendor || '').trim(),
      model: String(draft.model || '').trim(),
      serialNumber: String(draft.serialNumber || '').trim(),
      samplingRateHz: String(draft.samplingRateHz || '').trim(),
      channelCount: String(draft.channelCount || '').trim(),
      owner: String(draft.owner || '').trim(),
      lastCalibrationDate: String(draft.lastCalibrationDate || '').trim(),
      calibrationCertificateId: String(draft.calibrationCertificateId || '').trim(),
      notes: String(draft.notes || '').trim(),
      isActive: !!draft.isActive,
    };
    const next = editingId
      ? daqSystems.map((item) => (item.id === editingId ? normalizedDraft : item))
      : [...daqSystems, normalizedDraft];
    setDaqSystems(next);
    await persistDaqSystems(next, editingId ? 'DAQ system updated.' : 'DAQ system added.');
    closeEditor();
  };

  const removeDaqSystem = async (id) => {
    const next = daqSystems.filter((item) => item.id !== id);
    setDaqSystems(next);
    await persistDaqSystems(next, 'DAQ system removed.');
  };

  const exportDaqArtifact = async (format) => {
    if (!projectPath) {
      await showAlert({
        title: 'Project Required',
        content: 'Open a project first. Export files are saved to the project Reports folder.',
        type: 'error',
      });
      return;
    }
    try {
      setBusyFormat(format);
      const response = await fetch(`${apiBaseUrl}/export_daq_artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          daqSystems,
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
    } catch (exportError) {
      await showAlert({
        title: `${format.toUpperCase()} Export Failed`,
        content: exportError?.message || 'Unknown error',
        type: 'error',
      });
    } finally {
      setBusyFormat('');
    }
  };

  const activeCount = daqSystems.filter((item) => item.isActive).length;

  return (
    <div className="w-full space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-card/80 p-5">
        <div className="flex items-center gap-2">
          <HardDrive size={18} className="text-primary" />
          <h2 className="text-lg font-bold text-foreground">DAQ Systems</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Define and manage DAQ hardware used in this project. Sensors Mapping can then reference these systems.
        </p>
        <p className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          Project: <span className="text-foreground">{projectName}</span>
        </p>
      </div>

      <div className="w-full rounded-xl border border-sidebar-border bg-card/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">DAQ Reference Documents</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {daqReferenceDocs.map((doc) => (
            <div
              key={doc.fileName}
              className="rounded-lg border border-sidebar-border bg-background/40 p-3"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">{doc.title}</p>
                  <p className="text-[11px] text-muted-foreground">{doc.fileName}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenPreviews((prev) => ({ ...prev, [doc.fileName]: !prev[doc.fileName] }))
                    }
                    className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
                  >
                    {openPreviews[doc.fileName] ? 'Hide Preview' : 'Preview'}
                  </button>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
                  >
                    Open PDF
                  </a>
                  <a
                    href={doc.url}
                    download
                    className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
                  >
                    Download
                  </a>
                </div>
              </div>
              {openPreviews[doc.fileName] && (
                <div className="overflow-hidden rounded border border-sidebar-border bg-background">
                  <iframe
                    title={`${doc.title} preview`}
                    src={doc.url}
                    className="h-[240px] w-full"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-sidebar-border bg-card/60 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total DAQ Systems</p>
          <p className="mt-1 text-lg font-bold text-foreground">{daqSystems.length}</p>
        </div>
        <div className="rounded-lg border border-sidebar-border bg-card/60 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Active Systems</p>
          <p className="mt-1 text-lg font-bold text-foreground">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-sidebar-border bg-card/60 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{saving ? 'Saving…' : (saveInfo || 'Ready')}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-sidebar-border bg-card/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Systems List</h3>
          <div className="flex items-center gap-2">
            <ExportFormatButtons
              onExportCsv={() => exportDaqArtifact('csv')}
              onExportPdf={() => exportDaqArtifact('pdf')}
              busyFormat={busyFormat}
              size="sm"
            />
            <button
              onClick={() => persistDaqSystems(daqSystems, 'DAQ systems saved.')}
              className="inline-flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/60"
            >
              <Save size={13} /> Save
            </button>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25"
            >
              <Plus size={13} /> Add DAQ
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-sidebar-border text-left text-muted-foreground">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Measured Quantity</th>
                <th className="py-2 pr-3">Vendor</th>
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 pr-3">Serial</th>
                <th className="py-2 pr-3">Sampling Rate (Hz)</th>
                <th className="py-2 pr-3">Channels</th>
                <th className="py-2 pr-3">Owner</th>
                <th className="py-2 pr-3">Last Calibration</th>
                <th className="py-2 pr-3">Cal. Cert ID</th>
                <th className="py-2 pr-3">Active</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-3 text-center text-muted-foreground">Loading…</td>
                </tr>
              ) : daqSystems.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-3 text-center text-muted-foreground">No DAQ systems yet. Add your first one.</td>
                </tr>
              ) : (
                daqSystems.map((item) => (
                  <tr key={item.id} className="border-b border-sidebar-border/50">
                    <td className="py-2 pr-3 font-semibold">{item.name || '-'}</td>
                    <td className="py-2 pr-3">{item.measuredQuantity || '-'}</td>
                    <td className="py-2 pr-3">{item.vendor || '-'}</td>
                    <td className="py-2 pr-3">{item.model || '-'}</td>
                    <td className="py-2 pr-3">{item.serialNumber || '-'}</td>
                    <td className="py-2 pr-3">{item.samplingRateHz || '-'}</td>
                    <td className="py-2 pr-3">{item.channelCount || '-'}</td>
                    <td className="py-2 pr-3">{item.owner || '-'}</td>
                    <td className="py-2 pr-3">{item.lastCalibrationDate || '-'}</td>
                    <td className="py-2 pr-3">{item.calibrationCertificateId || '-'}</td>
                    <td className="py-2 pr-3">{item.isActive ? 'Yes' : 'No'}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(item)} className="p-1 rounded hover:bg-muted"><Pencil size={12} /></button>
                        <button onClick={() => removeDaqSystem(item.id)} className="p-1 rounded hover:bg-destructive/20 text-destructive"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-[70] bg-background/80 flex items-center justify-center px-4 py-4 backdrop-blur-md">
          <div className="w-full max-w-2xl rounded-2xl border border-primary/30 bg-zinc-950 p-5 md:p-6 shadow-2xl ring-1 ring-white/5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{editingId ? 'Edit DAQ System' : 'Add DAQ System'}</h3>
              <button
                onClick={closeEditor}
                className="text-zinc-500 hover:text-white bg-zinc-900 p-2 rounded-full transition-all hover:scale-110"
                title="Close"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-xs md:col-span-2">DAQ System Name *
                <input value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" />
              </label>
              <label className="text-xs">Measured Quantity *
                <select
                  value={draft.measuredQuantity}
                  onChange={(e) => setDraft((prev) => ({ ...prev, measuredQuantity: e.target.value }))}
                  className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5"
                >
                  <option value="pressure">pressure</option>
                  <option value="concentration">concentration</option>
                  <option value="temperature">temperature</option>
                  <option value="acceleration">acceleration</option>
                  <option value="flame_arrival">flame_arrival</option>
                  <option value="photodiode">photodiode</option>
                  <option value="pressure, concentration">pressure, concentration</option>
                  <option value="other">other</option>
                </select>
              </label>
              <label className="text-xs">Vendor
                <input value={draft.vendor} onChange={(e) => setDraft((prev) => ({ ...prev, vendor: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" />
              </label>
              <label className="text-xs">Model
                <input value={draft.model} onChange={(e) => setDraft((prev) => ({ ...prev, model: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" />
              </label>
              <label className="text-xs">Serial Number
                <input value={draft.serialNumber} onChange={(e) => setDraft((prev) => ({ ...prev, serialNumber: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" />
              </label>
              <label className="text-xs">Sampling Rate (Hz)
                <input value={draft.samplingRateHz} onChange={(e) => setDraft((prev) => ({ ...prev, samplingRateHz: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" />
              </label>
              <label className="text-xs">Channel Count
                <input value={draft.channelCount} onChange={(e) => setDraft((prev) => ({ ...prev, channelCount: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" />
              </label>
              <label className="text-xs">Owner
                <input value={draft.owner} onChange={(e) => setDraft((prev) => ({ ...prev, owner: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" placeholder="e.g. Institute, University, Partner" />
              </label>
              <label className="text-xs">Last Calibration Date
                <IsoDateInput value={draft.lastCalibrationDate} onValueChange={(next) => setDraft((prev) => ({ ...prev, lastCalibrationDate: next }))} placeholder="YYYY-MM-DD" className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5 pr-9" />
              </label>
              <label className="text-xs">Calibration Certificate ID
                <input value={draft.calibrationCertificateId || ''} onChange={(e) => setDraft((prev) => ({ ...prev, calibrationCertificateId: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5" placeholder="e.g. CAL-2026-014" />
              </label>
              <label className="text-xs md:col-span-2">Notes
                <textarea value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 w-full rounded border border-sidebar-border bg-background px-2 py-1.5 min-h-20" />
              </label>
              <label className="inline-flex items-center gap-2 text-xs">
                <input type="checkbox" checked={!!draft.isActive} onChange={(e) => setDraft((prev) => ({ ...prev, isActive: e.target.checked }))} />
                Active System
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-sidebar-border pt-3">
              {validation.length > 0 && <p className="mr-auto self-center text-xs text-destructive">{validation[0]}</p>}
              <button onClick={closeEditor} className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-semibold">Cancel</button>
              <button onClick={saveDraft} className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-semibold text-primary">Save DAQ</button>
            </div>
          </div>
        </div>
      )}
      <UnifiedModal modal={dialogModal} setModal={setDialogModal} />
    </div>
  );
};

export default DaqSystemsPage;
