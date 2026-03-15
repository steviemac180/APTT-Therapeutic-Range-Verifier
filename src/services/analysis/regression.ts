import { ProcessedDataRow, Range } from '../../types';

export interface RegressionModel {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

/**
 * Fits an unweighted Deming regression model.
 * Assumes lambda = 1.0 (orthogonal regression) unless specified.
 */
export const fitDemingRegression = (
  data: ProcessedDataRow[],
  xKey: 'xa',
  yKey: 'apttNew' | 'apttCurrent',
  lambda: number = 1.0
): RegressionModel => {
  const validData = data.filter(d => d[xKey] !== null && d[yKey] !== null);
  const n = validData.length;
  
  if (n < 2) {
    return { slope: 0, intercept: 0, r2: 0, n };
  }

  const x = validData.map(d => d[xKey] as number);
  const y = validData.map(d => d[yKey] as number);

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  
  const varX = sxx / (n - 1);
  const varY = syy / (n - 1);
  const covXY = sxy / (n - 1);

  // Handle edge case where covXY is 0 to avoid division by zero
  if (Math.abs(covXY) < 1e-10) {
    // If no correlation, fallback to a simple slope if possible or 0
    return { slope: 0, intercept: meanY, r2: 0, n };
  }

  const diff = varY - lambda * varX;
  const slope = (diff + Math.sqrt(Math.pow(diff, 2) + 4 * lambda * Math.pow(covXY, 2))) / (2 * covXY);
  const intercept = meanY - slope * meanX;

  const r = covXY / (Math.sqrt(varX) * Math.sqrt(varY));
  const r2 = isNaN(r) ? 0 : r * r;

  return { slope, intercept, r2, n };
};

export const predictRange = (
  model: RegressionModel,
  targetRange: Range
): Range => {
  return {
    lower: model.intercept + model.slope * targetRange.lower,
    upper: model.intercept + model.slope * targetRange.upper
  };
};
