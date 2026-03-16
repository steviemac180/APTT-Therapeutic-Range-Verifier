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

  let linkageMethod: 'lot-ID-based' | 'year-based fallback assumption' | undefined = undefined;
  let isAmbiguous = false;
  let links: { from: Comparison; to: Comparison }[] = [];

  // 1. Try Lot-ID based linkage
  for (let i = 0; i < includedComparisons.length; i++) {
    for (let j = 0; j < includedComparisons.length; j++) {
      if (i === j) continue;
      const c1 = includedComparisons[i];
      const c2 = includedComparisons[j];
      
      if (c1.newLotId && c2.currentLotId && c1.newLotId === c2.currentLotId) {
        if (c1.year !== null && c2.year !== null && c2.year >= c1.year) {
          links.push({ from: c1, to: c2 });
        }
      }
    }
  }

  if (links.length > 0) {
    linkageMethod = 'lot-ID-based';
  } else {
    // 2. Try Year-based fallback
    const yearGroups: Record<number, Comparison[]> = {};
    includedComparisons.forEach(c => {
      if (c.year !== null) {
        if (!yearGroups[c.year]) yearGroups[c.year] = [];
        yearGroups[c.year].push(c);
      }
    });

    const years = Object.keys(yearGroups).map(Number).sort((a, b) => a - b);
    
    for (let i = 0; i < years.length - 1; i++) {
      const y1 = years[i];
      const y2 = years[i+1];
      
      if (y2 === y1 + 1) {
        const comps1 = yearGroups[y1];
        const comps2 = yearGroups[y2];
        
        if (comps1.length === 1 && comps2.length === 1) {
          links.push({ from: comps1[0], to: comps2[0] });
        } else {
          isAmbiguous = true;
        }
      }
    }
    
    if (links.length > 0) {
      linkageMethod = 'year-based fallback assumption';
    }
  }

  if (links.length === 0) {
    return {
      possible: false,
      status: 'insufficient_data' as const,
      linkageMethod,
      isAmbiguous,
      metrics: [],
      interpretation: isAmbiguous 
        ? 'Temporal analysis is ambiguous due to multiple comparisons in the same year. Please provide Lot IDs to enable linkage.'
        : 'No linked comparisons were detected. Temporal analysis requires successive years or linked Lot IDs.'
    };
  }

  // Calculate metrics for each link
  const metrics = links.map(link => {
    const fromData = data.filter(d => d.comparisonId === link.from.id && d.isUsable);
    const toData = data.filter(d => d.comparisonId === link.to.id && d.isUsable);
    
    // Regression for "from" New Lot
    const modelFrom = fitDemingRegression(fromData, 'xa', 'apttNew');
    // Regression for "to" Current Lot (which should be the same lot)
    const modelTo = fitDemingRegression(toData, 'xa', 'apttCurrent');
    
    // Calculate shifts at therapeutic Xa points
    const xaLower = config.therapeuticXaRange.lower;
    const xaUpper = config.therapeuticXaRange.upper;
    
    const apttFromLower = modelFrom.slope * xaLower + modelFrom.intercept;
    const apttFromUpper = modelFrom.slope * xaUpper + modelFrom.intercept;
    
    const apttToLower = modelTo.slope * xaLower + modelTo.intercept;
    const apttToUpper = modelTo.slope * xaUpper + modelTo.intercept;
    
    const shiftAtLower = apttToLower - apttFromLower;
    const shiftAtUpper = apttToUpper - apttFromUpper;
    const avgShift = (shiftAtLower + shiftAtUpper) / 2;
    const widthChange = (apttToUpper - apttToLower) - (apttFromUpper - apttFromLower);

    return {
      year: link.to.year || 0,
      slope: modelFrom.slope,
      intercept: modelFrom.intercept,
      r2: modelFrom.r2,
      n: modelFrom.n,
      label: link.from.label,
      linkLabel: `${link.from.label} → ${link.to.label}`,
      shiftAtLower,
      shiftAtUpper,
      avgShift,
      widthChange
    };
  });

  // Analyze stability
  const avgShifts = metrics.map(m => Math.abs(m.avgShift || 0));
  const maxAbsShift = Math.max(...avgShifts);
  
  let status: 'absent' | 'possible' | 'repeated' = 'absent';
  if (maxAbsShift > 3.0) {
    status = 'possible';
    if (metrics.length >= 2) {
      const allPositive = metrics.every(m => (m.avgShift || 0) > 1.0);
      const allNegative = metrics.every(m => (m.avgShift || 0) < -1.0);
      if (allPositive || allNegative) status = 'repeated';
    }
  }

  let interpretation = '';
  if (status === 'absent') {
    interpretation = 'Lot behavior appears stable across successive linked comparisons. No significant temporal signal detected.';
  } else if (status === 'possible') {
    interpretation = 'Minor variations in lot sensitivity or instrument drift were observed across linked comparisons.';
  } else {
    interpretation = 'A repeated temporal signal or trend in lot behavior was observed across successive comparisons. This warrants closer monitoring of reagent stability or instrument performance.';
  }

  if (linkageMethod === 'year-based fallback assumption') {
    interpretation += " When lot IDs are unavailable, linked temporal analysis assumes that each year's new lot becomes the following year's current lot.";
  }
  
  interpretation += ' Note: This is supportive observational evidence based on historical lot performance and does not imply a causal relationship.';

  return {
    possible: true,
    status,
    linkageMethod,
    isAmbiguous,
    metrics,
    interpretation
  };
};
