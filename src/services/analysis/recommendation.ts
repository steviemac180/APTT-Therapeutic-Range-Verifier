import { AnalysisResults, Range, DecisionCategory, ConfidenceLevel } from '../../types';

export const generateRecommendations = (
  shifts: { lower: number; upper: number; width: number },
  misclassification: { improvement: number; weightedImprovement: number },
  uncertainty: {
    lowerShiftInterval: [number, number];
    upperShiftInterval: [number, number];
    widthShiftInterval: [number, number];
  },
  dataQuality: {
    flags: string[];
    usableCount: number;
    hasCensored: boolean;
    excludedComparisonsCount: number;
  },
  regressionInfo: {
    method: 'Weighted Deming' | 'Standard Deming';
    reason?: string;
  }
) => {
  let decision: DecisionCategory = 'No change';
  let confidence: ConfidenceLevel = 'High confidence';
  const warnings: string[] = [];

  const absLower = Math.abs(shifts.lower);
  const absUpper = Math.abs(shifts.upper);
  const absWidth = Math.abs(shifts.width);

  // 1. Determine Confidence Level
  if (dataQuality.usableCount < 25 || dataQuality.flags.length > 2 || dataQuality.excludedComparisonsCount > 0) {
    confidence = 'Low confidence';
  } else if (dataQuality.usableCount < 45 || dataQuality.flags.length > 0) {
    confidence = 'Moderate confidence';
  }

  // 2. Decision Logic
  if (absLower > 5 || absUpper > 5 || absWidth > 4) {
    decision = 'Major change';
  } else if (absLower > 1.5 || absUpper > 1.5 || absWidth > 1.5) {
    decision = 'Minor change';
  } else {
    decision = 'No change';
  }

  // 3. Force "Review required" for instability or inadequate data
  const shiftUncertaintyLarge = 
    (uncertainty.lowerShiftInterval[1] - uncertainty.lowerShiftInterval[0] > 6) ||
    (uncertainty.upperShiftInterval[1] - uncertainty.upperShiftInterval[0] > 6);

  if (dataQuality.usableCount < 15 || dataQuality.flags.includes('Insufficient anti-Xa spread detected in usable data') || shiftUncertaintyLarge) {
    decision = 'Review required';
  }

  // 4. Generate Warnings
  if (dataQuality.hasCensored) warnings.push('Censored values (APTT >= 139 or Xa >= 1.5) are present in the dataset, which may bias the regression.');
  if (dataQuality.excludedComparisonsCount > 0) warnings.push(`${dataQuality.excludedComparisonsCount} comparison(s) were excluded from this analysis.`);
  if (confidence === 'Low confidence') warnings.push('Statistical confidence is low due to limited data or high variability.');
  if (dataQuality.flags.length > 0) warnings.push('Data quality concerns were flagged during pre-analysis validation.');
  if (regressionInfo.method === 'Standard Deming') warnings.push('Weighted Deming failed to converge; standard Deming regression was used as a fallback.');

  // 5. Generate Interpretation
  let interpretation = '';
  
  if (decision === 'Review required') {
    interpretation = "The analysis indicates that the data may be insufficient or too unstable to provide a reliable recommendation. Manual review of the regression plots and raw data is required before any clinical implementation.";
  } else if (decision === 'No change') {
    interpretation = `The new lot is statistically comparable to the current lot. With shifts of ${shifts.lower.toFixed(1)}s (lower) and ${shifts.upper.toFixed(1)}s (upper), no range adjustment is strictly necessary to maintain clinical alignment.`;
  } else {
    interpretation = `A ${decision.toLowerCase()} is recommended. The new lot shows a ${shifts.lower >= 0 ? 'positive' : 'negative'} shift of ${absLower.toFixed(1)}s at the lower limit and a ${shifts.upper >= 0 ? 'positive' : 'negative'} shift of ${absUpper.toFixed(1)}s at the upper limit. `;
    
    if (misclassification.weightedImprovement > 0) {
      interpretation += `The proposed range improves the weighted risk score by ${misclassification.weightedImprovement.toFixed(1)} units, supporting the safety of this adjustment.`;
    } else if (misclassification.weightedImprovement < 0) {
      interpretation += `Note that the proposed range slightly increases the weighted risk score (${Math.abs(misclassification.weightedImprovement).toFixed(1)} units).`;
    }
  }

  return { decision, confidence, interpretation, warnings };
};
