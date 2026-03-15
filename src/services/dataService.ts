import Papa from 'papaparse';
import { ProcessedDataRow, FileValidationSummary, Comparison } from '../types';

const REQUIRED_COLUMNS = ['Year', 'Xa', 'APTT New Lot', 'APTT Current Lot'];
const OPTIONAL_COLUMNS = [
  'New Lot ID', 
  'Current Lot ID', 
  'Comparison ID', 
  'analyser/platform', 
  'manufacturer', 
  'assay name'
];

export const parseCSV = (file: File): Promise<{ 
  data: ProcessedDataRow[], 
  summary: FileValidationSummary 
}> => {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided'));
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      transformHeader: (header) => header?.trim() || '',
      complete: (results) => {
        try {
          const headers = results.meta.fields || [];
          
          // Map headers to required columns (case-insensitive)
          const findHeader = (target: string) => {
            return headers.find(h => h.toLowerCase() === target.toLowerCase());
          };

          const colMap = {
            year: findHeader('Year'),
            xa: findHeader('Xa'),
            apttNew: findHeader('APTT New Lot') || findHeader('APTT New'),
            apttCurrent: findHeader('APTT Current Lot') || findHeader('APTT Current'),
          };

          const missingRequired = REQUIRED_COLUMNS.filter(col => {
            const target = col.toLowerCase();
            return !headers.some(h => {
              const headerLower = h.toLowerCase();
              if (headerLower === target) return true;
              if (target === 'aptt new lot' && headerLower === 'aptt new') return true;
              if (target === 'aptt current lot' && headerLower === 'aptt current') return true;
              return false;
            });
          });
          
          const hasRequired = missingRequired.length === 0;

          const processedData: ProcessedDataRow[] = (results.data || []).map((row: any, idx: number) => {
            const flags: string[] = [];
            const rawValues: Record<string, string> = {};
            let isExcluded = false;
            let exclusionReason = '';
            
            headers.forEach(h => {
              rawValues[h] = String(row[h] || '');
            });

            const isHeaderDuplicate = colMap.year && String(row[colMap.year]).trim().toLowerCase() === 'year';
            if (isHeaderDuplicate) {
              flags.push('Repeated header row');
              isExcluded = true;
              exclusionReason = 'Repeated header row';
            }
            
            const parseNumeric = (val: any, colName: string, required: boolean) => {
              const strVal = String(val || '').trim();
              if (strVal === '') {
                if (required && !isHeaderDuplicate) {
                  flags.push(`Missing value: ${colName}`);
                  isExcluded = true;
                  exclusionReason = `Missing required value: ${colName}`;
                }
                return null;
              }
              
              // Remove common non-numeric characters but keep decimals and negatives
              const cleanedVal = strVal.replace(/[^\d.-]/g, '');
              const num = parseFloat(cleanedVal);
              
              if (isNaN(num)) {
                if (!isHeaderDuplicate) {
                  flags.push(`Non-numeric value: ${colName}`);
                  isExcluded = true;
                  exclusionReason = `Non-numeric value in required column: ${colName}`;
                }
                return null;
              }
              return num;
            };

            const year = colMap.year ? parseNumeric(row[colMap.year], 'Year', true) : null;
            const xa = colMap.xa ? parseNumeric(row[colMap.xa], 'Xa', true) : null;
            const apttNew = colMap.apttNew ? parseNumeric(row[colMap.apttNew], 'APTT New Lot', true) : null;
            const apttCurrent = colMap.apttCurrent ? parseNumeric(row[colMap.apttCurrent], 'APTT Current Lot', true) : null;

            // Capped/Censored checks (Retained but flagged)
            if (apttNew !== null && apttNew >= 139.0) {
              flags.push('Capped APTT value (>= 139.0)');
            }
            if (apttCurrent !== null && apttCurrent >= 139.0) {
              flags.push('Capped Current APTT value (>= 139.0)');
            }
            if (xa !== null && xa >= 1.50) {
              flags.push('Capped Xa value (>= 1.50)');
            }

            const isUsable = hasRequired && !isExcluded;

            return {
              id: `row-${idx}`,
              year,
              xa,
              apttNew,
              apttCurrent,
              newLotId: row[findHeader('New Lot ID') || ''] || row['New Lot ID'] || '',
              currentLotId: row[findHeader('Current Lot ID') || ''] || row['Current Lot ID'] || '',
              comparisonId: row[findHeader('Comparison ID') || ''] || row['Comparison ID'] || '',
              analyser: row[findHeader('analyser/platform') || ''] || row['analyser/platform'] || '',
              manufacturer: row[findHeader('manufacturer') || ''] || row['manufacturer'] || '',
              assayName: row[findHeader('assay name') || ''] || row['assay name'] || '',
              excluded: isExcluded,
              exclusionReason,
              flags,
              isHeaderDuplicate,
              isUsable,
              rawValues,
            };
          });

          const issueCounts = {
            missingValues: processedData.filter(d => d.flags.some(f => f.startsWith('Missing value'))).length,
            nonNumeric: processedData.filter(d => d.flags.some(f => f.startsWith('Non-numeric value'))).length,
            headerDuplicates: processedData.filter(d => d.isHeaderDuplicate).length,
            cappedValues: processedData.filter(d => d.flags.some(f => f.includes('Capped'))).length,
          };

          const summary: FileValidationSummary = {
            totalRows: processedData.length,
            usableRows: processedData.filter(d => d.isUsable).length,
            flaggedRows: processedData.filter(d => d.flags.length > 0).length,
            excludedRows: processedData.filter(d => d.excluded).length,
            issueCounts,
            missingRequiredColumns: missingRequired,
            detectedColumns: headers,
            hasRequiredColumns: hasRequired,
          };

          resolve({
            data: processedData,
            summary,
          });
        } catch (err) {
          reject(err);
        }
      },
      error: (error) => {
        reject(error);
      }
    });
  });
};

export const validateDataQuality = (data: ProcessedDataRow[]) => {
  const usableData = data.filter(d => d.isUsable);
  const flags: string[] = [];
  
  if (usableData.length < 10) flags.push('Low sample size (n < 10 usable rows)');
  
  const hasCensored = usableData.some(d => (d.apttNew !== null && d.apttNew >= 139) || (d.xa !== null && d.xa >= 1.5));
  if (hasCensored) flags.push('Capped/censored values detected in usable data (APTT >= 139 or Xa >= 1.5)');

  const xas = usableData.map(d => d.xa).filter((v): v is number => v !== null);
  if (xas.length > 0) {
    const xaRange = Math.max(...xas) - Math.min(...xas);
    if (xaRange < 0.4) flags.push('Insufficient anti-Xa spread detected in usable data');
  }

  return flags;
};

export interface ComparisonResult {
  comparisons: Comparison[];
  updatedData: ProcessedDataRow[];
}

export interface ComparisonResult {
  comparisons: Comparison[];
  updatedData: ProcessedDataRow[];
}

export const detectComparisons = (data: ProcessedDataRow[]): ComparisonResult => {
  const updatedData = data.map(row => {
    if (!row.isUsable) return row;
    
    let key = '';
    if (row.comparisonId) {
      key = `cid:${row.comparisonId}`;
    } else {
      // Fallback detection: Year + optional Lot IDs
      key = `auto:${row.year || 'unknown'}-${row.newLotId || 'no-new'}-${row.currentLotId || 'no-current'}`;
    }
    
    return { ...row, comparisonId: key };
  });

  const comparisons = getComparisonsSummary(updatedData);
  return { comparisons, updatedData };
};

export const getComparisonsSummary = (data: ProcessedDataRow[]): Comparison[] => {
  const usableData = data.filter(d => d.isUsable);
  const groups: Record<string, ProcessedDataRow[]> = {};

  usableData.forEach(row => {
    const key = row.comparisonId || 'unassigned';
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });

  return Object.entries(groups).map(([key, rows]) => {
    const first = rows[0];
    const isAuto = key.startsWith('auto:');
    
    const year = first.year;
    const sameYearGroups = Object.keys(groups).filter(k => {
      const g = groups[k][0];
      return g.year === year;
    });
    
    const isTrulyAuto = isAuto && sameYearGroups.length === 1;

    return {
      id: key,
      label: first.comparisonId?.startsWith('auto:') || first.comparisonId === 'unassigned' 
        ? `Comparison ${year || 'Unknown'}` 
        : first.comparisonId?.replace('cid:', '') || 'Unassigned',
      year: year,
      newLotId: first.newLotId,
      currentLotId: first.currentLotId,
      rowCount: rows.length,
      flagCount: rows.filter(r => r.flags.length > 0).length,
      isAutoAssigned: isTrulyAuto,
      included: true,
      isPrimary: false,
      exclusionReason: ''
    };
  });
};
