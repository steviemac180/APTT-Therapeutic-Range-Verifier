import { ProcessedDataRow, RawDataRow } from '../types';

export const parseCSV = (csvText: string): ProcessedDataRow[] => {
  // Simple manual parser for now to avoid heavy dependency issues in first turn
  // In a real app we'd use PapaParse more extensively
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1);

  return rows.map((row, idx) => {
    const values = row.split(',').map(v => v.trim());
    const data: any = {};
    headers.forEach((h, i) => {
      data[h] = values[i];
    });

    return {
      id: `row-${idx}`,
      year: parseInt(data['Year']) || 0,
      xa: parseFloat(data['Xa']) || 0,
      apttNew: parseFloat(data['APTT New Lot']) || 0,
      apttCurrent: parseFloat(data['APTT Current Lot']) || 0,
      newLotId: data['New Lot ID'],
      currentLotId: data['Current Lot ID'],
      comparisonId: data['Comparison ID'],
      excluded: false,
    };
  });
};

export const validateData = (data: ProcessedDataRow[]) => {
  const flags: string[] = [];
  if (data.length < 10) flags.push('Low sample size (n < 10)');
  
  const hasCensored = data.some(d => d.apttNew >= 139 || d.xa >= 1.5);
  if (hasCensored) flags.push('Capped/censored values detected (APTT >= 139 or Xa >= 1.5)');

  const xaRange = Math.max(...data.map(d => d.xa)) - Math.min(...data.map(d => d.xa));
  if (xaRange < 0.4) flags.push('Insufficient anti-Xa spread detected');

  return flags;
};
