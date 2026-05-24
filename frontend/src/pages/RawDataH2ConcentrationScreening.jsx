import React from 'react';
import RawDataScreeningCorePage from './RawDataScreeningCorePage';

/**
 * MVP view for onsite-first raw hydrogen concentration workflow.
 * Reuses the preprocessing engine with a concentration-specific mode.
 */
const RawDataH2ConcentrationScreeningPage = (props) => (
  <RawDataScreeningCorePage {...props} analysisMode="concentration" />
);

export default RawDataH2ConcentrationScreeningPage;
