import { ProcessedDataRow, SummaryResults, Comparison, DescriptiveStats } from '../../types';

export const prepareAnalysisData = (
  data: ProcessedDataRow[],
  comparisons: Comparison[]
) => {
  const usableData = data.filter(d => d.isUsable && !d.excluded);
  
  // Filter for included comparisons only
  const includedComparisonIds = comparisons.filter(c => c.included).map(c => c.id);
  const analysisData = usableData.filter(d => d.comparisonId && includedComparisonIds.includes(d.comparisonId));

  return analysisData;
};

const calculateDescriptiveStats = (values: number[]): DescriptiveStats => {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, count: 0 };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = sum / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean,
    median,
    count: values.length
  };
};

export const generateSummaryResults = (
  data: ProcessedDataRow[],
  comparisons: Comparison[]
): SummaryResults => {
  const usableData = data.filter(d => d.isUsable && !d.excluded);
  const includedComparisonIds = comparisons.filter(c => c.included).map(c => c.id);
  const analysisData = usableData.filter(d => d.comparisonId && includedComparisonIds.includes(d.comparisonId));

  const xas = analysisData.map(d => d.xa).filter((v): v is number => v !== null);
  const apttNews = analysisData.map(d => d.apttNew).filter((v): v is number => v !== null);
  const apttCurrents = analysisData.map(d => d.apttCurrent).filter((v): v is number => v !== null);

  const diffs = analysisData
    .filter(d => d.apttCurrent !== null && d.apttNew !== null)
    .map(d => d.apttCurrent! - d.apttNew!);
  
  const absDiffs = diffs.map(d => Math.abs(d));

  const meanDiff = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
  const medianDiff = diffs.length > 0 ? [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)] : 0;
  const absMeanDiff = absDiffs.length > 0 ? absDiffs.reduce((a, b) => a + b, 0) / absDiffs.length : 0;
  const absMedianDiff = absDiffs.length > 0 ? [...absDiffs].sort((a, b) => a - b)[Math.floor(absDiffs.length / 2)] : 0;
  
  const variance = diffs.length > 1 
    ? diffs.reduce((a, b) => a + Math.pow(b - meanDiff, 2), 0) / (diffs.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);

  return {
    xa: calculateDescriptiveStats(xas),
    apttNew: calculateDescriptiveStats(apttNews),
    apttCurrent: calculateDescriptiveStats(apttCurrents),
    differences: {
      mean: meanDiff,
      median: medianDiff,
      absMean: absMeanDiff,
      absMedian: absMedianDiff,
      stdDev
    },
    qc: {
      censoredCount: analysisData.filter(d => d.flags.some(f => f.includes('Capped'))).length,
      flaggedUsableCount: analysisData.filter(d => d.flags.length > 0).length,
      totalUsable: analysisData.length
    },
    comparisons: comparisons.map(c => ({
      id: c.id,
      label: c.label,
      count: c.rowCount,
      isPrimary: c.isPrimary
    }))
  };
};
