import { ProcessedDataRow, AnalysisConfig } from './types';

export const DEFAULT_XA_RANGE = { lower: 0.3, upper: 0.7 };
export const DEFAULT_APTT_RANGE = { lower: 60, upper: 100 };

export const DEFAULT_RISK_WEIGHTS = {
  subToTherapeutic: 1.0,
  supraToTherapeutic: 1.5,
  therapeuticToOutside: 0.8,
  subToSupra: 2.0,
  supraToSub: 2.0,
};

export const DEFAULT_MU_UNITS = {
  xa: 'SD' as const,
  apttCurrent: 'SD' as const,
  apttNew: 'SD' as const,
};

export const DEFAULT_MU_BANDS = (xaRange: { lower: number, upper: number }, apttRange: { lower: number, upper: number }) => ({
  xa: [
    { lowerBound: 0, upperBound: xaRange.lower, value: 0.04 },
    { lowerBound: xaRange.lower, upperBound: xaRange.upper, value: 0.08 },
    { lowerBound: xaRange.upper, upperBound: 2.0, value: 0.12 },
  ],
  apttCurrent: [
    { lowerBound: 0, upperBound: apttRange.lower, value: 1.0 },
    { lowerBound: apttRange.lower, upperBound: apttRange.upper, value: 2.5 },
    { lowerBound: apttRange.upper, upperBound: 200, value: 4.0 },
  ],
  apttNew: [
    { lowerBound: 0, upperBound: apttRange.lower, value: 1.0 },
    { lowerBound: apttRange.lower, upperBound: apttRange.upper, value: 2.5 },
    { lowerBound: apttRange.upper, upperBound: 200, value: 4.0 },
  ],
});
