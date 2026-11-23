// Sensor mapping validation (EXDA-Check C5). Allowed fields and units follow
// the sensor type: a trigger channel is a voltage with no sensitivity; a
// non-pressure sensor never has a pressure sensitivity unit (pC/bar ...).

export const PRESSURE_SENSITIVITY_UNITS = ['pC/bar', 'pC/kPa', 'mV/bar', 'mV/kPa', 'V/bar', 'V/kPa'];

const normalize = (value) => String(value || '').trim().toLowerCase();
const isNumeric = (value) => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
const isActive = (sensor) => String(sensor?.isActive) === 'true' || sensor?.isActive === true;
const isPressureUnit = (unit) => /\/(bar|kpa|pa|mbar|psi)$/i.test(String(unit || '').trim());

export const validateSensorAgainstList = (sensor, allSensors = [], currentId = null) => {
  const errors = [];
  const warnings = [];
  const isTrigger = sensor.isTriggerChannel === true;
  const quantity = normalize(sensor.measuredQuantity);
  const unit = String(sensor.sensitivityUnit || '').trim();
  const active = isActive(sensor);

  if (!String(sensor.sensorId || '').trim()) errors.push('Sensor ID missing');
  if (active) {
    if (!String(sensor.daqSystem || '').trim()) errors.push('DAQ system missing');
    if (!String(sensor.daqChannel || '').trim()) errors.push('DAQ channel missing');
  }

  if (isTrigger) {
    if (quantity !== 'voltage') errors.push('Trigger channel must have measured quantity "voltage"');
    if (String(sensor.sensitivity ?? '').trim() !== '' || unit) {
      errors.push('Trigger channel has no sensitivity: clear sensitivity and sensitivity unit');
    }
    if (!['', 'n/a'].includes(normalize(sensor.mountingMethod))) {
      warnings.push(`Trigger channel with mounting "${sensor.mountingMethod}" (expected N/A)`);
    }
    if (!String(sensor.triggerMethod || '').trim()) warnings.push('Trigger method missing');
  } else {
    if (/^trig/i.test(String(sensor.sensorId || '').trim())) {
      warnings.push('Sensor ID looks like a trigger channel, but "Trigger Channel" is not ticked');
    }
    if (!String(sensor.serialNumber || '').trim()) errors.push('Serial number missing');
    if (quantity === 'pressure') {
      if (!isNumeric(sensor.sensitivity)) errors.push('Sensitivity missing or not numeric');
      else if (Number(sensor.sensitivity) === 0) errors.push('Sensitivity cannot be zero');
      if (!unit) errors.push('Sensitivity unit missing');
      else if (unit !== 'other' && !isPressureUnit(unit)) errors.push(`Sensitivity unit "${unit}" is not a pressure sensitivity unit`);
    } else if (unit && isPressureUnit(unit)) {
      errors.push(`A ${quantity || 'non-pressure'} sensor cannot have sensitivity unit "${unit}"`);
    }
    if (!isNumeric(sensor.x) || !isNumeric(sensor.y) || !isNumeric(sensor.z)) errors.push('Coordinates x/y/z must be numeric');
    if (!String(sensor.coordinateOrigin || '').trim()) errors.push('Coordinate origin missing');
    if (!String(sensor.mountingMethod || '').trim()) errors.push('Mounting method missing');
    if (!String(sensor.calibrationDate || '').trim()) warnings.push('Calibration date missing');
  }

  if (!isTrigger && active && !String(sensor.locationLabel || '').trim()) {
    errors.push('Location label missing for an active sensor');
  }

  const serial = String(sensor.serialNumber || '').trim();
  if (serial && normalize(sensor.model) === normalize(serial)) {
    warnings.push('Model field holds the serial number');
  }

  const others = (allSensors || []).filter((other) => !(currentId && other.id === currentId) && other !== sensor);
  const duplicateSensorId = others.some(
    (other) => normalize(other.sensorId) === normalize(sensor.sensorId) && normalize(sensor.sensorId) !== ''
  );
  if (duplicateSensorId) errors.push('Duplicate sensor ID');

  if (active && !isTrigger && isNumeric(sensor.x) && isNumeric(sensor.y) && isNumeric(sensor.z)) {
    const sameSpot = others.filter((other) => (
      isActive(other)
      && other.isTriggerChannel !== true
      && isNumeric(other.x) && isNumeric(other.y) && isNumeric(other.z)
      && Number(other.x) === Number(sensor.x)
      && Number(other.y) === Number(sensor.y)
      && Number(other.z) === Number(sensor.z)
      && normalize(other.coordinateUnit) === normalize(sensor.coordinateUnit)
    ));
    if (sameSpot.length) {
      warnings.push(`Same coordinates as ${sameSpot.map((o) => o.sensorId || '?').join(', ')}`);
    }
  }

  if (sensor.isActive && sensor.isBlindSensor) warnings.push('Sensor is active and blind/control');
  return { errors, warnings };
};

// Field changes in the editor that follow the sensor type, so a trigger or a
// concentration sensor never keeps a pressure sensitivity by accident.
export const applySensorTypeRules = (sensor, change) => {
  const next = { ...sensor, ...change };
  if (change.isTriggerChannel === true) {
    next.measuredQuantity = 'voltage';
    next.sensitivity = '';
    next.sensitivityUnit = '';
    next.mountingMethod = 'N/A';
  }
  if (Object.prototype.hasOwnProperty.call(change, 'measuredQuantity')
      && normalize(change.measuredQuantity) !== 'pressure'
      && isPressureUnit(next.sensitivityUnit)) {
    next.sensitivityUnit = '';
  }
  return next;
};
