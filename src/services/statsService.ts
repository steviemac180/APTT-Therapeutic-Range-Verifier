import { ProcessedDataRow, AnalysisConfig, AnalysisResults, Range, Comparison } from '../types';
import { prepareAnalysisData, generateSummaryResults } from './analysis/dataPrep';
import { calculateMUAdjustments, calculateSampleWeights } from './analysis/muHandler';
import { fitDemingRegression, predictRange, fitOLSRegression, fitPassingBablokRegression } from './analysis/regression';
import { calculateMisclassificationRates } from './analysis/misclassification';
import { generateRecommendations } from './analysis/recommendation';
import { analyzeTemporalSignals } from './analysis/temporal';

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

  // 6. Sensitivity Analysis
  let sensitivityAnalysis: AnalysisResults['sensitivityAnalysis'] = undefined;
  if (config.enableSensitivityAnalysis) {
    const sensitivityResults: any[] = [];
    
    // OLS
    const olsModel = fitOLSRegression(activeData, 'xa', 'apttNew');
    const olsRangeRaw = predictRange(olsModel, config.therapeuticXaRange);
    sensitivityResults.push({
      method: 'OLS',
      proposedRange: { lower: Math.round(olsRangeRaw.lower), upper: Math.round(olsRangeRaw.upper) },
      width: Math.round(olsRangeRaw.upper - olsRangeRaw.lower),
      slope: olsModel.slope,
      intercept: olsModel.intercept
    });

    // Passing-Bablok
    const pbModel = fitPassingBablokRegression(activeData, 'xa', 'apttNew');
    const pbRangeRaw = predictRange(pbModel, config.therapeuticXaRange);
    sensitivityResults.push({
      method: 'Passing-Bablok',
      proposedRange: { lower: Math.round(pbRangeRaw.lower), upper: Math.round(pbRangeRaw.upper) },
      width: Math.round(pbRangeRaw.upper - pbRangeRaw.lower),
      slope: pbModel.slope,
      intercept: pbModel.intercept
    });

    // Standard Deming (if primary is Weighted)
    if (newModel.method === 'Weighted Deming') {
      const stdDemingModel = fitDemingRegression(activeData, 'xa', 'apttNew', undefined, 1.0);
      const stdDemingRangeRaw = predictRange(stdDemingModel, config.therapeuticXaRange);
      sensitivityResults.push({
        method: 'Standard Deming',
        proposedRange: { lower: Math.round(stdDemingRangeRaw.lower), upper: Math.round(stdDemingRangeRaw.upper) },
        width: Math.round(stdDemingRangeRaw.upper - stdDemingRangeRaw.lower),
        slope: stdDemingModel.slope,
        intercept: stdDemingModel.intercept
      });
    }

    // Compare and assign agreement
    let overallAgreement = true;
    let disagreementReason = '';
    
    const finalResults = sensitivityResults.map(res => {
      const lowerDiff = Math.abs(res.proposedRange.lower - proposedRange.lower);
      const upperDiff = Math.abs(res.proposedRange.upper - proposedRange.upper);
      
      let agreement: 'Agree' | 'Minor Disagreement' | 'Major Disagreement' = 'Agree';
      if (lowerDiff > 5 || upperDiff > 5) {
        agreement = 'Major Disagreement';
        overallAgreement = false;
        disagreementReason = `Material difference detected with ${res.method}`;
      } else if (lowerDiff > 2 || upperDiff > 2) {
        agreement = 'Minor Disagreement';
      }
      
      return { ...res, agreement };
    });

    sensitivityAnalysis = {
      enabled: true,
      results: finalResults,
      overallAgreement,
      disagreementReason
    };
  }

  // 7. Confidence & Recommendations
  const dataQuality = {
    flags: summary.qc.flaggedUsableCount > 0 ? ['Data quality concerns were flagged during pre-analysis validation'] : [],
    usableCount: activeData.length,
    hasCensored: summary.qc.censoredCount > 0,
    excludedComparisonsCount: comparisons.filter(c => !c.included).length
  };

  const { decision, confidence, interpretation, warnings } = generateRecommendations(
    shifts, 
    misclassification,
    { lowerShiftInterval, upperShiftInterval, widthShiftInterval },
    dataQuality,
    { method: newModel.method, reason: newModel.reason },
    sensitivityAnalysis
  );

  // 8. Temporal Analysis
  const temporalSignal = analyzeTemporalSignals(data, comparisons, config);

  return {
    summary,
    decision,
    confidence,
    interpretation,
    warnings,
    proposedRange,
    currentLotPredicted,
    newLotPredicted,
    shifts,
    misclassification,
    regressionMethod: newModel.method,
    regressionReason: newModel.reason,
    regressionModel: {
      slope: newModel.slope,
      intercept: newModel.intercept,
      r2: newModel.r2
    },
    uncertainty: {
      lowerInterval,
      upperInterval,
      widthInterval,
      lowerShiftInterval,
      upperShiftInterval,
      widthShiftInterval,
      iterations
    },
    temporalSignal,
    sensitivityAnalysis
  };
};
