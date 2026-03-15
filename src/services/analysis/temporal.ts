import { ProcessedDataRow, Comparison, AnalysisConfig } from '../../types';
import { fitDemingRegression } from './regression';

export const analyzeTemporalSignals = (
  data: ProcessedDataRow[],
  comparisons: Comparison[],
  config: AnalysisConfig
) => {
  const includedComparisons = comparisons.filter(c => c.included).sort((a, b) => (a.year || 0) - (b.year || 0));
  
  if (includedComparisons.length < 2) {
    return {
      possible: false,
      status: 'insufficient_data' as const,
      metrics: [],
      interpretation: 'Temporal analysis requires at least two successive linked comparisons.'
    };
  }

  // Find linked comparisons
  // A link exists if Comparison A's New Lot is Comparison B's Current Lot
  const links: { from: Comparison; to: Comparison }[] = [];
  for (let i = 0; i < includedComparisons.length; i++) {
    for (let j = 0; j < includedComparisons.length; j++) {
      if (i === j) continue;
      const c1 = includedComparisons[i];
      const c2 = includedComparisons[j];
      
      if (c1.newLotId && c2.currentLotId && c1.newLotId === c2.currentLotId) {
        // Check if they are successive or close in time
        if (c1.year !== null && c2.year !== null && c2.year >= c1.year) {
          links.push({ from: c1, to: c2 });
        }
      }
    }
  }

  if (links.length === 0) {
    return {
      possible: false,
      status: 'insufficient_data' as const,
      metrics: [],
      interpretation: 'No linked lot identifiers were detected across the included comparisons.'
    };
  }

  // Run regression for each comparison to see how "New Lot" behaves relative to Xa
  const metrics = includedComparisons.map(comp => {
    const compData = data.filter(d => d.comparisonId === comp.id && d.isUsable);
    const model = fitDemingRegression(compData, 'xa', 'apttNew');
    
    return {
      year: comp.year || 0,
      slope: model.slope,
      intercept: model.intercept,
      r2: model.r2,
      n: model.n,
      label: comp.label
    };
  });

  // Analyze stability of slopes/intercepts
  const slopes = metrics.map(m => m.slope);
  const slopeVar = Math.max(...slopes) - Math.min(...slopes);
  
  let status: 'absent' | 'possible' | 'repeated' = 'absent';
  if (slopeVar > 0.15) {
    status = 'possible';
    if (includedComparisons.length >= 3) {
      // Check for a trend
      const isTrending = slopes.every((s, i) => i === 0 || s > slopes[i-1]) || slopes.every((s, i) => i === 0 || s < slopes[i-1]);
      if (isTrending) status = 'repeated';
    }
  }

  let interpretation = '';
  if (status === 'absent') {
    interpretation = 'Lot behavior appears stable across successive linked comparisons. No significant temporal signal detected.';
  } else if (status === 'possible') {
    interpretation = 'Minor variations in lot sensitivity were observed across linked comparisons. This may represent normal lot-to-lot variability.';
  } else {
    interpretation = 'A repeated temporal signal or trend in lot behavior was observed across successive comparisons. This warrants closer monitoring of reagent stability or instrument performance.';
  }

  interpretation += ' Note: This is supportive observational evidence based on historical lot performance and does not imply a causal relationship.';

  return {
    possible: true,
    status,
    metrics,
    interpretation
  };
};
