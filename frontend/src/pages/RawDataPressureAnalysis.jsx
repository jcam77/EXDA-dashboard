import React from 'react';
import DataPreprocessingPage from './DataPreprocessingPage';

/**
 * MVP view for onsite-first raw pressure workflow.
 * Intentionally reuses DataPreprocessingPage behavior while exposing
 * a simplified tab name in MVP mode.
 */
const RawDataPressureAnalysisPage = (props) => (
  <DataPreprocessingPage {...props} />
);

export default RawDataPressureAnalysisPage;

