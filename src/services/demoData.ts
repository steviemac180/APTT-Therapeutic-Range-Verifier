/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProcessedDataRow, FileValidationSummary, AnalysisConfig, LabConfig } from '../types';
import { DEFAULT_XA_RANGE, DEFAULT_APTT_RANGE, DEFAULT_MU_BANDS, DEFAULT_MU_UNITS, DEFAULT_RISK_WEIGHTS } from '../constants';

export type DemoScenario = 'no_change' | 'minor_change' | 'major_change' | 'review_required';

export const getDemoData = (scenario: DemoScenario) => {
  const n = 45;
  const data: ProcessedDataRow[] = [];
  
  let slope = 1.0;
  let intercept = 0;
  let noise = 1.5;
  let outliers = 0;

  switch (scenario) {
    case 'no_change':
      slope = 1.01;
      intercept = 0.2;
      noise = 1.2;
      break;
    case 'minor_change':
      slope = 1.06;
      intercept = 3.5;
      noise = 1.8;
      break;
    case 'major_change':
      slope = 1.22;
      intercept = 12.0;
      noise = 2.5;
      break;
    case 'review_required':
      slope = 1.12;
      intercept = 6.0;
      noise = 5.5;
      outliers = 4;
      break;
  }

  // Base relationship: APTT = 32 + 85 * Xa (roughly)
  // Let's say Current Lot: APTT = 32 + 85 * Xa
  // New Lot: APTT = (32 + 85 * Xa) * slope + intercept + noise
  
  for (let i = 0; i < n; i++) {
    const xa = 0.15 + Math.random() * 1.15; // 0.15 to 1.3
    const apttCurrentBase = 32 + 85 * xa;
    const apttCurrent = apttCurrentBase + (Math.random() - 0.5) * 1.5;
    
    let apttNew = apttCurrentBase * slope + intercept + (Math.random() - 0.5) * noise * 2;
    
    if (outliers > 0 && i < outliers) {
        apttNew += (Math.random() > 0.5 ? 1 : -1) * (15 + Math.random() * 10);
    }

    data.push({
      id: `demo-${i}`,
      year: 2026,
      xa: Math.round(xa * 100) / 100,
      apttNew: Math.round(apttNew * 10) / 10,
      apttCurrent: Math.round(apttCurrent * 10) / 10,
      newLotId: 'DEMO-NEW-2026',
      currentLotId: 'DEMO-CUR-2025',
      comparisonId: 'cid:Demo Comparison',
      analyser: 'Demo Analyser X1',
      manufacturer: 'DemoCorp',
      assayName: 'DemoAPTT-Ultra',
      excluded: false,
      flags: [],
      isHeaderDuplicate: false,
      isUsable: true,
      rawValues: {}
    });
  }

  const summary: FileValidationSummary = {
    totalRows: n,
    usableRows: n,
    flaggedRows: 0,
    excludedRows: 0,
    issueCounts: {
      missingValues: 0,
      nonNumeric: 0,
      headerDuplicates: 0,
      cappedValues: 0,
    },
    missingRequiredColumns: [],
    detectedColumns: ['Year', 'Xa', 'APTT New Lot', 'APTT Current Lot'],
    hasRequiredColumns: true,
  };

  const labConfig: LabConfig = {
    labName: 'St. Demo Memorial Hospital',
    organisation: 'Demo Health Trust',
    reportTitle: 'APTT Lot Verification Report (DEMO)',
    analyser: 'Demo Analyser X1',
    manufacturer: 'DemoCorp',
    assayName: 'DemoAPTT-Ultra'
  };

  const analysisConfig: AnalysisConfig = {
    currentApprovedRange: DEFAULT_APTT_RANGE,
    therapeuticXaRange: DEFAULT_XA_RANGE,
    muBands: DEFAULT_MU_BANDS(DEFAULT_XA_RANGE, DEFAULT_APTT_RANGE),
    muUnits: DEFAULT_MU_UNITS,
    analysisDepth: 'Standard',
    includeMU: true,
    enableSensitivityAnalysis: scenario === 'review_required',
    riskWeights: DEFAULT_RISK_WEIGHTS
  };

  return { data, summary, labConfig, analysisConfig };
};
