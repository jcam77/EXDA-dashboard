import React, { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Beaker, Gauge, RefreshCw, Save, Trash2 } from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';
import { EXDA_DISPLAY_TIME_ZONE, formatExdaClock, formatExdaDateTime } from '../utils/timezone';
import UnifiedModal from '../components/UnifiedModal';
import ExportFormatButtons from '../components/ExportFormatButtons';
import { useAppDialog } from '../hooks/useAppDialog';

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

const KELVIN_OFFSET = 273.15;
const parseFiniteNumber = (value) => {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};
const celsiusToKelvin = (celsiusValue) => {
  const celsius = parseFiniteNumber(celsiusValue);
  if (celsius === null) return null;
  return celsius + KELVIN_OFFSET;
};
const kelvinToCelsiusString = (kelvinValue, fallback = '') => {
  const kelvin = parseFiniteNumber(kelvinValue);
  if (kelvin === null) return fallback;
  return (kelvin - KELVIN_OFFSET).toFixed(2);
};
const firstNonBlank = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
};
const formatKelvinPreview = (kelvinValue) => {
  if (!Number.isFinite(kelvinValue)) return '-';
  return `${kelvinValue.toFixed(2)} K`;
};

const formatTempCWithK = (celsiusValue, kelvinValue) => {
  const celsius = parseFiniteNumber(celsiusValue);
  const kelvin = parseFiniteNumber(kelvinValue);
  if (celsius !== null && kelvin !== null) {
    return `${celsius.toFixed(2)} (${kelvin.toFixed(2)} K)`;
  }
  if (celsius !== null) {
    return `${celsius.toFixed(2)} (${(celsius + KELVIN_OFFSET).toFixed(2)} K)`;
  }
  if (kelvin !== null) {
    return `${(kelvin - KELVIN_OFFSET).toFixed(2)} (${kelvin.toFixed(2)} K)`;
  }
  return '-';
};

const normalizeDosageModel = (rawModel) => {
  const source = rawModel && typeof rawModel === 'object' ? rawModel : {};
  return {
    enabled: Boolean(source.enabled),
    modelType: 'linear_targetVol_to_mass',
    targetBasis: String(source.targetBasis || 'fraction_0_1'),
    a: String(source.a ?? ''),
    b: String(source.b ?? '0'),
    notes: String(source.notes ?? ''),
  };
};

const applyDosageModel = (baseResults, targetVol, dosageModel) => {
  if (!baseResults || typeof baseResults !== 'object') return baseResults;
  const model = normalizeDosageModel(dosageModel);
  const out = { ...baseResults };
  const rawMass = parseFiniteNumber(baseResults.m_H2_injected_g);
  const rawFillS = parseFiniteNumber(baseResults.InjectionTime_s);
  const target = parseFiniteNumber(targetVol);
  const targetForModel = target === null
    ? null
    : (model.targetBasis === 'fraction_0_1' ? (target / 100.0) : target);
  const a = parseFiniteNumber(model.a);
  const b = parseFiniteNumber(model.b);

  if (!model.enabled || a === null || b === null || targetForModel === null) {
    out.correction = { enabled: Boolean(model.enabled), applied: false, reason: 'disabled_or_incomplete' };
    return out;
  }

  const correctedMass = (a * targetForModel) + b;
  const equation = model.targetBasis === 'fraction_0_1'
    ? 'H2_corrected_g = a * TargetVolFrac + b'
    : 'H2_corrected_g = a * TargetVolPct + b';
  if (!Number.isFinite(correctedMass) || correctedMass <= 0) {
    out.correction = { enabled: true, applied: false, reason: 'non_positive_corrected_mass' };
    return out;
  }

  const correctedFillS = (rawMass && rawMass > 0 && Number.isFinite(rawFillS))
    ? (rawFillS * (correctedMass / rawMass))
    : null;
  const correctedFillMin = Number.isFinite(correctedFillS) ? (correctedFillS / 60.0) : null;

  out.correction = {
    enabled: true,
    applied: true,
    modelType: model.modelType,
    targetBasis: model.targetBasis,
    equation,
    a,
    b,
    targetVolPct: target,
    targetForModel,
    correctedMassG: correctedMass,
    correctedFillTimeS: correctedFillS,
    correctedFillTimeMin: correctedFillMin,
  };
  return out;
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

const isRecordCorrectionApplied = (item) =>
  String(item?.calibrationApplied || '').trim().toLowerCase() === 'yes';

const getRecordEstimatedH2MassG = (item) => {
  const direct = parseFiniteNumber(item?.mH2EstimatedG);
  if (direct !== null) return direct;
  const fromResults = parseFiniteNumber(item?.results?.m_H2_injected_g);
  if (fromResults !== null) return fromResults;
  // Legacy records stored the uncorrected estimate in mH2InjectedG before calibration existed.
  if (!isRecordCorrectionApplied(item)) return parseFiniteNumber(item?.mH2InjectedG);
  return null;
};

const hasNonZeroValue = (value) => {
  const numeric = parseFiniteNumber(value);
  return numeric !== null && Math.abs(numeric) > 1e-12;
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
    relativeHumidityPct: '',
    pChamberPa: '',
    tChamberC: '20.00',
    mfcFlowSlpm: '',
    lM: '0.9',
    wM: '0.9',
    hM: '0.9',
    volPipesM3: '0',
    hotwireAssemblyM3: '0',
    weldedPartsM3: '0',
    boltsM3: '0',
    tStdC: '25.00',
    pStdPa: '101325',
    ru: '8.314462618',
    mH2: '2.01588e-3',
    notes: '',
  });
  const [baseResults, setBaseResults] = useState(null);
  const [dosageModel, setDosageModel] = useState(() => normalizeDosageModel({ enabled: false, modelType: 'linear_targetVol_to_mass', targetBasis: 'fraction_0_1', a: '', b: '0', notes: '' }));
  const [temperatureEdited, setTemperatureEdited] = useState({ tChamber: false, tStd: false });
  const [showAdvancedConstants, setShowAdvancedConstants] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [busyFormat, setBusyFormat] = useState('');
  const [status, setStatus] = useState('');
  const { dialogModal, setDialogModal, showAlert, showConfirm } = useAppDialog();
  const results = useMemo(
    () => applyDosageModel(baseResults, draft.targetVol, dosageModel),
    [baseResults, draft.targetVol, dosageModel],
  );
  const visibleCorrectionColumns = useMemo(() => ({
    hotwire: records.some((item) => hasNonZeroValue(item?.hotwireAssemblyM3)),
    welded: records.some((item) => hasNonZeroValue(item?.weldedPartsM3)),
    bolts: records.some((item) => hasNonZeroValue(item?.boltsM3)),
  }), [records]);
  const savedRecordsColumnCount = 18
    + Number(visibleCorrectionColumns.hotwire)
    + Number(visibleCorrectionColumns.welded)
    + Number(visibleCorrectionColumns.bolts);

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
        const loadedDosageModel = normalizeDosageModel(payload?.dosageModel);
        setVerificationMeta({
          isMatlabVerified: Boolean(loadedVerification?.isMatlabVerified),
          verificationRefFileA: String(loadedVerification?.verificationRefFileA || loadedVerification?.verificationRefFile || 'scripts/GasMixingVerificationFiles/H2_MFC_Fill_Calculator_v000.m'),
          verificationRefFileB: String(loadedVerification?.verificationRefFileB || 'scripts/GasMixingVerificationFiles/AuxFcn_H2_MFC_FillCalculator_000.m'),
        });
        setDosageModel(loadedDosageModel);
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
      relativeHumidityPct: String(fromRecord?.relativeHumidityPct ?? ''),
      pChamberPa: String(fromRecord?.pChamberPa ?? fallbackPressurePa ?? ''),
      tChamberC: String(firstNonBlank(
        fromRecord?.tChamberC,
        kelvinToCelsiusString(fromRecord?.tChamberK, '20.00'),
      )),
      mfcFlowSlpm: String(fromRecord?.mfcFlowSlpm ?? ''),
      lM: String(fromRecord?.lM ?? '0.9'),
      wM: String(fromRecord?.wM ?? '0.9'),
      hM: String(fromRecord?.hM ?? '0.9'),
      volPipesM3: String(fromRecord?.volPipesM3 ?? '0'),
      hotwireAssemblyM3: String(fromRecord?.hotwireAssemblyM3 ?? '0'),
      weldedPartsM3: String(fromRecord?.weldedPartsM3 ?? '0'),
      boltsM3: String(fromRecord?.boltsM3 ?? '0'),
      tStdC: String(firstNonBlank(
        fromRecord?.tStdC,
        kelvinToCelsiusString(fromRecord?.tStdK, '25.00'),
      )),
      pStdPa: String(fromRecord?.pStdPa ?? '101325'),
      ru: String(fromRecord?.ru ?? '8.314462618'),
      mH2: String(fromRecord?.mH2 ?? '2.01588e-3'),
      notes: String(fromRecord?.notes ?? ''),
    });
    setBaseResults(fromRecord?.results || null);
    setTemperatureEdited({ tChamber: false, tStd: false });
  }, [selectedExperiment, currentSavedRecord]);

  const calculateInBackend = async () => {
    if (!selectedGroup || !selectedRunName) {
      setStatus('Select a group and run first.');
      return;
    }
    const requiredInputs = [
      ['Target H2 Vol %', draft.targetVol],
      ['MFC Setpoint (SLPM)', draft.mfcFlowSlpm],
      ['Chamber Pressure Pchamber (Pa)', draft.pChamberPa],
      ['Chamber Temperature Tchamber (°C)', draft.tChamberC],
    ];
    for (const [label, value] of requiredInputs) {
      if (String(value ?? '').trim() === '') {
        setStatus(`Calculation failed: ${label} is required.`);
        return;
      }
      const numeric = parseFiniteNumber(value);
      if (numeric === null) {
        setStatus(`Calculation failed: ${label} must be numeric.`);
        return;
      }
    }
    if ((parseFiniteNumber(draft.mfcFlowSlpm) ?? 0) <= 0) {
      setStatus('Calculation failed: MFC Setpoint (SLPM) must be greater than zero.');
      return;
    }
    setIsCalculating(true);
    setStatus('');
    try {
      const tChamberKValue = celsiusToKelvin(draft.tChamberC);
      const tStdKValue = celsiusToKelvin(draft.tStdC);
      const res = await fetch(`${apiBaseUrl}/calculate_gas_mix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          H2_volPct: draft.targetVol,
          P_chamber_Pa: draft.pChamberPa,
          T_chamber_K: tChamberKValue === null ? '' : String(tChamberKValue),
          MFC_setpoint_SLPM: draft.mfcFlowSlpm,
          L_m: draft.lM,
          W_m: draft.wM,
          H_m: draft.hM,
          Vol_Pipes_m3: draft.volPipesM3,
          HotwireAssembly_m3: draft.hotwireAssemblyM3,
          WeldedParts_m3: draft.weldedPartsM3,
          Bolts_m3: draft.boltsM3,
          T_std_K: tStdKValue === null ? '' : String(tStdKValue),
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
      setBaseResults(data.results || null);
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
          dosageModel,
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
    const tChamberKValue = celsiusToKelvin(draft.tChamberC);
    const tStdKValue = celsiusToKelvin(draft.tStdC);
    const keepExistingTChamberK = !temperatureEdited.tChamber && String(currentSavedRecord?.tChamberK || '').trim() !== '';
    const keepExistingTStdK = !temperatureEdited.tStd && String(currentSavedRecord?.tStdK || '').trim() !== '';
    const estimatedH2MassG = results?.m_H2_injected_g ?? getRecordEstimatedH2MassG(currentSavedRecord);
    const nextRecord = {
      group: selectedGroup,
      runName: selectedRunName,
      targetVol: String(draft.targetVol || '').trim(),
      relativeHumidityPct: String(draft.relativeHumidityPct || '').trim(),
      pChamberPa: String(draft.pChamberPa || '').trim(),
      tChamberC: String(draft.tChamberC || '').trim(),
      tChamberK: keepExistingTChamberK
        ? String(currentSavedRecord?.tChamberK || '').trim()
        : (tChamberKValue === null ? '' : String(tChamberKValue)),
      mfcFlowSlpm: String(draft.mfcFlowSlpm || '').trim(),
      lM: String(draft.lM || '').trim(),
      wM: String(draft.wM || '').trim(),
      hM: String(draft.hM || '').trim(),
      volPipesM3: String(draft.volPipesM3 || '').trim(),
      hotwireAssemblyM3: String(draft.hotwireAssemblyM3 || '').trim(),
      weldedPartsM3: String(draft.weldedPartsM3 || '').trim(),
      boltsM3: String(draft.boltsM3 || '').trim(),
      tStdC: String(draft.tStdC || '').trim(),
      tStdK: keepExistingTStdK
        ? String(currentSavedRecord?.tStdK || '').trim()
        : (tStdKValue === null ? '' : String(tStdKValue)),
      pStdPa: String(draft.pStdPa || '').trim(),
      ru: String(draft.ru || '').trim(),
      mH2: String(draft.mH2 || '').trim(),
      mH2EstimatedG: String(estimatedH2MassG ?? ''),
      mH2CorrectedG: String(results?.correction?.applied ? results?.correction?.correctedMassG : (results?.m_H2_injected_g ?? '')),
      mH2InjectedG: String(results?.correction?.applied ? results?.correction?.correctedMassG : results?.m_H2_injected_g ?? ''),
      vH2InjectedL: String(results?.V_H2_injected_L ?? ''),
      vH2StdL: String(results?.V_H2_std_L ?? ''),
      injectionTimeS: String(results?.correction?.applied ? (results?.correction?.correctedFillTimeS ?? results?.InjectionTime_s) : results?.InjectionTime_s ?? ''),
      injectionTimeMin: String(results?.correction?.applied ? (results?.correction?.correctedFillTimeMin ?? results?.InjectionTime_min) : results?.InjectionTime_min ?? ''),
      vChamberL: String(results?.V_chamber_L ?? ''),
      vChamberCorrectedM3: String(results?.V_chamber_corrected_m3 ?? ''),
      results: baseResults || null,
      calibrationModelType: String(dosageModel.modelType || 'linear_targetVol_to_mass'),
      calibrationTargetBasis: String(dosageModel.targetBasis || 'fraction_0_1'),
      calibrationEnabled: dosageModel.enabled ? 'Yes' : 'No',
      calibrationApplied: results?.correction?.applied ? 'Yes' : 'No',
      calibrationA: String(dosageModel.a || '').trim(),
      calibrationB: String(dosageModel.b || '').trim(),
      calibrationNotes: String(dosageModel.notes || '').trim(),
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
    const shouldDelete = await showConfirm({
      title: 'Delete Saved Record?',
      content: `Delete saved gas mixing record for ${label}?`,
      type: 'error',
      confirmLabel: 'Delete',
      confirmVariant: 'destructive',
    });
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
      await showAlert({
        title: 'Project Required',
        content: 'Open a project first. Export files are saved to the project Reports folder.',
        type: 'error',
      });
      return;
    }
    try {
      setBusyFormat(format);
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
                  <span className="mb-1 block font-semibold text-muted-foreground">Relative Humidity RH (%)</span>
                  <input
                    type="number"
                    value={draft.relativeHumidityPct}
                    onChange={(e) => setDraft((prev) => ({ ...prev, relativeHumidityPct: e.target.value }))}
                    placeholder="e.g. 45"
                    className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                  />
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
                  <span className="mb-1 block font-semibold text-muted-foreground">Chamber Temperature Tchamber (°C)</span>
                  <input
                    type="number"
                    value={draft.tChamberC}
                    onChange={(e) => {
                      setTemperatureEdited((prev) => ({ ...prev, tChamber: true }));
                      setDraft((prev) => ({ ...prev, tChamberC: e.target.value }));
                    }}
                    placeholder="e.g. 20"
                    className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Used in calculation: {formatKelvinPreview(celsiusToKelvin(draft.tChamberC))}
                  </span>
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
              <div className="mb-4 rounded border border-primary/30 bg-primary/5 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Dosage Calibration Model</p>
                <p className="mt-1 text-xs text-muted-foreground">Use your final equation only (no regression fitting in app).</p>
                <label className="mt-2 inline-flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(dosageModel.enabled)}
                    onChange={(e) => setDosageModel((prev) => ({ ...prev, enabled: e.target.checked }))}
                    className="h-4 w-4 rounded border-sidebar-border bg-background text-primary"
                  />
                  Enable correction model
                </label>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-muted-foreground">Model Type</span>
                    <input
                      value="Linear: H2_corrected_g = a * target + b"
                      readOnly
                      className="w-full rounded border border-sidebar-border bg-zinc-950 px-2 py-2 text-sm text-zinc-300"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-muted-foreground">Target Basis</span>
                    <select
                      value={dosageModel.targetBasis}
                      onChange={(e) => setDosageModel((prev) => ({ ...prev, targetBasis: e.target.value }))}
                      className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                    >
                      <option value="fraction_0_1">Fraction (0-1 scale)</option>
                      <option value="percent">Percent (0-100 scale)</option>
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-muted-foreground">Coefficient a</span>
                    <input
                      type="number"
                      value={dosageModel.a}
                      onChange={(e) => setDosageModel((prev) => ({ ...prev, a: e.target.value }))}
                      placeholder="e.g. 0.65"
                      className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-muted-foreground">Coefficient b</span>
                    <input
                      type="number"
                      value={dosageModel.b}
                      onChange={(e) => setDosageModel((prev) => ({ ...prev, b: e.target.value }))}
                      placeholder="e.g. 0.10"
                      className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                    />
                  </label>
                </div>
                <p className="mt-2 rounded border border-sidebar-border/60 bg-background/50 px-2 py-1.5 font-mono text-[11px] text-zinc-300">
                  Equation: H2_corrected_g = a * target + b
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Model target value used: {results?.correction?.targetForModel ?? '-'} ({dosageModel.targetBasis === 'fraction_0_1' ? 'fraction basis' : 'percent basis'})
                </p>
                <label className="mt-2 block text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground">Model Notes</span>
                  <input
                    type="text"
                    value={dosageModel.notes}
                    onChange={(e) => setDosageModel((prev) => ({ ...prev, notes: e.target.value }))}
                    className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                    placeholder="Source/version of external calibration equation"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Standards & Constants (Advanced)</p>
                <button
                  type="button"
                  onClick={() => setShowAdvancedConstants((prev) => !prev)}
                  className="rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted/60"
                >
                  {showAdvancedConstants ? 'Hide' : 'Show'}
                </button>
              </div>

              {!showAdvancedConstants && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Hidden to reduce noise. Defaults are used unless you open this section.
                </p>
              )}

              {showAdvancedConstants && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-muted-foreground">Standard Temperature Tstd (°C)</span>
                    <input
                      type="number"
                      value={draft.tStdC}
                      onChange={(e) => {
                        setTemperatureEdited((prev) => ({ ...prev, tStd: true }));
                        setDraft((prev) => ({ ...prev, tStdC: e.target.value }));
                      }}
                      className="w-full rounded border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground"
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Used in calculation: {formatKelvinPreview(celsiusToKelvin(draft.tStdC))}
                    </span>
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
              )}
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
                <div className={`rounded-lg p-3 ${results?.correction?.applied ? 'border-2 border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(52,211,153,0.25)]' : 'border border-primary/35 bg-primary/10'}`}>
                  <p className="text-[11px] uppercase tracking-wider text-primary/90">
                    {results?.correction?.applied ? 'Required H2 Mass (g) - Corrected (MFC Input)' : 'Required H2 Mass (g)'}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-foreground">
                    {formatResultValue(results?.correction?.applied ? results?.correction?.correctedMassG : results?.m_H2_injected_g, 3)}
                  </p>
                  {results?.correction?.applied && (
                    <p className="mt-1 text-[11px] font-semibold text-emerald-300">Use this corrected mass as the MFC dosage input.</p>
                  )}
                </div>
                <div className="rounded-lg border border-primary/35 bg-primary/10 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-primary/90">
                    {results?.correction?.applied ? 'Estimated Fill Time (s) - Corrected' : 'Estimated Fill Time (s)'}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-foreground">
                    {formatResultValue(results?.correction?.applied ? results?.correction?.correctedFillTimeS : results?.InjectionTime_s, 1)}
                  </p>
                </div>
                <div className="rounded-lg border border-primary/35 bg-primary/10 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-primary/90">
                    {results?.correction?.applied ? 'Estimated Fill Time (min) - Corrected' : 'Estimated Fill Time (min)'}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-foreground">
                    {formatResultValue(results?.correction?.applied ? results?.correction?.correctedFillTimeMin : results?.InjectionTime_min, 1)}
                  </p>
                </div>
              </div>

              {results?.correction && (
                <div className="rounded border border-sidebar-border bg-background/50 px-3 py-2 text-xs text-zinc-300">
                  {results.correction.applied
                    ? `Calibration applied (${results.correction.modelType}): ${results.correction.equation}`
                    : `Calibration not applied: ${results.correction.reason || 'n/a'}`}
                </div>
              )}

              {results?.correction?.applied && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-lg border border-sidebar-border bg-background/50 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Before Correction: H2 Mass (g)</p>
                    <p className="mt-1 font-mono text-xl text-foreground">{formatResultValue(results?.m_H2_injected_g, 3)}</p>
                  </div>
                  <div className="rounded-lg border border-sidebar-border bg-background/50 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Before Correction: Fill Time (s)</p>
                    <p className="mt-1 font-mono text-xl text-foreground">{formatResultValue(results?.InjectionTime_s, 1)}</p>
                  </div>
                  <div className="rounded-lg border border-sidebar-border bg-background/50 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Before Correction: Fill Time (min)</p>
                    <p className="mt-1 font-mono text-xl text-foreground">{formatResultValue(results?.InjectionTime_min, 1)}</p>
                  </div>
                </div>
              )}

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
          <ExportFormatButtons
            onExportCsv={() => exportGasArtifact('csv')}
            onExportPdf={() => exportGasArtifact('pdf')}
            busyFormat={busyFormat}
            size="sm"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-sidebar-border text-left text-muted-foreground">
                <th className="py-2 pr-3">Group</th>
                <th className="py-2 pr-3">Run/Test</th>
                <th className="py-2 pr-3">H2 (%vol)</th>
                <th className="py-2 pr-3">RH (%)</th>
                <th className="py-2 pr-3">Pchamber (Pa)</th>
                <th className="py-2 pr-3">Tchamber (°C [K])</th>
                <th className="py-2 pr-3">L (m)</th>
                <th className="py-2 pr-3">W (m)</th>
                <th className="py-2 pr-3">H (m)</th>
                <th className="py-2 pr-3">Pipes + (m³)</th>
                {visibleCorrectionColumns.hotwire && <th className="py-2 pr-3">Hotwire + (m³)</th>}
                {visibleCorrectionColumns.welded && <th className="py-2 pr-3">Welded - (m³)</th>}
                {visibleCorrectionColumns.bolts && <th className="py-2 pr-3">Bolts - (m³)</th>}
                <th className="py-2 pr-3">Vchamber corr. (L)</th>
                <th className="py-2 pr-3">H2 est. (g)</th>
                <th className="py-2 pr-3">H2 corr. (g)</th>
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
                  <td colSpan={savedRecordsColumnCount} className="py-3 text-center text-muted-foreground">No saved gas mixing records yet.</td>
                </tr>
              ) : (
                [...records]
                  .sort((a, b) => compareRunNames(a?.runName, b?.runName))
                  .map((item) => (
                    <tr key={recordKey(item?.group, item?.runName)} className="border-b border-sidebar-border/40">
                      {(() => {
                        const correctionApplied = isRecordCorrectionApplied(item);
                        return (
                          <>
                      <td className="py-2 pr-3">{item.group || '-'}</td>
                      <td className="py-2 pr-3 font-semibold">{item.runName || '-'}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.targetVol, 2)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.relativeHumidityPct, 1)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.pChamberPa, 0)}</td>
                      <td className="py-2 pr-3">{formatTempCWithK(item.tChamberC, item.tChamberK)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.lM, 3)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.wM, 3)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.hM, 3)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(item.volPipesM3, 4)}</td>
                      {visibleCorrectionColumns.hotwire && <td className="py-2 pr-3">{formatResultFixed(item.hotwireAssemblyM3, 4)}</td>}
                      {visibleCorrectionColumns.welded && <td className="py-2 pr-3">{formatResultFixed(item.weldedPartsM3, 4)}</td>}
                      {visibleCorrectionColumns.bolts && <td className="py-2 pr-3">{formatResultFixed(item.boltsM3, 4)}</td>}
                      <td className="py-2 pr-3">{formatResultFixed(getRecordChamberVolumeL(item), 2)}</td>
                      <td className="py-2 pr-3">{formatResultFixed(getRecordEstimatedH2MassG(item), 3)}</td>
                      <td className="py-2 pr-3">
                        {correctionApplied
                          ? formatResultFixed(item.mH2CorrectedG ?? item.mH2InjectedG, 3)
                          : <span className="text-muted-foreground">Not corrected by model</span>}
                      </td>
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
                          </>
                        );
                      })()}
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <UnifiedModal modal={dialogModal} setModal={setDialogModal} />
    </div>
  );
};

export default GasMixingPage;
