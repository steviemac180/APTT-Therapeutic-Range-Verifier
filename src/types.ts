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
  year: number | null;
  xa: number | null;
  apttNew: number | null;
  apttCurrent: number | null;
  newLotId?: string;
  currentLotId?: string;
  comparisonId?: string;
  analyser?: string;
  manufacturer?: string;
  assayName?: string;
  excluded: boolean;
  exclusionReason?: string;
  flags: string[];
  isHeaderDuplicate: boolean;
  isUsable: boolean;
  rawValues: Record<string, string>;
}

export interface FileValidationSummary {
  totalRows: number;
  usableRows: number;
  flaggedRows: number;
  excludedRows: number;
  issueCounts: {
    missingValues: number;
    nonNumeric: number;
    headerDuplicates: number;
    cappedValues: number;
  };
  missingRequiredColumns: string[];
  detectedColumns: string[];
  hasRequiredColumns: boolean;
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
  muUnits: {
    xa: 'SD' | 'CV%';
    apttCurrent: 'SD' | 'CV%';
    apttNew: 'SD' | 'CV%';
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

export interface DescriptiveStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  count: number;
}

export interface SummaryResults {
  xa: DescriptiveStats;
  apttNew: DescriptiveStats;
  apttCurrent: DescriptiveStats;
  differences: {
    mean: number;
    median: number;
    absMean: number;
    absMedian: number;
    stdDev: number;
  };
  qc: {
    censoredCount: number;
    flaggedUsableCount: number;
    totalUsable: number;
  };
  comparisons: {
    id: string;
    label: string;
    count: number;
    isPrimary: boolean;
  }[];
}

export interface AnalysisResults {
  summary: SummaryResults;
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

export interface Comparison {
  id: string;
  label: string;
  year: number | null;
  newLotId?: string;
  currentLotId?: string;
  rowCount: number;
  flagCount: number;
  isAutoAssigned: boolean;
  included: boolean;
  isPrimary: boolean;
  exclusionReason?: string;
}

export type SetupStep = 'upload' | 'comparison' | 'config' | 'mu' | 'review';
