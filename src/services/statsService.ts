import { ProcessedDataRow, AnalysisConfig, AnalysisResults, Range, Comparison } from '../types';
import { prepareAnalysisData, generateSummaryResults } from './analysis/dataPrep';
import { calculateMUAdjustments } from './analysis/muHandler';
import { fitDemingRegression, predictRange } from './analysis/regression';
import { calculateMisclassificationRates } from './analysis/misclassification';
import { generateRecommendations } from './analysis/recommendation';

export const runAnalysis = async (
  data: ProcessedDataRow[],
  config: AnalysisConfig,
  comparisons: Comparison[]
): Promise<AnalysisResults> => {
  // 1. Data Preparation & Summary Stats
  const activeData = prepareAnalysisData(data, comparisons);
  const summary = generateSummaryResults(data, comparisons);
  
  // 2. MU Handling
  const muAdjustments = calculateMUAdjustments(activeData, config);
  
  // 3. Regression
  const currentModel = fitDemingRegression(activeData, 'xa', 'apttCurrent');
  const newModel = fitDemingRegression(activeData, 'xa', 'apttNew');

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

  // 4. Confidence & Recommendations
  let confidence: AnalysisResults['confidence'] = 'High confidence';
  if (activeData.length < 20) {
    confidence = 'Low confidence';
  } else if (activeData.length < 40) {
    confidence = 'Moderate confidence';
  }

  const { decision, interpretation } = generateRecommendations(shifts, confidence);

  // 5. Misclassification
  const misclassification = calculateMisclassificationRates(
    activeData, 
    config.currentApprovedRange, 
    proposedRange, 
    config
  );

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
    uncertainty: {
      lowerInterval: [proposedRange.lower - 1.5, proposedRange.lower + 1.5],
      upperInterval: [proposedRange.upper - 2.0, proposedRange.upper + 2.0],
      widthInterval: [proposedRange.upper - proposedRange.lower - 1.0, proposedRange.upper - proposedRange.lower + 1.0]
    }
  };
};
