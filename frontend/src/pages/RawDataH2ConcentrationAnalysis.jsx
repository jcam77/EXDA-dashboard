import React from 'react';
import DataPreprocessingPage from './DataPreprocessingPage';

/**
 * MVP view for onsite-first raw hydrogen concentration workflow.
 * Reuses the preprocessing engine with a concentration-specific mode.
 */
const RawDataH2ConcentrationAnalysisPage = (props) => (
  <DataPreprocessingPage {...props} analysisMode="concentration" />
);

export default RawDataH2ConcentrationAnalysisPage;
