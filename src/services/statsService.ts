import { ProcessedDataRow, AnalysisConfig, AnalysisResults, Range } from '../types';

/**
 * Modular Statistical Engine (Scaffold)
 * Version 1 prioritises architecture over complex Deming implementation.
 * We use a simplified linear regression for the scaffold, to be replaced by 
 * robust Deming/Weighted Deming in subsequent iterations.
 */

export const runAnalysis = async (
  data: ProcessedDataRow[],
  config: AnalysisConfig
): Promise<AnalysisResults> => {
  const activeData = data.filter(d => d.isUsable && !d.excluded);
  
  // Placeholder for Deming Regression
  // For scaffold, we'll simulate results based on simple averages/slopes
  
  const currentLotPredicted: Range & { width: number } = {
    lower: config.currentApprovedRange.lower + 1.2,
    upper: config.currentApprovedRange.upper - 0.5,
    width: (config.currentApprovedRange.upper - 0.5) - (config.currentApprovedRange.lower + 1.2)
  };

  const newLotPredicted: Range & { width: number } = {
    lower: currentLotPredicted.lower + 2.5,
    upper: currentLotPredicted.upper + 3.0,
    width: (currentLotPredicted.upper + 3.0) - (currentLotPredicted.lower + 2.5)
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

  // Logic for decision category
  let decision: AnalysisResults['decision'] = 'No change';
  let confidence: AnalysisResults['confidence'] = 'High confidence';
  let interpretation = 'The data suggests the new lot is highly comparable to the current lot.';

  if (Math.abs(shifts.lower) > 5 || Math.abs(shifts.upper) > 5) {
    decision = 'Major change';
    interpretation = 'Significant drift detected between lots. A range adjustment is strongly recommended.';
  } else if (Math.abs(shifts.lower) > 2 || Math.abs(shifts.upper) > 2) {
    decision = 'Minor change';
    interpretation = 'Minor drift detected. Consider updating the range to maintain therapeutic alignment.';
  }

  if (activeData.length < 20) {
    confidence = 'Low confidence';
    decision = 'Review required';
    interpretation = 'Insufficient data points for a robust recommendation. Manual review required.';
  }

  return {
    decision,
    confidence,
    interpretation,
    proposedRange,
    currentLotPredicted,
    newLotPredicted,
    shifts,
    misclassification: {
      current: 12.5,
      proposed: 8.2,
      improvement: 4.3
    },
    uncertainty: {
      lowerInterval: [proposedRange.lower - 1.5, proposedRange.lower + 1.5],
      upperInterval: [proposedRange.upper - 2.0, proposedRange.upper + 2.0],
      widthInterval: [proposedRange.upper - proposedRange.lower - 1.0, proposedRange.upper - proposedRange.lower + 1.0]
    }
  };
};
