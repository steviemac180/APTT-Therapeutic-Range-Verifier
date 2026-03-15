import { ProcessedDataRow, Range, AnalysisConfig, MisclassificationData, ConfusionMatrix } from '../../types';

type Category = 'below' | 'therapeutic' | 'above';

const getCategory = (value: number | null, range: Range): Category => {
  if (value === null) return 'therapeutic'; // Should not happen with filtered data
  if (value < range.lower) return 'below';
  if (value > range.upper) return 'above';
  return 'therapeutic';
};

const createEmptyMatrix = (): ConfusionMatrix => ({
  below: { below: 0, therapeutic: 0, above: 0 },
  therapeutic: { below: 0, therapeutic: 0, above: 0 },
  above: { below: 0, therapeutic: 0, above: 0 },
});

const calculateWeightedScore = (matrix: ConfusionMatrix, weights: AnalysisConfig['riskWeights']): number => {
  let score = 0;
  
  // Sub -> Therapeutic (Xa is below, APTT is therapeutic)
  score += matrix.below.therapeutic * weights.subToTherapeutic;
  // Supra -> Therapeutic (Xa is above, APTT is therapeutic)
  score += matrix.above.therapeutic * weights.supraToTherapeutic;
  // Therapeutic -> Outside (Xa is therapeutic, APTT is below or above)
  score += (matrix.therapeutic.below + matrix.therapeutic.above) * weights.therapeuticToOutside;
  // Sub -> Supra (Xa is below, APTT is above)
  score += matrix.below.above * weights.subToSupra;
  // Supra -> Sub (Xa is above, APTT is below)
  score += matrix.above.below * weights.supraToSub;
  
  return score;
};

export const calculateSingleRangeMisclassification = (
  data: ProcessedDataRow[],
  range: Range,
  config: AnalysisConfig,
  apttField: 'apttCurrent' | 'apttNew' = 'apttNew'
): MisclassificationData => {
  const matrix = createEmptyMatrix();
  
  if (data.length === 0) {
    return {
      total: 0,
      rate: 0,
      weightedScore: 0,
      matrix
    };
  }

  data.forEach(row => {
    if (row.xa === null) return;
    const xaCat = getCategory(row.xa, config.therapeuticXaRange);
    const apttVal = row[apttField];
    
    if (apttVal !== null) {
      const apttCat = getCategory(apttVal, range);
      matrix[xaCat][apttCat]++;
    }
  });

  const total = data.length;
  const mismatches = 
    matrix.below.therapeutic + matrix.below.above +
    matrix.therapeutic.below + matrix.therapeutic.above +
    matrix.above.below + matrix.above.therapeutic;
  
  const rate = (mismatches / total) * 100;
  const weightedScore = calculateWeightedScore(matrix, config.riskWeights);
  
  return {
    total,
    rate: Math.round(rate * 10) / 10,
    weightedScore: Math.round(weightedScore * 10) / 10,
    matrix
  };
};

export const calculateMisclassificationRates = (
  data: ProcessedDataRow[],
  currentRange: Range,
  proposedRange: Range,
  config: AnalysisConfig
) => {
  const current = calculateSingleRangeMisclassification(data, currentRange, config, 'apttCurrent');
  const proposed = calculateSingleRangeMisclassification(data, proposedRange, config, 'apttNew');
  
  return {
    current,
    proposed,
    improvement: Math.round((current.rate - proposed.rate) * 10) / 10,
    weightedImprovement: Math.round((current.weightedScore - proposed.weightedScore) * 10) / 10
  };
};
