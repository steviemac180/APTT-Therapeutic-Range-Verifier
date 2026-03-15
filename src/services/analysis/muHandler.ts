import { AnalysisConfig, ProcessedDataRow, MUBand } from '../../types';

export interface SampleWeights {
  wx: number;
  wy: number;
}

const getBandValue = (value: number, muValue: number, unit: 'SD' | 'CV%'): number => {
  if (unit === 'SD') return muValue;
  return (muValue / 100) * value;
};

const findBandValue = (value: number, bands: MUBand[], unit: 'SD' | 'CV%'): number => {
  const band = bands.find(b => value >= b.lowerBound && value <= b.upperBound);
  if (!band) {
    // Fallback to nearest band if outside range
    if (bands.length === 0) return 0;
    if (value < bands[0].lowerBound) return getBandValue(value, bands[0].value, unit);
    return getBandValue(value, bands[bands.length - 1].value, unit);
  }
  return getBandValue(value, band.value, unit);
};

export const calculateSampleWeights = (
  row: ProcessedDataRow,
  config: AnalysisConfig,
  yKey: 'apttNew' | 'apttCurrent'
): SampleWeights => {
  const xVal = row.xa || 0;
  const yVal = row[yKey] || 0;

  if (!config.includeMU) {
    return { wx: 1, wy: 1 };
  }

  const sdX = findBandValue(xVal, config.muBands.xa, config.muUnits.xa);
  const sdY = findBandValue(yVal, yKey === 'apttNew' ? config.muBands.apttNew : config.muBands.apttCurrent, yKey === 'apttNew' ? config.muUnits.apttNew : config.muUnits.apttCurrent);

  // Weights are 1/variance
  // Avoid division by zero
  const wx = sdX > 0 ? 1 / (sdX * sdX) : 1e6;
  const wy = sdY > 0 ? 1 / (sdY * sdY) : 1e6;

  return { wx, wy };
};

export const calculateMUAdjustments = (
  data: ProcessedDataRow[],
  config: AnalysisConfig
) => {
  // Placeholder for aggregate MU propagation logic if needed later
  return {
    xaUncertainty: 0.05,
    apttUncertainty: 2.0
  };
};
