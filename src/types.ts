/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface RawDataRow {
  Year: string | number;
  Xa: string | number;
  'APTT New Lot': string | number;
  'APTT Current Lot': string | number;
  'New Lot ID'?: string;
  'Current Lot ID'?: string;
  'Comparison ID'?: string;
  [key: string]: any;
}

export interface ProcessedDataRow {
  id: string;
  year: number;
  xa: number;
  apttNew: number;
  apttCurrent: number;
  newLotId?: string;
  currentLotId?: string;
  comparisonId?: string;
  excluded: boolean;
  exclusionReason?: string;
}

export type DecisionCategory = 'No change' | 'Minor change' | 'Major change' | 'Review required';
export type ConfidenceLevel = 'High confidence' | 'Moderate confidence' | 'Low confidence';

export interface Range {
  lower: number;
  upper: number;
}

export interface MUBand {
  lowerBound: number;
  upperBound: number;
  value: number;
  unit: 'SD' | 'CV%';
}

export interface LabConfig {
  labName: string;
  organisation: string;
  reportTitle: string;
  analyser: string;
  manufacturer: string;
  assayName: string;
}

export interface AnalysisConfig {
  currentApprovedRange: Range;
  therapeuticXaRange: Range;
  muBands: {
    xa: MUBand[];
    apttCurrent: MUBand[];
    apttNew: MUBand[];
  };
  analysisDepth: 'Standard' | 'Advanced';
  riskWeights: {
    subToTherapeutic: number;
    supraToTherapeutic: number;
    therapeuticToOutside: number;
    subToSupra: number;
    supraToSub: number;
  };
}

export interface AnalysisResults {
  decision: DecisionCategory;
  confidence: ConfidenceLevel;
  interpretation: string;
  proposedRange: Range;
  currentLotPredicted: Range & { width: number };
  newLotPredicted: Range & { width: number };
  shifts: {
    lower: number;
    upper: number;
    width: number;
  };
  misclassification: {
    current: number;
    proposed: number;
    improvement: number;
  };
  uncertainty: {
    lowerInterval: [number, number];
    upperInterval: [number, number];
    widthInterval: [number, number];
  };
}
