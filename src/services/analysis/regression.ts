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

  // Initial guess for slope using unweighted Deming or OLS
  let slope = 1.0;
  let intercept = 0;
  
  const maxIterations = 50;
  const tolerance = 1e-7;

  for (let iter = 0; iter < maxIterations; iter++) {
    const prevSlope = slope;
    
    // Calculate weights W_i = 1 / (var_yi + slope^2 * var_xi)
    // Since weights[i].wx = 1/var_xi and weights[i].wy = 1/var_yi
    // W_i = 1 / (1/wy + slope^2 / wx) = (wx * wy) / (wx + slope^2 * wy)
    const W = weights.map(wt => (wt.wx * wt.wy) / (wt.wx + slope * slope * wt.wy));
    
    const sumW = W.reduce((a, b) => a + b, 0);
    const meanX = W.reduce((a, b, i) => a + b * x[i], 0) / sumW;
    const meanY = W.reduce((a, b, i) => a + b * y[i], 0) / sumW;
    
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      sxx += W[i] * dx * dx;
      syy += W[i] * dy * dy;
      sxy += W[i] * dx * dy;
    }
    
    // Lambda_eff = weighted average lambda? 
    // Actually, for weighted Deming with varying lambda_i, we solve the quadratic:
    // beta^2 * Sxy + beta * (lambda * Sxx - Syy) - lambda * Sxy = 0
    // But here lambda is effectively incorporated into the weights W_i.
    // A common approximation for weighted Deming is to use the weighted sums of squares:
    const lambda = syy / sxx; // This is a rough estimate for the iteration
    
    // Using the Deming formula on weighted sums:
    const diff = syy - sxx; // Assuming lambda=1 for the weighted sums because variances are in W
    
    if (Math.abs(sxy) < 1e-10) {
      slope = syy > sxx ? 1e6 : 0; // Avoid division by zero
    } else {
      slope = (diff + Math.sqrt(diff * diff + 4 * sxy * sxy)) / (2 * sxy);
    }
    
    intercept = meanY - slope * meanX;
    
    if (Math.abs(slope - prevSlope) < tolerance) break;
  }

  // Calculate R2 (weighted)
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

export const fitOLSRegression = (
  data: any[],
  xKey: string,
  yKey: string
): RegressionModel => {
  const n = data.length;
  const x = data.map(d => d[xKey] as number);
  const y = data.map(d => d[yKey] as number);

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - meanX) * (y[i] - meanY);
    den += (x[i] - meanX) * (x[i] - meanX);
  }

  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * x[i];
    ssRes += Math.pow(y[i] - pred, 2);
    ssTot += Math.pow(y[i] - meanY, 2);
  }
  const r2 = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

  return { slope, intercept, r2, n, method: 'OLS' as any };
};

export const fitPassingBablokRegression = (
  data: any[],
  xKey: string,
  yKey: string
): RegressionModel => {
  const n = data.length;
  const x = data.map(d => d[xKey] as number);
  const y = data.map(d => d[yKey] as number);

  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      if (dx !== 0) {
        const s = dy / dx;
        if (s !== -1) {
          slopes.push(s);
        }
      }
    }
  }

  if (slopes.length === 0) {
    return { slope: 1, intercept: 0, r2: 0, n, method: 'Passing-Bablok' as any };
  }

  slopes.sort((a, b) => a - b);
  const slope = slopes.length % 2 === 0
    ? (slopes[slopes.length / 2 - 1] + slopes[slopes.length / 2]) / 2
    : slopes[Math.floor(slopes.length / 2)];

  const intercepts = data.map(d => (d[yKey] as number) - slope * (d[xKey] as number));
  intercepts.sort((a, b) => a - b);
  const intercept = intercepts.length % 2 === 0
    ? (intercepts[intercepts.length / 2 - 1] + intercepts[intercepts.length / 2]) / 2
    : intercepts[Math.floor(intercepts.length / 2)];

  // R2 (approximate for PB)
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * x[i];
    ssRes += Math.pow(y[i] - pred, 2);
    ssTot += Math.pow(y[i] - meanY, 2);
  }
  const r2 = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

  return { slope, intercept, r2, n, method: 'Passing-Bablok' as any };
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
