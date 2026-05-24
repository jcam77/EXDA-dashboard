import React from 'react';
import RawDataScreeningCorePage from './RawDataScreeningCorePage';

/**
 * MVP view for onsite-first raw pressure workflow.
 * Intentionally reuses RawDataScreeningCorePage behavior while exposing
 * a simplified tab name in MVP mode.
 */
const RawDataPressureScreeningPage = (props) => (
  <RawDataScreeningCorePage {...props} />
);

export default RawDataPressureScreeningPage;
