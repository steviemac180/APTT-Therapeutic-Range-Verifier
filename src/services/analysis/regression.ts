import { ProcessedDataRow, Range } from '../../types';

export interface RegressionModel {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  method: 'Weighted Deming' | 'Standard Deming';
  reason?: string;
}

export interface Weight {
  wx: number;
  wy: number;
}

/**
 * Fits a Deming regression model.
 * Supports both weighted and unweighted (standard) Deming.
 */
export const fitDemingRegression = (
  data: ProcessedDataRow[],
  xKey: 'xa',
  yKey: 'apttNew' | 'apttCurrent',
  weights?: Weight[],
  lambda: number = 1.0
): RegressionModel => {
  const validData = data.filter(d => d[xKey] !== null && d[yKey] !== null);
  const n = validData.length;
  
  if (n < 2) {
    return { slope: 0, intercept: 0, r2: 0, n, method: 'Standard Deming', reason: 'Insufficient data' };
  }

  // If weights are provided and valid, use Weighted Deming
  if (weights && weights.length === n) {
    return fitWeightedDeming(validData, xKey, yKey, weights);
  }

  // Fallback to Standard Deming
  return fitStandardDeming(validData, xKey, yKey, lambda);
};

const fitStandardDeming = (
  data: any[],
  xKey: string,
  yKey: string,
  lambda: number
): RegressionModel => {
  const n = data.length;
  const x = data.map(d => d[xKey] as number);
  const y = data.map(d => d[yKey] as number);

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

  if (Math.abs(covXY) < 1e-10) {
    return { slope: 0, intercept: meanY, r2: 0, n, method: 'Standard Deming', reason: 'No correlation detected' };
  }

  const diff = varY - lambda * varX;
  const slope = (diff + Math.sqrt(Math.pow(diff, 2) + 4 * lambda * Math.pow(covXY, 2))) / (2 * covXY);
  const intercept = meanY - slope * meanX;

  const r = covXY / (Math.sqrt(varX) * Math.sqrt(varY));
  const r2 = isNaN(r) ? 0 : r * r;

  return { slope, intercept, r2, n, method: 'Standard Deming' };
};

const fitWeightedDeming = (
  data: any[],
  xKey: string,
  yKey: string,
  weights: Weight[]
): RegressionModel => {
  const n = data.length;
  const x = data.map(d => d[xKey] as number);
  const y = data.map(d => d[yKey] as number);

  // Iterative approach for Weighted Deming (Linnet's method)
  let slope = 1.0; // Initial guess
  let intercept = 0;
  
  const maxIterations = 20;
  const tolerance = 1e-6;

  for (let iter = 0; iter < maxIterations; iter++) {
    const prevSlope = slope;
    
    let sumW = 0;
    let sumWX = 0;
    let sumWY = 0;
    
    const w = weights.map(wt => (wt.wx * wt.wy) / (slope * slope * wt.wy + wt.wx));
    
    for (let i = 0; i < n; i++) {
      sumW += w[i];
      sumWX += w[i] * x[i];
      sumWY += w[i] * y[i];
    }
    
    const meanX = sumWX / sumW;
    const meanY = sumWY / sumW;
    
    let num = 0;
    let den = 0;
    
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += w[i] * dy * dx;
      den += w[i] * dx * dx;
    }
    
    slope = num / den;
    intercept = meanY - slope * meanX;
    
    if (Math.abs(slope - prevSlope) < tolerance) break;
  }

  // Calculate R2 (weighted version)
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * x[i];
    ssRes += Math.pow(y[i] - pred, 2);
    ssTot += Math.pow(y[i] - meanY, 2);
  }
  const r2 = 1 - (ssRes / ssTot);

  return { slope, intercept, r2, n, method: 'Weighted Deming' };
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
