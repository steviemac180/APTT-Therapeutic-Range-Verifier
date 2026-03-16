import { ProcessedDataRow, AnalysisConfig, SupportDiagnostics, Comparison } from '../../types';

export function calculateSupportDiagnostics(
  data: ProcessedDataRow[],
  comparisons: Comparison[],
  config: AnalysisConfig
): SupportDiagnostics[] {
  const { therapeuticXaRange } = config;
  
  return comparisons.filter(c => c.included).map(comp => {
    const compData = data.filter(d => d.comparisonId === comp.id && d.isUsable);
    const totalUsable = compData.length;
    
    if (totalUsable === 0) {
      return {
        totalUsable: 0,
        therapeuticCount: 0,
        therapeuticPercentage: 0,
        xaMin: 0,
        xaMax: 0,
        lowerLimitSupport: 'Poor',
        upperLimitSupport: 'Poor',
        censoredCount: 0,
        censoredPercentage: 0,
        coverageStatus: 'Weak support',
        interpretation: 'No usable data found for this comparison.',
        comparisonId: comp.id,
        comparisonLabel: comp.label,
        isPrimary: comp.isPrimary
      };
    }

    const therapeuticData = compData.filter(d => 
      d.xa !== null && 
      d.xa >= therapeuticXaRange.lower && 
      d.xa <= therapeuticXaRange.upper
    );
    
    const therapeuticCount = therapeuticData.length;
    const therapeuticPercentage = (therapeuticCount / totalUsable) * 100;
    
    const xaValues = compData.map(d => d.xa || 0);
    const xaMin = Math.min(...xaValues);
    const xaMax = Math.max(...xaValues);
    
    const censoredCount = compData.filter(d => d.flags.includes('CAPPED_VALUE')).length;
    const censoredPercentage = (censoredCount / totalUsable) * 100;

    // Heuristics for support
    // Nearby data: within 0.1 IU/mL of the limit
    const lowerBuffer = 0.1;
    const upperBuffer = 0.1;
    
    const lowerNearbyCount = compData.filter(d => 
      d.xa !== null && 
      d.xa >= therapeuticXaRange.lower - lowerBuffer && 
      d.xa <= therapeuticXaRange.lower + lowerBuffer
    ).length;
    
    const upperNearbyCount = compData.filter(d => 
      d.xa !== null && 
      d.xa >= therapeuticXaRange.upper - upperBuffer && 
      d.xa <= therapeuticXaRange.upper + upperBuffer
    ).length;

    const lowerLimitSupport = lowerNearbyCount >= 5 ? 'Adequate' : lowerNearbyCount >= 2 ? 'Limited' : 'Poor';
    const upperLimitSupport = upperNearbyCount >= 5 ? 'Adequate' : upperNearbyCount >= 2 ? 'Limited' : 'Poor';

    // Coverage status
    let coverageStatus: SupportDiagnostics['coverageStatus'] = 'Good support';
    let issues = [];

    if (lowerLimitSupport === 'Poor' || upperLimitSupport === 'Poor') {
      coverageStatus = 'Weak support';
      if (lowerLimitSupport === 'Poor') issues.push('low data density near the lower therapeutic limit');
      if (upperLimitSupport === 'Poor') issues.push('low data density near the upper therapeutic limit');
    } else if (lowerLimitSupport === 'Limited' || upperLimitSupport === 'Limited' || therapeuticPercentage < 20) {
      coverageStatus = 'Moderate support';
      if (lowerLimitSupport === 'Limited') issues.push('limited data near the lower limit');
      if (upperLimitSupport === 'Limited') issues.push('limited data near the upper limit');
      if (therapeuticPercentage < 20) issues.push('low proportion of therapeutic samples');
    }

    if (totalUsable < 30) {
      coverageStatus = 'Weak support';
      issues.push('small overall sample size');
    }

    const interpretation = issues.length > 0 
      ? `Support is ${coverageStatus.toLowerCase()} due to ${issues.join(', ')}.`
      : 'Data provides robust coverage across the therapeutic range.';

    return {
      totalUsable,
      therapeuticCount,
      therapeuticPercentage,
      xaMin,
      xaMax,
      lowerLimitSupport,
      upperLimitSupport,
      censoredCount,
      censoredPercentage,
      coverageStatus,
      interpretation,
      comparisonId: comp.id,
      comparisonLabel: comp.label,
      isPrimary: comp.isPrimary
    };
  });
}
