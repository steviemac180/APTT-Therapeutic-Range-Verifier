import { AnalysisResults, Range } from '../../types';

export const generateRecommendations = (
  shifts: { lower: number; upper: number; width: number },
  confidence: AnalysisResults['confidence']
) => {
  let decision: AnalysisResults['decision'] = 'No change';
  
  const absLower = Math.abs(shifts.lower);
  const absUpper = Math.abs(shifts.upper);

  let interpretation = `The new lot shows a ${shifts.lower >= 0 ? 'positive' : 'negative'} shift of ${absLower.toFixed(1)}s at the lower limit and a ${shifts.upper >= 0 ? 'positive' : 'negative'} shift of ${absUpper.toFixed(1)}s at the upper limit. `;

  if (absLower > 5 || absUpper > 5) {
    decision = 'Major change';
    interpretation += 'Significant lot-to-lot variation detected. A range update is strongly advised to maintain therapeutic safety.';
  } else if (absLower > 2 || absUpper > 2) {
    decision = 'Minor change';
    interpretation += 'Moderate variation detected. A range adjustment is recommended to ensure clinical alignment.';
  } else {
    decision = 'No change';
    interpretation += 'The new lot is statistically comparable to the current lot. No range adjustment is strictly necessary.';
  }

  if (confidence === 'Low confidence') {
    decision = 'Review required';
    interpretation = 'The analysis has low statistical confidence due to limited data points. Manual review of the regression and raw data is required before implementation.';
  }

  return { decision, interpretation };
};
