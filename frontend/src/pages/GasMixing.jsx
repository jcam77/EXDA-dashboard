import React, { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Beaker, Gauge, RefreshCw, Save, Trash2 } from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';
import { EXDA_DISPLAY_TIME_ZONE, formatExdaClock, formatExdaDateTime } from '../utils/timezone';

const RUN_NAME_ORDER_RE = /^(.*)-(\d+)(?:-([Rr])(\d+))?$/;

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
  if (left.runNumber !== right.runNumber) return left.runNumber - right.runNumber;
  if (left.repetitionNumber !== right.repetitionNumber) return left.repetitionNumber - right.repetitionNumber;
  return left.raw.localeCompare(right.raw, undefined, { numeric: true, sensitivity: 'base' });
};

const p0ToPa = (p0Value) => {
  const numeric = Number.parseFloat(String(p0Value ?? '').trim());
  if (!Number.isFinite(numeric) || numeric <= 0) return 101325.0;
  if (numeric < 2000) return numeric * 100000.0; // bar -> Pa
  return numeric; // already Pa
};

const recordKey = (groupName, runName) => `${String(groupName || '').trim()}::${String(runName || '').trim()}`;
const pickMetaValue = (meta, keys = []) => {
  const source = meta && typeof meta === 'object' ? meta : {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
};

const formatResultValue = (value, maxDecimals = 3) => {
  const numeric = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
};

const formatResultFixed = (value, decimals = 2) => {
  const numeric = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const getRecordChamberVolumeL = (item) => {
  const fromLiters = Number.parseFloat(String(item?.vChamberL ?? '').trim());
  if (Number.isFinite(fromLiters)) return fromLiters;
  const fromM3 = Number.parseFloat(String(item?.vChamberCorrectedM3 ?? '').trim());
  if (Number.isFinite(fromM3)) return fromM3 * 1000.0;
  return Number.NaN;
};

const GasMixingPage = ({ projectPath, experiments = [] }) => {
  const apiBaseUrl = getBackendBaseUrl();
  const projectName = String(projectPath || '').split(/[/\\]/).filter(Boolean).pop() || 'No project selected';

  const [records, setRecords] = useState([]);
  const [verificationMeta, setVerificationMeta] = useState({
    isMatlabVerified: false,
    verificationRefFileA: 'scripts/GasMixingVerificationFiles/H2_MFC_Fill_Calculator_v000.m',
    verificationRefFileB: 'scripts/GasMixingVerificationFiles/AuxFcn_H2_MFC_FillCalculator_000.m',
  });
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedRunName, setSelectedRunName] = useState('');
  const [draft, setDraft] = useState({
    targetVol: '',
    pChamberPa: '',
    tChamberK: '293.15',
    mfcFlowSlpm: '',
    lM: '0.9',
    wM: '0.9',
    hM: '0.9',
    volPipesM3: '0',
    hotwireAssemblyM3: '0',
    weldedPartsM3: '0',
    boltsM3: '0',
    tStdK: '298.15',
    pStdPa: '101325',
    ru: '8.314462618',
    mH2: '2.01588e-3',
    notes: '',
  });
  const [results, setResults] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState('');

  const groupedRuns = useMemo(() => {
    const sorted = [...(Array.isArray(experiments) ? experiments : [])].sort((a, b) =>
      compareRunNames(a?.name, b?.name),
    );
    const map = {};
    sorted.forEach((exp) => {
      const runName = String(exp?.name || '').trim();
      if (!runName) return;
      const parsed = parseRunNameOrder(runName);
      const groupName = parsed.group || 'GENERAL';
      if (!map[groupName]) map[groupName] = [];
      map[groupName].push(exp);
    });
    return map;
  }, [experiments]);

  const groupNames = useMemo(
    () => Object.keys(groupedRuns).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
    [groupedRuns],
  );

  const selectedRuns = useMemo(() => groupedRuns[selectedGroup] || [], [groupedRuns, selectedGroup]);
  const selectedExperiment = useMemo(
    () => selectedRuns.find((item) => String(item?.name || '') === String(selectedRunName || '')) || null,
    [selectedRuns, selectedRunName],
  );

  const currentSavedRecord = useMemo(
    () => records.find((item) => recordKey(item?.group, item?.runName) === recordKey(selectedGroup, selectedRunName)) || null,
    [records, selectedGroup, selectedRunName],
  );
  const planTargetVol = useMemo(() => {
    const meta = selectedExperiment?.meta || {};
    return String(pickMetaValue(meta, ['h2', 'H2', 'h2Vol', 'h2_vol', 'h2Percent', 'h2_percent'])).trim();
  }, [selectedExperiment]);
  const planPressurePa = useMemo(() => {
    const meta = selectedExperiment?.meta || {};
    return String(p0ToPa(pickMetaValue(meta, ['p0', 'P0', 'p_0']))).trim();
  }, [selectedExperiment]);

  useEffect(() => {
    if (!groupNames.length) {
      setSelectedGroup('');
      setSelectedRunName('');
      return;
    }
    if (!selectedGroup || !groupNames.includes(selectedGroup)) {
      setSelectedGroup(groupNames[0]);
    }
  }, [groupNames, selectedGroup]);

  useEffect(() => {
    const runs = groupedRuns[selectedGroup] || [];
    if (!runs.length) {
      setSelectedRunName('');
      return;
    }
    const names = runs.map((item) => String(item?.name || '').trim()).filter(Boolean);
    if (!selectedRunName || !names.includes(selectedRunName)) {
      setSelectedRunName(names[0]);
    }
  }, [groupedRuns, selectedGroup, selectedRunName]);

  useEffect(() => {
    let cancelled = false;
    const loadState = async () => {
      if (!projectPath) {
        if (!cancelled) {
          setRecords([]);
          setStatus('');
        }
        return;
      }
      try {
        const response = await fetch(`${apiBaseUrl}/get_gas_mixing?projectPath=${encodeURIComponent(projectPath)}`);
        const payload = await response.json();
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || 'Failed to load gas mixing state');
        }
        if (cancelled) return;
        const loadedRecords = Array.isArray(payload?.records) ? payload.records : [];
        setRecords(loadedRecords);
        const loadedVerification = payload?.verificationMeta && typeof payload.verificationMeta === 'object'
          ? payload.verificationMeta
          : {};
        setVerificationMeta({
          isMatlabVerified: Boolean(loadedVerification?.isMatlabVerified),
          verificationRefFileA: String(loadedVerification?.verificationRefFileA || loadedVerification?.verificationRefFile || 'scripts/GasMixingVerificationFiles/H2_MFC_Fill_Calculator_v000.m'),
          verificationRefFileB: String(loadedVerification?.verificationRefFileB || 'scripts/GasMixingVerificationFiles/AuxFcn_H2_MFC_FillCalculator_000.m'),
        });
        if (payload?.selectedGroup) setSelectedGroup(String(payload.selectedGroup));
        if (payload?.selectedRunName) setSelectedRunName(String(payload.selectedRunName));
      } catch (err) {
        if (!cancelled) setStatus(`Load error: ${err?.message || 'Unknown error'}`);
      }
    };
    loadState();
    return () => { cancelled = true; };
  }, [apiBaseUrl, projectPath]);

  useEffect(() => {
    const meta = selectedExperiment?.meta || {};
    const fallbackTarget = String(pickMetaValue(meta, ['h2', 'H2', 'h2Vol', 'h2_vol', 'h2Percent', 'h2_percent'])).trim();
    const fallbackPressurePa = String(p0ToPa(pickMetaValue(meta, ['p0', 'P0', 'p_0'])));
    const fromRecord = currentSavedRecord || {};

    setDraft({
      targetVol: String(fromRecord?.targetVol ?? fallbackTarget ?? ''),
      pChamberPa: String(fromRecord?.pChamberPa ?? fallbackPressurePa ?? ''),
      tChamberK: String(fromRecord?.tChamberK ?? '293.15'),
      mfcFlowSlpm: String(fromRecord?.mfcFlowSlpm ?? ''),
      lM: String(fromRecord?.lM ?? '0.9'),
      wM: String(fromRecord?.wM ?? '0.9'),
      hM: String(fromRecord?.hM ?? '0.9'),
      volPipesM3: String(fromRecord?.volPipesM3 ?? '0'),
      hotwireAssemblyM3: String(fromRecord?.hotwireAssemblyM3 ?? '0'),
      weldedPartsM3: String(fromRecord?.weldedPartsM3 ?? '0'),
      boltsM3: String(fromRecord?.boltsM3 ?? '0'),
      tStdK: String(fromRecord?.tStdK ?? '298.15'),
      pStdPa: String(fromRecord?.pStdPa ?? '101325'),
      ru: String(fromRecord?.ru ?? '8.314462618'),
      mH2: String(fromRecord?.mH2 ?? '2.01588e-3'),
      notes: String(fromRecord?.notes ?? ''),
    });
    setResults(fromRecord?.results || null);
  }, [selectedExperiment, currentSavedRecord]);

  const calculateInBackend = async () => {
    if (!selectedGroup || !selectedRunName) {
      setStatus('Select a group and run first.');
      return;
    }
    setIsCalculating(true);
    setStatus('');
    try {
      const res = await fetch(`${apiBaseUrl}/calculate_gas_mix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          H2_volPct: draft.targetVol,
          P_chamber_Pa: draft.pChamberPa,
          T_chamber_K: draft.tChamberK,
          MFC_setpoint_SLPM: draft.mfcFlowSlpm,
          L_m: draft.lM,
          W_m: draft.wM,
          H_m: draft.hM,
          Vol_Pipes_m3: draft.volPipesM3,
          HotwireAssembly_m3: draft.hotwireAssemblyM3,
          WeldedParts_m3: draft.weldedPartsM3,
          Bolts_m3: draft.boltsM3,
          T_std_K: draft.tStdK,
          P_std_Pa: draft.pStdPa,
          Ru: draft.ru,
          M_H2: draft.mH2,
          group: selectedGroup,
          runName: selectedRunName,
          projectPath,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Calculation failed (${res.status})`);
      }
      setResults(data.results || null);
      setStatus('Calculation completed.');
    } catch (err) {
      setStatus(`Calculation failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsCalculating(false);
    }
  };

  const saveGasState = async (nextRecords, groupOverride = selectedGroup, runOverride = selectedRunName) => {
    if (!projectPath) {
      setStatus('No project selected.');
      return { success: false };
    }
    setIsSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/save_gas_mixing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          selectedGroup: groupOverride,
          selectedRunName: runOverride,
          records: nextRecords,
          verificationMeta,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Could not save gas mixing state');
      }
      setStatus(`Saved (${formatExdaClock(new Date())} ${EXDA_DISPLAY_TIME_ZONE})`);
      return { success: true, path: payload.path };
    } catch (err) {
      setStatus(`Save failed: ${err?.message || 'Unknown error'}`);
      return { success: false };
    } finally {
      setIsSaving(false);
    }
  };

  const saveVerificationMeta = async () => {
    const result = await saveGasState(records);
    if (result?.success) {
      setStatus(`Verification metadata saved (${formatExdaClock(new Date())} ${EXDA_DISPLAY_TIME_ZONE})`);
    }
  };

  const saveCurrentRecord = async () => {
    if (!selectedGroup || !selectedRunName) {
      setStatus('Select a group and run first.');
      return;
    }
    const nowStamp = new Date().toISOString();
    const nextRecord = {
      group: selectedGroup,
      runName: selectedRunName,
      targetVol: String(draft.targetVol || '').trim(),
      pChamberPa: String(draft.pChamberPa || '').trim(),
      tChamberK: String(draft.tChamberK || '').trim(),
      mfcFlowSlpm: String(draft.mfcFlowSlpm || '').trim(),
      lM: String(draft.lM || '').trim(),
      wM: String(draft.wM || '').trim(),
      hM: String(draft.hM || '').trim(),
      volPipesM3: String(draft.volPipesM3 || '').trim(),
      hotwireAssemblyM3: String(draft.hotwireAssemblyM3 || '').trim(),
      weldedPartsM3: String(draft.weldedPartsM3 || '').trim(),
      boltsM3: String(draft.boltsM3 || '').trim(),
      tStdK: String(draft.tStdK || '').trim(),
      pStdPa: String(draft.pStdPa || '').trim(),
      ru: String(draft.ru || '').trim(),
      mH2: String(draft.mH2 || '').trim(),
      mH2InjectedG: String(results?.m_H2_injected_g ?? ''),
      vH2InjectedL: String(results?.V_H2_injected_L ?? ''),
      vH2StdL: String(results?.V_H2_std_L ?? ''),
      injectionTimeS: String(results?.InjectionTime_s ?? ''),
      injectionTimeMin: String(results?.InjectionTime_min ?? ''),
      vChamberL: String(results?.V_chamber_L ?? ''),
      vChamberCorrectedM3: String(results?.V_chamber_corrected_m3 ?? ''),
      results: results || null,
      notes: String(draft.notes || '').trim(),
      updatedAt: nowStamp,
    };

    const nextRecords = (() => {
      const key = recordKey(selectedGroup, selectedRunName);
      const filtered = records.filter((item) => recordKey(item?.group, item?.runName) !== key);
      return [...filtered, nextRecord];
    })();
    setRecords(nextRecords);
    await saveGasState(nextRecords);
  };

  const deleteSavedRecord = async (groupName, runName) => {
    const label = `${groupName || '-'} / ${runName || '-'}`;
    const shouldDelete = window.confirm(`Delete saved gas mixing record for ${label}?`);
    if (!shouldDelete) return;

    const targetKey = recordKey(groupName, runName);
    const previousRecords = records;
    const nextRecords = previousRecords.filter((item) => recordKey(item?.group, item?.runName) !== targetKey);
    setRecords(nextRecords);
    const saveResult = await saveGasState(nextRecords);
    if (!saveResult?.success) {
      setRecords(previousRecords);
      setStatus('Delete failed. Previous records were restored.');
      return;
    }
    setStatus(`Deleted record (${label}).`);
  };

  const exportGasArtifact = async (format) => {
    if (!projectPath) {
      window.alert('Open a project first. Export files are saved to the project Reports folder.');
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/export_gas_mixing_artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          records,
          verificationMeta,
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

  return (
    <div className="flex flex-col bg-background p-6 animate-in fade-in duration-500 overflow-y-auto custom-scrollbar space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-card/80 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical size={18} className="text-primary" />
          <h2 className="text-lg font-bold text-foreground">Gas Mixing</h2>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            verificationMeta.isMatlabVerified
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          }`}>
            {verificationMeta.isMatlabVerified ? 'MATLAB Verified' : 'MATLAB Not Verified'}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Grouped by campaign group and run/test. Core calculation model can now be expanded per run.
        </p>
        <p className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          Project: <span className="text-foreground">{projectName}</span>
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs">
            <span className="mb-1 block font-semibold text-muted-foreground">Verification Reference File A</span>
            <input
              type="text"
              value={verificationMeta.verificationRefFileA}
              onChange={(e) => setVerificationMeta((prev) => ({ ...prev, verificationRefFileA: e.target.value }))}
              className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-semibold text-muted-foreground">Verification Reference File B</span>
            <input
              type="text"
              value={verificationMeta.verificationRefFileB}
              onChange={(e) => setVerificationMeta((prev) => ({ ...prev, verificationRefFileB: e.target.value }))}
              className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
            />
          </label>
          <div className="flex flex-col justify-end gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={Boolean(verificationMeta.isMatlabVerified)}
                onChange={(e) => setVerificationMeta((prev) => ({ ...prev, isMatlabVerified: e.target.checked }))}
                className="h-4 w-4 rounded border-sidebar-border bg-background text-primary"
              />
              MATLAB Verified
            </label>
            <button
              type="button"
              onClick={saveVerificationMeta}
              className="inline-flex items-center justify-center gap-2 rounded border border-sidebar-border bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/60"
            >
              <Save size={12} />
              Save Verification
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-sidebar-border bg-card/60 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] text-xs">
            <span className="mb-1 block font-semibold text-muted-foreground">Campaign Group</span>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
            >
              {groupNames.length ? (
                groupNames.map((groupName) => (
                  <option key={groupName} value={groupName}>{groupName}</option>
                ))
              ) : (
                <option value="">No groups in plan</option>
              )}
            </select>
          </label>

          <label className="min-w-[260px] text-xs">
            <span className="mb-1 block font-semibold text-muted-foreground">Run / Test</span>
            <select
              value={selectedRunName}
              onChange={(e) => setSelectedRunName(e.target.value)}
              className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
            >
              {(selectedRuns || []).map((item) => {
                const runName = String(item?.name || '');
                return <option key={runName} value={runName}>{runName}</option>;
              })}
            </select>
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-sidebar-border bg-card/60 p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Beaker size={16} className="text-primary" /> Run Inputs
          </h3>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
            <div className="rounded-lg border border-sidebar-border/70 bg-background/30 p-3 xl:col-span-7">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary">Run Conditions</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Target H2 Vol %</span>
                  <input
                    type="number"
                    value={draft.targetVol}
                    onChange={(e) => setDraft((prev) => ({ ...prev, targetVol: e.target.value }))}
                    className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                  />
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">Plan value: {planTargetVol || '-'}</span>
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, targetVol: planTargetVol || '' }))}
                      className="rounded border border-sidebar-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold text-foreground hover:bg-muted/60"
                    >
                      Use Plan
                    </button>
                  </div>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">MFC Setpoint (SLPM)</span>
                  <input
                    type="number"
                    value={draft.mfcFlowSlpm}
                    onChange={(e) => setDraft((prev) => ({ ...prev, mfcFlowSlpm: e.target.value }))}
                    placeholder="e.g. 20"
                    className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Chamber Pressure Pchamber (Pa)</span>
                  <input
                    type="number"
                    value={draft.pChamberPa}
                    onChange={(e) => setDraft((prev) => ({ ...prev, pChamberPa: e.target.value }))}
                    className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                  />
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">Plan value: {planPressurePa || '-'}</span>
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, pChamberPa: planPressurePa || '' }))}
                      className="rounded border border-sidebar-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold text-foreground hover:bg-muted/60"
                    >
                      Use Plan
                    </button>
                  </div>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Chamber Temperature Tchamber (K)</span>
                  <input
                    type="number"
                    value={draft.tChamberK}
                    onChange={(e) => setDraft((prev) => ({ ...prev, tChamberK: e.target.value }))}
                    placeholder="e.g. 293.15"
                    className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-sidebar-border/70 bg-background/30 p-3 xl:col-span-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary">Chamber Geometry</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Length L (m)</span>
                  <input type="number" value={draft.lM} onChange={(e) => setDraft((prev) => ({ ...prev, lM: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Width W (m)</span>
                  <input type="number" value={draft.wM} onChange={(e) => setDraft((prev) => ({ ...prev, wM: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Height H (m)</span>
                  <input type="number" value={draft.hM} onChange={(e) => setDraft((prev) => ({ ...prev, hM: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-sidebar-border/70 bg-background/30 p-3 xl:col-span-5 xl:col-start-8 xl:row-start-2">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary">Volume Corrections</p>

              <div className="rounded border border-sidebar-border/60 bg-background/40 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Added Volumes</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-muted-foreground">Pipes (m³)</span>
                    <input type="number" value={draft.volPipesM3} onChange={(e) => setDraft((prev) => ({ ...prev, volPipesM3: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-muted-foreground">Hotwire Assembly (m³)</span>
                    <input type="number" value={draft.hotwireAssemblyM3} onChange={(e) => setDraft((prev) => ({ ...prev, hotwireAssemblyM3: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                  </label>
                </div>
              </div>

              <div className="mt-3 rounded border border-sidebar-border/60 bg-background/40 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Subtracted Volumes</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-muted-foreground">Welded Parts (m³)</span>
                    <input type="number" value={draft.weldedPartsM3} onChange={(e) => setDraft((prev) => ({ ...prev, weldedPartsM3: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-muted-foreground">Bolts (m³)</span>
                    <input type="number" value={draft.boltsM3} onChange={(e) => setDraft((prev) => ({ ...prev, boltsM3: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-sidebar-border/70 bg-background/30 p-3 xl:col-span-7 xl:col-start-1 xl:row-start-2">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary">Standards & Constants</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Standard Temperature Tstd (K)</span>
                  <input type="number" value={draft.tStdK} onChange={(e) => setDraft((prev) => ({ ...prev, tStdK: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Standard Pressure Pstd (Pa)</span>
                  <input type="number" value={draft.pStdPa} onChange={(e) => setDraft((prev) => ({ ...prev, pStdPa: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Ru (J/mol·K)</span>
                  <input type="number" value={draft.ru} onChange={(e) => setDraft((prev) => ({ ...prev, ru: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">M_H2 (kg/mol)</span>
                  <input type="number" value={draft.mH2} onChange={(e) => setDraft((prev) => ({ ...prev, mH2: e.target.value }))} className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
              </div>
            </div>

            <label className="text-xs xl:col-span-12">
              <span className="mb-1 block font-semibold text-muted-foreground">Notes</span>
              <textarea
                value={draft.notes}
                onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
                className="min-h-[90px] w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                placeholder="Run-specific gas preparation notes..."
              />
            </label>

          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={calculateInBackend}
              disabled={isCalculating || !selectedRunName}
              className="inline-flex items-center gap-2 rounded border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-60"
            >
              {isCalculating ? <RefreshCw size={14} className="animate-spin" /> : <Gauge size={14} />}
              Calculate
            </button>
            <button
              type="button"
              onClick={saveCurrentRecord}
              disabled={isSaving || !selectedRunName}
              className="inline-flex items-center gap-2 rounded border border-sidebar-border bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/60 disabled:opacity-60"
            >
              <Save size={14} />
              Save Run
            </button>
            <span className="text-xs text-muted-foreground">{status || 'Ready'}</span>
          </div>
        </div>

        <div className="rounded-xl border border-sidebar-border bg-card/60 p-5">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Calculation Results</h3>
          {results ? (
            <div className="space-y-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Rounded display for readability
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border border-primary/35 bg-primary/10 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-primary/90">Required H2 Mass (g)</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-foreground">{formatResultValue(results.m_H2_injected_g, 3)}</p>
                </div>
                <div className="rounded-lg border border-primary/35 bg-primary/10 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-primary/90">Estimated Fill Time (s)</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-foreground">{formatResultValue(results.InjectionTime_s, 1)}</p>
                </div>
                <div className="rounded-lg border border-primary/35 bg-primary/10 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-primary/90">Estimated Fill Time (min)</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-foreground">{formatResultValue(results.InjectionTime_min, 1)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border border-sidebar-border bg-background/50 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Corrected Chamber Volume (L)</p>
                  <p className="mt-1 font-mono text-xl text-foreground">{formatResultFixed(results.V_chamber_L, 2)}</p>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-background/50 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Required H2 Injected Volume (L)</p>
                  <p className="mt-1 font-mono text-xl text-foreground">{formatResultValue(results.V_H2_injected_L, 2)}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">Select a run and calculate to see results.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-sidebar-border bg-card/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Saved Gas Mixing Records</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportGasArtifact('csv')}
              className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/60"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => exportGasArtifact('pdf')}
              className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/60"
            >
              Export PDF
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-sidebar-border text-left text-muted-foreground">
                <th className="py-2 pr-3">Group</th>
                <th className="py-2 pr-3">Run/Test</th>
                <th className="py-2 pr-3">H2 (%vol)</th>
                <th className="py-2 pr-3">Pchamber (Pa)</th>
                <th className="py-2 pr-3">Tchamber (K)</th>
                <th className="py-2 pr-3">L (m)</th>
                <th className="py-2 pr-3">W (m)</th>
                <th className="py-2 pr-3">H (m)</th>
                <th className="py-2 pr-3">Pipes + (m³)</th>
                <th className="py-2 pr-3">Hotwire + (m³)</th>
                <th className="py-2 pr-3">Welded - (m³)</th>
                <th className="py-2 pr-3">Bolts - (m³)</th>
                <th className="py-2 pr-3">Vchamber corr. (L)</th>
                <th className="py-2 pr-3">H2 (g)</th>
                <th className="py-2 pr-3">H2 inj. vol (L)</th>
                <th className="py-2 pr-3">MFC (SLPM)</th>
                <th className="py-2 pr-3">Fill time (s)</th>
                <th className="py-2 pr-3">Updated</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!records.length ? (
                <tr>
                  <td colSpan={19} className="py-3 text-center text-muted-foreground">No saved gas mixing records yet.</td>
                </tr>
              ) : (
                [...records]
                  .sort((a, b) => compareRunNames(a?.runName, b?.runName))
                  .map((item) => (
                    <tr key={recordKey(item?.group, item?.runName)} className="border-b border-sidebar-border/40">
                      <td className="py-2 pr-3">{item.group || '-'}</td>
                      <td className="py-2 pr-3 font-semibold">{item.runName || '-'}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.targetVol, 2)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.pChamberPa, 0)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.tChamberK, 2)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.lM, 3)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.wM, 3)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.hM, 3)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.volPipesM3, 4)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.hotwireAssemblyM3, 4)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.weldedPartsM3, 4)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.boltsM3, 4)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(getRecordChamberVolumeL(item), 2)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.mH2InjectedG, 3)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item?.results?.V_H2_injected_L ?? item.vH2InjectedL, 2)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.mfcFlowSlpm, 2)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.injectionTimeS, 1)}</td>
                      <td className="py-2 pr-3">{item.updatedAt ? formatExdaDateTime(item.updatedAt) : '-'}</td>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          onClick={() => deleteSavedRecord(item?.group, item?.runName)}
                          className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
                          title="Delete saved record"
                          aria-label="Delete saved record"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default GasMixingPage;
