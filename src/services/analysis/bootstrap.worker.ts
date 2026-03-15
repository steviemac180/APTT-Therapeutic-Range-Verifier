import { ProcessedDataRow, AnalysisConfig, Range } from '../../types';
import { Weight } from './regression';
import { fitDemingRegression, predictRange } from './regression';
import { calculateSampleWeights } from './muHandler';

interface BootstrapMessage {
  data: ProcessedDataRow[];
  config: AnalysisConfig;
  iterations: number;
}

interface BootstrapResult {
  lowerLimits: number[];
  upperLimits: number[];
  widths: number[];
  lowerShifts: number[];
  upperShifts: number[];
  widthShifts: number[];
}

self.onmessage = (e: MessageEvent<BootstrapMessage>) => {
  const { data, config, iterations } = e.data;
  const n = data.length;
  
  const results: BootstrapResult = {
    lowerLimits: [],
    upperLimits: [],
    widths: [],
    lowerShifts: [],
    upperShifts: [],
    widthShifts: []
  };

  for (let i = 0; i < iterations; i++) {
    // Resample with replacement
    const resampledData: ProcessedDataRow[] = [];
    for (let j = 0; j < n; j++) {
      const randomIndex = Math.floor(Math.random() * n);
      resampledData.push(data[randomIndex]);
    }

    // Calculate weights for resampled data
    const newWeights = resampledData.map(row => calculateSampleWeights(row, config, 'apttNew'));

    // Fit model
    const model = fitDemingRegression(resampledData, 'xa', 'apttNew', newWeights);
    
    // Predict range
    const predictedRaw = predictRange(model, config.therapeuticXaRange);
    
    const lower = predictedRaw.lower;
    const upper = predictedRaw.upper;
    const width = upper - lower;
    
    const lowerShift = Math.round(lower) - config.currentApprovedRange.lower;
    const upperShift = Math.round(upper) - config.currentApprovedRange.upper;
    const widthShift = (Math.round(upper) - Math.round(lower)) - (config.currentApprovedRange.upper - config.currentApprovedRange.lower);

    results.lowerLimits.push(lower);
    results.upperLimits.push(upper);
    results.widths.push(width);
    results.lowerShifts.push(lowerShift);
    results.upperShifts.push(upperShift);
    results.widthShifts.push(widthShift);

    // Progress reporting could be added here if needed
  }

  self.postMessage(results);
};
