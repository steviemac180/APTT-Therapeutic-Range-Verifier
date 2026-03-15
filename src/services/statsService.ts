import { ProcessedDataRow, AnalysisConfig, AnalysisResults, Range, Comparison } from '../types';
import { prepareAnalysisData, generateSummaryResults } from './analysis/dataPrep';
import { calculateMUAdjustments, calculateSampleWeights } from './analysis/muHandler';
import { fitDemingRegression, predictRange } from './analysis/regression';
import { calculateMisclassificationRates } from './analysis/misclassification';
import { generateRecommendations } from './analysis/recommendation';

const runBootstrap = (data: ProcessedDataRow[], config: AnalysisConfig, iterations: number): Promise<any> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis/bootstrap.worker.ts', import.meta.url), { type: 'module' });
    worker.postMessage({ data, config, iterations });
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(e);
      worker.terminate();
    };
  });
};

const calculatePercentiles = (values: number[], p1: number, p2: number): [number, number] => {
  if (values.length === 0) return [0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const idx1 = Math.max(0, Math.min(sorted.length - 1, Math.floor(p1 * sorted.length)));
  const idx2 = Math.max(0, Math.min(sorted.length - 1, Math.floor(p2 * sorted.length)));
  return [sorted[idx1], sorted[idx2]];
};

export const runAnalysis = async (
  data: ProcessedDataRow[],
  config: AnalysisConfig,
  comparisons: Comparison[]
): Promise<AnalysisResults> => {
  // 1. Data Preparation & Summary Stats
  const activeData = prepareAnalysisData(data, comparisons);
  const summary = generateSummaryResults(data, comparisons);
  
  // 2. MU Handling & Weighting
  const muAdjustments = calculateMUAdjustments(activeData, config);
  
  // Calculate weights for each sample
  const currentWeights = activeData.map(row => calculateSampleWeights(row, config, 'apttCurrent'));
  const newWeights = activeData.map(row => calculateSampleWeights(row, config, 'apttNew'));

  // 3. Regression
  // Attempt weighted Deming first
  const currentModel = fitDemingRegression(activeData, 'xa', 'apttCurrent', currentWeights);
  const newModel = fitDemingRegression(activeData, 'xa', 'apttNew', newWeights);

  const currentLotPredictedRaw = predictRange(currentModel, config.therapeuticXaRange);
  const newLotPredictedRaw = predictRange(newModel, config.therapeuticXaRange);
  
  const currentLotPredicted: Range & { width: number } = {
    lower: Math.round(currentLotPredictedRaw.lower * 10) / 10,
    upper: Math.round(currentLotPredictedRaw.upper * 10) / 10,
    width: Math.round((currentLotPredictedRaw.upper - currentLotPredictedRaw.lower) * 10) / 10
  };

  const newLotPredicted: Range & { width: number } = {
    lower: Math.round(newLotPredictedRaw.lower * 10) / 10,
    upper: Math.round(newLotPredictedRaw.upper * 10) / 10,
    width: Math.round((newLotPredictedRaw.upper - newLotPredictedRaw.lower) * 10) / 10
  };

  const proposedRange: Range = {
    lower: Math.round(newLotPredicted.lower),
    upper: Math.round(newLotPredicted.upper)
  };

  const shifts = {
    lower: proposedRange.lower - config.currentApprovedRange.lower,
    upper: proposedRange.upper - config.currentApprovedRange.upper,
    width: (proposedRange.upper - proposedRange.lower) - (config.currentApprovedRange.upper - config.currentApprovedRange.lower)
  };

  // 4. Bootstrap Uncertainty
  const iterations = config.analysisDepth === 'Advanced' ? 1000 : 200;
  const bootstrapResults = await runBootstrap(activeData, config, iterations);

  const lowerInterval = calculatePercentiles(bootstrapResults.lowerLimits, 0.025, 0.975);
  const upperInterval = calculatePercentiles(bootstrapResults.upperLimits, 0.025, 0.975);
  const widthInterval = calculatePercentiles(bootstrapResults.widths, 0.025, 0.975);
  const lowerShiftInterval = calculatePercentiles(bootstrapResults.lowerShifts, 0.025, 0.975);
  const upperShiftInterval = calculatePercentiles(bootstrapResults.upperShifts, 0.025, 0.975);
  const widthShiftInterval = calculatePercentiles(bootstrapResults.widthShifts, 0.025, 0.975);

  // 5. Misclassification
  const misclassification = calculateMisclassificationRates(
    activeData, 
    config.currentApprovedRange, 
    proposedRange, 
    config
  );

  // 6. Confidence & Recommendations
  let confidence: AnalysisResults['confidence'] = 'High confidence';
  if (activeData.length < 20) {
    confidence = 'Low confidence';
  } else if (activeData.length < 40) {
    confidence = 'Moderate confidence';
  }

  const { decision, interpretation } = generateRecommendations(shifts, confidence, misclassification);

  return {
    summary,
    decision,
    confidence,
    interpretation,
    proposedRange,
    currentLotPredicted,
    newLotPredicted,
    shifts,
    misclassification,
    regressionMethod: newModel.method,
    regressionReason: newModel.reason,
    uncertainty: {
      lowerInterval,
      upperInterval,
      widthInterval,
      lowerShiftInterval,
      upperShiftInterval,
      widthShiftInterval,
      iterations
    }
  };
};
