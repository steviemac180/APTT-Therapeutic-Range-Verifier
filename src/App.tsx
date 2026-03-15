/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  FileText, 
  Upload, 
  Settings, 
  BarChart3, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle,
  ChevronRight, 
  ChevronLeft,
  Play,
  Download,
  Info,
  History,
  FlaskConical,
  Beaker,
  Search,
  Plus,
  Trash2,
  Save,
  TrendingUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { 
  ProcessedDataRow, 
  AnalysisConfig, 
  AnalysisResults, 
  LabConfig,
  FileValidationSummary,
  Range,
  Comparison,
  SetupStep
} from './types';
import { 
  DEFAULT_XA_RANGE, 
  DEFAULT_APTT_RANGE, 
  DEFAULT_MU_BANDS,
  DEFAULT_RISK_WEIGHTS 
} from './constants';
import { parseCSV, validateDataQuality, detectComparisons, getComparisonsSummary } from './services/dataService';
import { runAnalysis } from './services/statsService';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type AppState = 'setup' | 'dashboard';

export default function App() {
  const [appState, setAppState] = useState<AppState>('setup');
  const [setupStep, setSetupStep] = useState<SetupStep>('upload');
  
  // Data State
  const [rawData, setRawData] = useState<ProcessedDataRow[]>([]);
  const [fileSummary, setFileSummary] = useState<FileValidationSummary | null>(null);
  const [dataFlags, setDataFlags] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isManualMode, setIsManualMode] = useState(false);
  const [newComparisonLabel, setNewComparisonLabel] = useState('');
  const [comparisonSettings, setComparisonSettings] = useState<Record<string, { included: boolean, isPrimary: boolean, exclusionReason: string }>>({});
  
  const comparisons = useMemo(() => {
    const base = getComparisonsSummary(rawData);
    
    // Merge with settings and handle auto-primary
    const merged = base.map(c => {
      const settings = comparisonSettings[c.id] || { 
        included: true, 
        isPrimary: base.length === 1, 
        exclusionReason: '' 
      };
      return { ...c, ...settings };
    });

    // Ensure exactly one primary if there are included comparisons and none is primary
    const included = merged.filter(c => c.included);
    if (included.length > 0 && !included.some(c => c.isPrimary)) {
      const firstIncluded = merged.find(c => c.included);
      if (firstIncluded) firstIncluded.isPrimary = true;
    }

    return merged;
  }, [rawData, comparisonSettings]);
  
  // Config State
  const [labConfig, setLabConfig] = useState<LabConfig>({
    labName: '',
    organisation: '',
    reportTitle: 'APTT Lot Verification Report',
    analyser: '',
    manufacturer: '',
    assayName: ''
  });

  const [analysisConfig, setAnalysisConfig] = useState<AnalysisConfig>({
    currentApprovedRange: DEFAULT_APTT_RANGE,
    therapeuticXaRange: DEFAULT_XA_RANGE,
    muBands: DEFAULT_MU_BANDS(DEFAULT_XA_RANGE, DEFAULT_APTT_RANGE),
    analysisDepth: 'Standard',
    riskWeights: DEFAULT_RISK_WEIGHTS
  });

  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Handlers
  const updateComparisonLabel = (id: string, label: string) => {
    const newId = `cid:${label}`;
    setRawData(prev => prev.map(row => 
      row.comparisonId === id ? { ...row, comparisonId: newId } : row
    ));
    // Move settings to new ID
    setComparisonSettings(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      next[newId] = next[id];
      delete next[id];
      return next;
    });
  };

  const toggleComparisonInclusion = (id: string) => {
    setComparisonSettings(prev => {
      const current = prev[id] || { included: true, isPrimary: false, exclusionReason: '' };
      const nextIncluded = !current.included;
      return {
        ...prev,
        [id]: { ...current, included: nextIncluded, isPrimary: nextIncluded ? current.isPrimary : false }
      };
    });
  };

  const setPrimaryComparison = (id: string) => {
    setComparisonSettings(prev => {
      const next: Record<string, { included: boolean, isPrimary: boolean, exclusionReason: string }> = {};
      
      // Initialize next with existing settings or defaults for all current comparisons
      comparisons.forEach(c => {
        next[c.id] = prev[c.id] || { included: true, isPrimary: false, exclusionReason: '' };
      });

      // Unset all others
      Object.keys(next).forEach(key => {
        next[key] = { ...next[key], isPrimary: false };
      });
      
      // Set this one
      const current = next[id] || { included: true, isPrimary: false, exclusionReason: '' };
      next[id] = { ...current, isPrimary: true, included: true };
      return next;
    });
  };

  const updateExclusionReason = (id: string, reason: string) => {
    setComparisonSettings(prev => ({
      ...prev,
      [id]: { ...(prev[id] || { included: true, isPrimary: false, exclusionReason: '' }), exclusionReason: reason }
    }));
  };

  const canContinueToConfig = useMemo(() => {
    const included = comparisons.filter(c => c.included);
    if (included.length === 0) return false;
    if (!included.some(c => c.isPrimary)) return false;
    
    // Check exclusion reasons
    const excluded = comparisons.filter(c => !c.included);
    if (excluded.some(c => !c.exclusionReason?.trim())) return false;
    
    return true;
  }, [comparisons]);

  const reassignRows = (comparisonId: string) => {
    setRawData(prev => prev.map(row => 
      selectedRows.includes(row.id) ? { ...row, comparisonId } : row
    ));
    setSelectedRows([]);
  };

  const createAndAssignRows = (label: string) => {
    const newId = `cid:${label}`;
    reassignRows(newId);
  };
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Basic visual feedback
    setIsAnalyzing(true);

    try {
      const { data, summary } = await parseCSV(file);
      
      const qualityFlags = validateDataQuality(data);
      setDataFlags(qualityFlags);

      const { updatedData } = detectComparisons(data);
      setRawData(updatedData);
      setFileSummary(summary);
      
      // Auto-populate metadata if found
      if (data.length > 0) {
        const firstRow = data[0];
        setLabConfig(prev => ({
          ...prev,
          analyser: firstRow.analyser || prev.analyser,
          manufacturer: firstRow.manufacturer || prev.manufacturer,
          assayName: firstRow.assayName || prev.assayName,
        }));
      }
    } catch (error) {
      console.error('File upload failed:', error);
      alert('Failed to parse CSV file. Please ensure it is a valid CSV.');
    } finally {
      setIsAnalyzing(false);
      // Clear input so same file can be uploaded again
      e.target.value = '';
    }
  };

  const startDemo = () => {
    // Mock demo data
    const demoData: ProcessedDataRow[] = Array.from({ length: 40 }, (_, i) => {
      const isCapped = i > 35;
      const flags = isCapped ? ['Capped APTT value (>= 139.0)'] : [];
      return {
        id: `demo-${i}`,
        year: 2025,
        xa: 0.1 + Math.random() * 1.2,
        apttCurrent: 40 + (i * 2) + Math.random() * 5,
        apttNew: isCapped ? 140 : 42 + (i * 2.1) + Math.random() * 5,
        excluded: false,
        flags: flags,
        isHeaderDuplicate: false,
        isUsable: true,
        rawValues: {}
      };
    });
    setRawData(demoData);
    const { comparisons: detected, updatedData } = detectComparisons(demoData);
    setRawData(updatedData);
    setFileSummary({
      totalRows: 40,
      usableRows: 40,
      flaggedRows: 4,
      excludedRows: 0,
      issueCounts: {
        missingValues: 0,
        nonNumeric: 0,
        headerDuplicates: 0,
        cappedValues: 4
      },
      missingRequiredColumns: [],
      detectedColumns: ['Year', 'Xa', 'APTT New Lot', 'APTT Current Lot'],
      hasRequiredColumns: true
    });
    setSetupStep('config');
  };

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const primaryComp = comparisons.find(c => c.isPrimary);
    const analysisData = rawData.filter(d => d.comparisonId === primaryComp?.id);
    
    const res = await runAnalysis(analysisData, analysisConfig);
    setResults(res);
    setIsAnalyzing(false);
    setAppState('dashboard');
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#141414] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="bg-white border-b border-black/5 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-sm shadow-emerald-200">
            <FlaskConical size={24} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">APTT Therapeutic Range Verifier</h1>
            <p className="text-xs text-black/40 font-medium uppercase tracking-wider">Specialist Haemostasis Decision Support</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {appState === 'dashboard' && (
            <button 
              onClick={() => setAppState('setup')}
              className="text-sm font-medium text-black/60 hover:text-black transition-colors flex items-center gap-2"
            >
              <Settings size={16} />
              New Analysis
            </button>
          )}
          <div className="h-4 w-px bg-black/10" />
          <div className="text-right">
            <p className="text-xs font-semibold text-black/80">{labConfig.labName || 'Guest Laboratory'}</p>
            <p className="text-[10px] text-black/40 uppercase tracking-tighter">v1.0.0 Scaffold</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 lg:p-10">
        <AnimatePresence mode="wait">
          {appState === 'setup' ? (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-3xl mx-auto"
            >
              {/* Wizard Progress */}
              <div className="mb-12 flex justify-between relative">
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-black/5 -translate-y-1/2 z-0" />
                {(['upload', 'comparison', 'config', 'mu', 'review'] as SetupStep[]).map((step, idx) => {
                  const steps: SetupStep[] = ['upload', 'comparison', 'config', 'mu', 'review'];
                  const isPast = steps.indexOf(setupStep) > idx;
                  const isCurrent = setupStep === step;
                  return (
                    <div key={step} className="relative z-10 flex flex-col items-center gap-2">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300",
                        isCurrent ? "bg-emerald-600 text-white scale-110 shadow-lg shadow-emerald-200" : 
                        isPast ? "bg-emerald-100 text-emerald-700" : "bg-white border border-black/10 text-black/30"
                      )}>
                        {isPast ? <CheckCircle2 size={16} /> : idx + 1}
                      </div>
                      <span className={cn(
                        "text-[10px] uppercase tracking-widest font-bold",
                        isCurrent ? "text-emerald-700" : "text-black/30"
                      )}>{step === 'mu' ? 'uncertainty' : step}</span>
                    </div>
                  );
                })}
              </div>

              {/* Wizard Content */}
              <div className="bg-white rounded-3xl p-8 lg:p-12 shadow-sm border border-black/5 min-h-[400px] flex flex-col">
                {setupStep === 'upload' && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
                    <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-6">
                      <Upload size={40} />
                    </div>
                    <h2 className="text-2xl font-semibold mb-2">Upload Verification Data</h2>
                    <p className="text-black/50 max-w-md mb-8">
                      Select a CSV file containing Year, Xa, APTT New Lot, and APTT Current Lot columns.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
                      <label className={cn(
                        "flex-1 cursor-pointer text-white font-semibold py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-100",
                        isAnalyzing ? "bg-emerald-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700"
                      )}>
                        {isAnalyzing ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                        ) : (
                          <Upload size={20} />
                        )}
                        {isAnalyzing ? 'Processing...' : 'Choose CSV File'}
                        <input 
                          type="file" 
                          accept=".csv" 
                          className="hidden" 
                          onChange={handleFileUpload} 
                          disabled={isAnalyzing}
                        />
                      </label>
                      <div className="flex-1 flex flex-col gap-2">
                        <button 
                          onClick={startDemo}
                          className="w-full bg-white border border-black/10 hover:border-black/20 text-black font-semibold py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2"
                        >
                          <Play size={20} />
                          Try Demo Mode
                        </button>
                        <select 
                          className="w-full text-[10px] uppercase font-bold tracking-widest text-black/40 bg-transparent border-none focus:ring-0 text-center"
                          onChange={(e) => {
                            // In a real app, this would set a scenario flag
                            startDemo();
                          }}
                        >
                          <option>Scenario: No Change</option>
                          <option>Scenario: Minor Change</option>
                          <option>Scenario: Major Change</option>
                          <option>Scenario: Review Required</option>
                        </select>
                      </div>
                    </div>
                    
                    <div className="mt-12 p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3 text-left max-w-md">
                      <Info className="text-amber-600 shrink-0" size={20} />
                      <p className="text-xs text-amber-800 leading-relaxed">
                        <strong>Privacy Notice:</strong> All data processing occurs locally in your browser. No data is uploaded to any server or stored permanently.
                      </p>
                    </div>

                    {/* File Summary & Preview */}
                    {fileSummary && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full mt-12 space-y-8"
                      >
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                            <div className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Total Rows</div>
                            <div className="text-2xl font-semibold text-black/80">{fileSummary.totalRows}</div>
                          </div>
                          <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                            <div className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Usable Rows</div>
                            <div className="text-2xl font-semibold text-emerald-600">{fileSummary.usableRows}</div>
                          </div>
                          <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                            <div className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Excluded Rows</div>
                            <div className="text-2xl font-semibold text-red-600">{fileSummary.excludedRows}</div>
                          </div>
                          <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                            <div className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Flagged (Retained)</div>
                            <div className="text-2xl font-semibold text-amber-600">{fileSummary.flaggedRows - fileSummary.excludedRows}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="bg-black/5 rounded-2xl p-6">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-black/40 mb-4">QC Issue Breakdown</h4>
                            <div className="space-y-3">
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-black/60">Missing Values</span>
                                <span className={cn("text-xs font-bold", fileSummary.issueCounts.missingValues > 0 ? "text-red-600" : "text-black/30")}>
                                  {fileSummary.issueCounts.missingValues}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-black/60">Non-numeric Data</span>
                                <span className={cn("text-xs font-bold", fileSummary.issueCounts.nonNumeric > 0 ? "text-red-600" : "text-black/30")}>
                                  {fileSummary.issueCounts.nonNumeric}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-black/60">Header Duplicates</span>
                                <span className={cn("text-xs font-bold", fileSummary.issueCounts.headerDuplicates > 0 ? "text-red-600" : "text-black/30")}>
                                  {fileSummary.issueCounts.headerDuplicates}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-black/60">Capped/Censored Values</span>
                                <span className={cn("text-xs font-bold", fileSummary.issueCounts.cappedValues > 0 ? "text-amber-600" : "text-black/30")}>
                                  {fileSummary.issueCounts.cappedValues}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-6">
                            <div className="flex gap-3 mb-3">
                              <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 shrink-0">
                                <Info size={16} />
                              </div>
                              <h4 className="text-xs font-bold uppercase tracking-widest text-amber-800 self-center">About Capped Values</h4>
                            </div>
                            <p className="text-xs text-amber-900/70 leading-relaxed">
                              Capped or censored values occur when a result exceeds the laboratory's validated measuring range (e.g., APTT &gt; 139s or Xa &gt; 1.5 IU/mL). 
                              These are flagged because they represent "at least" that value, which can skew statistical correlations. They are retained for now but should be reviewed.
                            </p>
                          </div>
                        </div>

                        <div className="bg-black/5 rounded-2xl p-6">
                          <h4 className="text-xs font-bold uppercase tracking-widest text-black/40 mb-4">Column Detection</h4>
                          <div className="flex flex-wrap gap-2">
                            {fileSummary.detectedColumns.map(col => (
                              <span key={col} className="px-3 py-1.5 bg-white border border-black/5 rounded-xl text-xs font-bold text-black/60">
                                {col}
                              </span>
                            ))}
                            {fileSummary.missingRequiredColumns.map(col => (
                              <span key={col} className="px-3 py-1.5 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600 flex items-center gap-1.5">
                                <AlertCircle size={14} /> Missing: {col}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                          <div className="px-6 py-4 border-b border-black/5 bg-black/[0.02] flex justify-between items-center">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-black/40">Data Preview (First 20 Rows)</h4>
                            <span className="text-[10px] text-black/30 italic">Flagged rows highlighted in amber</span>
                          </div>
                          <div className="overflow-x-auto max-h-[400px]">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-black/[0.02] sticky top-0 border-b border-black/5">
                                  <tr>
                                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Status</th>
                                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Year</th>
                                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Xa</th>
                                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">New Lot</th>
                                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Current Lot</th>
                                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Flags</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-black/5">
                                  {rawData.slice(0, 20).map((row, idx) => (
                                    <tr key={idx} className={cn(
                                      "transition-colors",
                                      row.excluded ? "bg-red-50/30 opacity-60" : row.isUsable ? "hover:bg-black/[0.01]" : "bg-amber-50/50"
                                    )}>
                                      <td className="px-6 py-3">
                                        {row.excluded ? (
                                          <span className="text-[9px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded-md font-bold uppercase tracking-tighter">Excluded</span>
                                        ) : row.isUsable ? (
                                          <span className="text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-md font-bold uppercase tracking-tighter">Usable</span>
                                        ) : (
                                          <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-md font-bold uppercase tracking-tighter">Flagged</span>
                                        )}
                                      </td>
                                      <td className="px-6 py-3 text-black/60 font-mono text-xs">{row.year || '-'}</td>
                                      <td className="px-6 py-3 text-black font-semibold">{row.xa ?? '-'}</td>
                                      <td className="px-6 py-3 text-black">{row.apttNew ?? '-'}</td>
                                      <td className="px-6 py-3 text-black">{row.apttCurrent ?? '-'}</td>
                                      <td className="px-6 py-3">
                                        {row.flags.length > 0 ? (
                                          <div className="flex flex-wrap gap-1">
                                            {row.flags.map((f, i) => (
                                              <span key={i} className={cn(
                                                "text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-tighter",
                                                row.excluded ? "bg-red-50 text-red-600" : "bg-amber-100 text-amber-700"
                                              )}>
                                                {f}
                                              </span>
                                            ))}
                                          </div>
                                        ) : (
                                          <CheckCircle2 size={14} className="text-emerald-500" />
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="flex justify-center pt-4">
                          <button
                            onClick={() => setSetupStep('comparison')}
                            disabled={!fileSummary.hasRequiredColumns || fileSummary.usableRows === 0}
                            className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold transition-all hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-emerald-100"
                          >
                            Continue to Comparison Review
                            <ChevronRight size={20} />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}

                {setupStep === 'comparison' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                  >
                    <div className="flex justify-between items-end">
                      <div>
                        <h2 className="text-2xl font-semibold mb-2">Comparison Review</h2>
                        <p className="text-sm text-black/50">Verify detected comparisons and assign labels.</p>
                      </div>
                      <button 
                        onClick={() => setIsManualMode(!isManualMode)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
                          isManualMode ? "bg-black text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
                        )}
                      >
                        <Settings size={14} />
                        {isManualMode ? "Exit Manual Mode" : "Manual Assignment"}
                      </button>
                    </div>

                    {isManualMode ? (
                      <div className="space-y-6">
                        <div className="bg-black/5 rounded-2xl p-6 flex flex-wrap items-center gap-4">
                          <div className="flex-1 min-w-[200px]">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2">
                              {selectedRows.length} rows selected
                            </p>
                            <div className="flex gap-2">
                              <select 
                                onChange={(e) => reassignRows(e.target.value)}
                                className="flex-1 bg-white border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                defaultValue=""
                              >
                                <option value="" disabled>Assign to existing...</option>
                                {comparisons.map(c => (
                                  <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                              </select>
                              <div className="flex gap-2 flex-1">
                                <input 
                                  type="text"
                                  placeholder="New label..."
                                  value={newComparisonLabel}
                                  onChange={(e) => setNewComparisonLabel(e.target.value)}
                                  className="flex-1 bg-white border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                                <button 
                                  onClick={() => {
                                    if (newComparisonLabel) {
                                      createAndAssignRows(newComparisonLabel);
                                      setNewComparisonLabel('');
                                    }
                                  }}
                                  disabled={!newComparisonLabel || selectedRows.length === 0}
                                  className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  Create
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                          <div className="overflow-x-auto max-h-[500px]">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-black/[0.02] sticky top-0 border-b border-black/5 z-10">
                                <tr>
                                  <th className="px-6 py-3 w-10">
                                    <input 
                                      type="checkbox" 
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedRows(rawData.filter(r => r.isUsable).map(r => r.id));
                                        } else {
                                          setSelectedRows([]);
                                        }
                                      }}
                                      checked={selectedRows.length === rawData.filter(r => r.isUsable).length && selectedRows.length > 0}
                                    />
                                  </th>
                                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Current Assignment</th>
                                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Year</th>
                                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Lot IDs</th>
                                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Xa</th>
                                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">APTT New</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-black/5">
                                {rawData.filter(r => r.isUsable).map((row) => (
                                  <tr key={row.id} className={cn(
                                    "hover:bg-black/[0.01] transition-colors",
                                    selectedRows.includes(row.id) && "bg-emerald-50/50"
                                  )}>
                                    <td className="px-6 py-3">
                                      <input 
                                        type="checkbox" 
                                        checked={selectedRows.includes(row.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedRows([...selectedRows, row.id]);
                                          } else {
                                            setSelectedRows(selectedRows.filter(id => id !== row.id));
                                          }
                                        }}
                                      />
                                    </td>
                                    <td className="px-6 py-3">
                                      <span className="text-xs font-medium text-black/80">
                                        {comparisons.find(c => c.id === row.comparisonId)?.label || "Unassigned"}
                                      </span>
                                    </td>
                                    <td className="px-6 py-3 text-black/60 font-mono text-xs">{row.year}</td>
                                    <td className="px-6 py-3 text-black/60 text-xs">
                                      {row.newLotId || '-'} / {row.currentLotId || '-'}
                                    </td>
                                    <td className="px-6 py-3 font-semibold">{row.xa}</td>
                                    <td className="px-6 py-3">{row.apttNew}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {comparisons.some(c => c.isAutoAssigned) && (
                          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-3 text-emerald-800">
                            <CheckCircle2 size={20} className="text-emerald-500" />
                            <span className="text-xs font-medium">One comparison per year was automatically detected and assigned.</span>
                          </div>
                        )}

                        <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-black/[0.02] border-b border-black/5">
                              <tr>
                                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Inc.</th>
                                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Pri.</th>
                                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Label</th>
                                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Year</th>
                                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40">Lot IDs</th>
                                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Rows</th>
                                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Flags</th>
                                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black/40 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-black/5">
                              {comparisons.map((comp) => (
                                <tr key={comp.id} className={cn(
                                  "hover:bg-black/[0.01] transition-colors",
                                  !comp.included && "opacity-60 bg-black/[0.02]",
                                  comp.isPrimary && "bg-emerald-50/30"
                                )}>
                                  <td className="px-4 py-4 text-center">
                                    <input 
                                      type="checkbox" 
                                      checked={comp.included}
                                      onChange={() => toggleComparisonInclusion(comp.id)}
                                      className="rounded border-black/10 text-emerald-600 focus:ring-emerald-500"
                                    />
                                  </td>
                                  <td className="px-4 py-4 text-center">
                                    <input 
                                      type="radio" 
                                      name="primary-comparison"
                                      checked={comp.isPrimary}
                                      disabled={!comp.included}
                                      onChange={() => setPrimaryComparison(comp.id)}
                                      className="text-emerald-600 focus:ring-emerald-500"
                                    />
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="space-y-1">
                                      <input 
                                        type="text"
                                        value={comp.label}
                                        onChange={(e) => updateComparisonLabel(comp.id, e.target.value)}
                                        className={cn(
                                          "bg-transparent border-b border-transparent hover:border-black/10 focus:border-emerald-500 focus:outline-none font-semibold text-black/80 w-full",
                                          !comp.included && "line-through text-black/40"
                                        )}
                                      />
                                      {!comp.included && (
                                        <input 
                                          type="text"
                                          placeholder="Reason for exclusion..."
                                          value={comp.exclusionReason}
                                          onChange={(e) => updateExclusionReason(comp.id, e.target.value)}
                                          className="w-full text-[10px] bg-white border border-red-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-500 text-red-700"
                                        />
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-black/60 font-mono text-xs">{comp.year || '-'}</td>
                                  <td className="px-6 py-4 text-black/60 text-xs">
                                    {comp.newLotId || 'N/A'} / {comp.currentLotId || 'N/A'}
                                  </td>
                                  <td className="px-6 py-4 text-center font-bold text-black/80">{comp.rowCount}</td>
                                  <td className="px-6 py-4 text-center">
                                    <span className={cn(
                                      "px-2 py-0.5 rounded-full text-[10px] font-bold",
                                      comp.flagCount > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                                    )}>
                                      {comp.flagCount}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <button 
                                      onClick={() => {
                                        setIsManualMode(true);
                                        setSelectedRows(rawData.filter(r => r.comparisonId === comp.id).map(r => r.id));
                                      }}
                                      className="text-black/40 hover:text-black/80 transition-colors"
                                    >
                                      <Settings size={16} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}

                    <div className="flex justify-between items-center pt-4">
                      <button
                        onClick={() => setSetupStep('upload')}
                        className="px-6 py-3 border border-black/10 text-black/60 rounded-2xl font-bold transition-all hover:bg-black/5 flex items-center gap-2"
                      >
                        <ChevronLeft size={20} />
                        Back to QC
                      </button>
                      <button
                        onClick={() => setSetupStep('config')}
                        disabled={!canContinueToConfig}
                        className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold transition-all hover:bg-emerald-700 flex items-center gap-2 shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Continue to Configuration
                        <ChevronRight size={20} />
                      </button>
                    </div>
                  </motion.div>
                )}

                {setupStep === 'config' && (
                  <div className="space-y-8">
                    <div>
                      <h2 className="text-2xl font-semibold mb-2">Reference Ranges</h2>
                      <p className="text-sm text-black/50">Define the current approved therapeutic boundaries.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">Current APTT Range (sec)</h3>
                        <div className="flex gap-4">
                          <div className="flex-1">
                            <label className="text-[10px] uppercase font-bold text-black/40 mb-1 block">Lower Limit</label>
                            <input 
                              type="number" 
                              value={analysisConfig.currentApprovedRange.lower}
                              onChange={(e) => setAnalysisConfig({
                                ...analysisConfig,
                                currentApprovedRange: { ...analysisConfig.currentApprovedRange, lower: parseFloat(e.target.value) }
                              })}
                              className="w-full bg-[#F5F5F4] border-none rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 transition-all"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] uppercase font-bold text-black/40 mb-1 block">Upper Limit</label>
                            <input 
                              type="number" 
                              value={analysisConfig.currentApprovedRange.upper}
                              onChange={(e) => setAnalysisConfig({
                                ...analysisConfig,
                                currentApprovedRange: { ...analysisConfig.currentApprovedRange, upper: parseFloat(e.target.value) }
                              })}
                              className="w-full bg-[#F5F5F4] border-none rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 transition-all"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">Therapeutic anti-Xa Range</h3>
                        <div className="flex gap-4">
                          <div className="flex-1">
                            <label className="text-[10px] uppercase font-bold text-black/40 mb-1 block">Lower Limit</label>
                            <input 
                              type="number" 
                              step="0.01"
                              value={analysisConfig.therapeuticXaRange.lower}
                              onChange={(e) => setAnalysisConfig({
                                ...analysisConfig,
                                therapeuticXaRange: { ...analysisConfig.therapeuticXaRange, lower: parseFloat(e.target.value) }
                              })}
                              className="w-full bg-[#F5F5F4] border-none rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 transition-all"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] uppercase font-bold text-black/40 mb-1 block">Upper Limit</label>
                            <input 
                              type="number" 
                              step="0.01"
                              value={analysisConfig.therapeuticXaRange.upper}
                              onChange={(e) => setAnalysisConfig({
                                ...analysisConfig,
                                therapeuticXaRange: { ...analysisConfig.therapeuticXaRange, upper: parseFloat(e.target.value) }
                              })}
                              className="w-full bg-[#F5F5F4] border-none rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 transition-all"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-8 border-t border-black/5 flex justify-between">
                      <button 
                        onClick={() => setSetupStep('upload')}
                        className="text-sm font-semibold text-black/40 hover:text-black flex items-center gap-2"
                      >
                        <ChevronLeft size={20} /> Back
                      </button>
                      <button 
                        onClick={() => setSetupStep('mu')}
                        className="bg-black text-white font-semibold py-3 px-8 rounded-2xl hover:bg-black/80 transition-all flex items-center gap-2"
                      >
                        Next Step <ChevronRight size={20} />
                      </button>
                    </div>
                  </div>
                )}

                {setupStep === 'mu' && (
                  <div className="space-y-8">
                    <div>
                      <h2 className="text-2xl font-semibold mb-2">Measurement Uncertainty</h2>
                      <p className="text-sm text-black/50">Define banded MU values for anti-Xa and APTT lots.</p>
                    </div>

                    <div className="space-y-6">
                      <div className="p-6 bg-emerald-50/50 rounded-2xl border border-emerald-100">
                        <div className="flex items-center gap-2 mb-4">
                          <Beaker size={18} className="text-emerald-600" />
                          <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-800">anti-Xa MU Bands</h3>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          {analysisConfig.muBands.xa.map((band, i) => (
                            <div key={i} className="bg-white p-3 rounded-xl border border-black/5">
                              <p className="text-[10px] font-bold text-black/40 mb-2 uppercase tracking-tighter">
                                {band.lowerBound} – {band.upperBound} IU/mL
                              </p>
                              <div className="flex items-center gap-2">
                                <input 
                                  type="number" 
                                  value={band.value}
                                  className="w-full text-sm font-semibold bg-transparent border-none p-0 focus:ring-0"
                                />
                                <span className="text-[10px] font-bold text-black/30">{band.unit}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="p-6 bg-blue-50/50 rounded-2xl border border-blue-100">
                          <h3 className="text-sm font-bold uppercase tracking-widest text-blue-800 mb-4">APTT Current Lot MU</h3>
                          <div className="space-y-3">
                            {analysisConfig.muBands.apttCurrent.map((band, i) => (
                              <div key={i} className="flex items-center justify-between bg-white p-3 rounded-xl border border-black/5">
                                <span className="text-[10px] font-bold text-black/40 uppercase">{i === 0 ? 'Low' : i === 1 ? 'Therapeutic' : 'High'}</span>
                                <div className="flex items-center gap-2">
                                  <input type="number" value={band.value} className="w-12 text-right text-sm font-semibold bg-transparent border-none p-0 focus:ring-0" />
                                  <span className="text-[10px] font-bold text-black/30">{band.unit}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="p-6 bg-purple-50/50 rounded-2xl border border-purple-100">
                          <h3 className="text-sm font-bold uppercase tracking-widest text-purple-800 mb-4">APTT New Lot MU</h3>
                          <div className="space-y-3">
                            {analysisConfig.muBands.apttNew.map((band, i) => (
                              <div key={i} className="flex items-center justify-between bg-white p-3 rounded-xl border border-black/5">
                                <span className="text-[10px] font-bold text-black/40 uppercase">{i === 0 ? 'Low' : i === 1 ? 'Therapeutic' : 'High'}</span>
                                <div className="flex items-center gap-2">
                                  <input type="number" value={band.value} className="w-12 text-right text-sm font-semibold bg-transparent border-none p-0 focus:ring-0" />
                                  <span className="text-[10px] font-bold text-black/30">{band.unit}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-8 border-t border-black/5 flex justify-between">
                      <button 
                        onClick={() => setSetupStep('config')}
                        className="text-sm font-semibold text-black/40 hover:text-black flex items-center gap-2"
                      >
                        <ChevronLeft size={20} /> Back
                      </button>
                      <button 
                        onClick={() => setSetupStep('review')}
                        className="bg-black text-white font-semibold py-3 px-8 rounded-2xl hover:bg-black/80 transition-all flex items-center gap-2"
                      >
                        Next Step <ChevronRight size={20} />
                      </button>
                    </div>
                  </div>
                )}

                {setupStep === 'review' && (
                  <div className="space-y-8">
                    <div>
                      <h2 className="text-2xl font-semibold mb-2">Data Quality Review</h2>
                      <p className="text-sm text-black/50">Verify the dataset and address any flags before running analysis.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-[#F5F5F4] p-6 rounded-2xl border border-black/5">
                        <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Total Points</p>
                        <p className="text-3xl font-semibold">{rawData.length}</p>
                      </div>
                      <div className="bg-[#F5F5F4] p-6 rounded-2xl border border-black/5">
                        <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Active Comparisons</p>
                        <p className="text-3xl font-semibold">{comparisons.filter(c => c.included).length}</p>
                      </div>
                      <div className="bg-[#F5F5F4] p-6 rounded-2xl border border-black/5">
                        <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Quality Status</p>
                        <div className="flex items-center gap-2 mt-1">
                          {dataFlags.length === 0 ? (
                            <span className="text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle2 size={16} /> Optimal</span>
                          ) : (
                            <span className="text-amber-600 font-semibold flex items-center gap-1"><AlertTriangle size={16} /> {dataFlags.length} Flags</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {dataFlags.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">Quality Flags</h3>
                        {dataFlags.map((flag, i) => (
                          <div key={i} className="bg-amber-50 p-4 rounded-xl border border-amber-100 flex items-center gap-3 text-amber-900 text-sm">
                            <AlertTriangle size={18} className="shrink-0" />
                            {flag}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="pt-8 border-t border-black/5 flex justify-between">
                      <button 
                        onClick={() => setSetupStep('mu')}
                        className="text-sm font-semibold text-black/40 hover:text-black flex items-center gap-2"
                      >
                        <ChevronLeft size={20} /> Back
                      </button>
                      <button 
                        onClick={handleRunAnalysis}
                        disabled={isAnalyzing}
                        className="bg-emerald-600 text-white font-semibold py-4 px-10 rounded-2xl hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-lg shadow-emerald-100 disabled:opacity-50"
                      >
                        {isAnalyzing ? (
                          <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            Run Analysis <Play size={20} />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              {/* Dashboard Header */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest rounded-full">
                      Primary: {comparisons.find(c => c.isPrimary)?.label || 'None'}
                    </span>
                    <span className="text-black/30 text-xs font-medium flex items-center gap-1"><History size={14} /> Generated {new Date().toLocaleTimeString()}</span>
                  </div>
                  <h2 className="text-4xl font-semibold tracking-tight">Analysis Dashboard</h2>
                </div>
                
                <div className="flex items-center gap-3">
                  <button className="bg-white border border-black/10 hover:border-black/20 text-black font-semibold py-3 px-6 rounded-2xl transition-all flex items-center gap-2">
                    <Download size={20} /> Export CSV
                  </button>
                  <button className="bg-black text-white font-semibold py-3 px-8 rounded-2xl hover:bg-black/80 transition-all flex items-center gap-2 shadow-lg shadow-black/10">
                    <FileText size={20} /> Generate Report
                  </button>
                </div>
              </div>

              {/* Main Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Executive Decision Card */}
                <div className={cn(
                  "lg:col-span-2 p-8 rounded-[32px] border shadow-sm flex flex-col justify-between min-h-[320px]",
                  results?.decision === 'No change' ? "bg-emerald-50 border-emerald-100" :
                  results?.decision === 'Minor change' ? "bg-amber-50 border-amber-100" :
                  results?.decision === 'Major change' ? "bg-red-50 border-red-100" :
                  "bg-slate-50 border-slate-100"
                )}>
                  <div>
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-4 h-4 rounded-full animate-pulse",
                          results?.decision === 'No change' ? "bg-emerald-500" :
                          results?.decision === 'Minor change' ? "bg-amber-500" :
                          results?.decision === 'Major change' ? "bg-red-500" :
                          "bg-slate-500"
                        )} />
                        <span className="text-xs font-bold uppercase tracking-widest opacity-60">Executive Recommendation</span>
                      </div>
                      <div className="px-4 py-1.5 bg-white/60 backdrop-blur-sm rounded-full border border-black/5 text-[10px] font-bold uppercase tracking-widest">
                        {results?.confidence}
                      </div>
                    </div>
                    
                    <h3 className="text-6xl font-semibold mb-6 tracking-tight">{results?.decision}</h3>
                    <p className="text-lg text-black/70 leading-relaxed max-w-2xl">
                      {results?.interpretation}
                    </p>
                  </div>
                  
                  <div className="pt-8 border-t border-black/5 flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Deming Regression</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">MU-Aware Engine</span>
                    </div>
                  </div>
                </div>

                {/* Range Card */}
                <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm space-y-8">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-6">Therapeutic APTT Range</h4>
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-black/40">Current Approved</span>
                        <div className="text-right">
                          <p className="text-2xl font-semibold">{analysisConfig.currentApprovedRange.lower} – {analysisConfig.currentApprovedRange.upper}</p>
                          <p className="text-[10px] font-bold text-black/30 uppercase">Seconds</p>
                        </div>
                      </div>
                      <div className="h-px bg-black/5" />
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-emerald-600">Proposed New</span>
                        <div className="text-right">
                          <p className="text-4xl font-semibold text-emerald-700">{results?.proposedRange.lower} – {results?.proposedRange.upper}</p>
                          <p className="text-[10px] font-bold text-emerald-600/40 uppercase">Seconds</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-[#F5F5F4] p-4 rounded-2xl space-y-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-black/40">Lower Shift</span>
                      <span className={cn("font-bold", (results?.shifts.lower || 0) > 0 ? "text-red-600" : "text-emerald-600")}>
                        {results?.shifts.lower && results.shifts.lower > 0 ? '+' : ''}{results?.shifts.lower} sec
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-black/40">Upper Shift</span>
                      <span className={cn("font-bold", (results?.shifts.upper || 0) > 0 ? "text-red-600" : "text-emerald-600")}>
                        {results?.shifts.upper && results.shifts.upper > 0 ? '+' : ''}{results?.shifts.upper} sec
                      </span>
                    </div>
                  </div>
                </div>

                {/* Misclassification Card */}
                <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm flex flex-col justify-between">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-6">Misclassification Risk</h4>
                    <div className="flex items-end gap-4 mb-8">
                      <div className="flex-1 space-y-2">
                        <div className="h-24 bg-slate-100 rounded-xl relative overflow-hidden">
                          <div className="absolute bottom-0 w-full bg-slate-400 transition-all duration-1000" style={{ height: `${results?.misclassification.current}%` }} />
                        </div>
                        <p className="text-[10px] font-bold text-center uppercase tracking-tighter opacity-40">Current</p>
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="h-24 bg-emerald-50 rounded-xl relative overflow-hidden">
                          <div className="absolute bottom-0 w-full bg-emerald-500 transition-all duration-1000" style={{ height: `${results?.misclassification.proposed}%` }} />
                        </div>
                        <p className="text-[10px] font-bold text-center uppercase tracking-tighter text-emerald-600">Proposed</p>
                      </div>
                    </div>
                    <p className="text-sm text-black/60 leading-relaxed">
                      The proposed range reduces overall misclassification risk by <span className="font-bold text-emerald-600">{results?.misclassification.improvement}%</span>.
                    </p>
                  </div>
                  <button className="mt-8 text-xs font-bold uppercase tracking-widest text-black/40 hover:text-black flex items-center gap-2 transition-colors">
                    View Confusion Matrix <ChevronRight size={14} />
                  </button>
                </div>

                {/* Uncertainty Summary */}
                <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-6">Uncertainty Summary (95% CI)</h4>
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-bold uppercase tracking-tighter opacity-40">
                        <span>Lower Limit</span>
                        <span>±{((results?.uncertainty.lowerInterval[1] || 0) - (results?.uncertainty.lowerInterval[0] || 0) / 2).toFixed(1)}s</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full relative">
                        <div className="absolute h-full bg-emerald-500 rounded-full" style={{ left: '40%', width: '20%' }} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-bold uppercase tracking-tighter opacity-40">
                        <span>Upper Limit</span>
                        <span>±{((results?.uncertainty.upperInterval[1] || 0) - (results?.uncertainty.upperInterval[0] || 0) / 2).toFixed(1)}s</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full relative">
                        <div className="absolute h-full bg-emerald-500 rounded-full" style={{ left: '60%', width: '15%' }} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Key Visual Placeholder */}
                <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm flex flex-col items-center justify-center text-center">
                  <BarChart3 size={48} className="text-black/10 mb-4" />
                  <h4 className="text-sm font-semibold mb-2">Regression Visualization</h4>
                  <p className="text-xs text-black/40 max-w-[200px]">Interactive Deming regression plot with confidence bands will be rendered here.</p>
                </div>

                {/* Simulation Tool */}
                <div className="lg:col-span-3 bg-white p-8 rounded-[32px] border border-black/5 shadow-sm">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h4 className="text-sm font-bold uppercase tracking-widest text-black/80">Proposed Range Simulation</h4>
                      <p className="text-xs text-black/40">Adjust limits to see real-time impact on misclassification and risk.</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-[#F5F5F4] rounded-full hover:bg-black/5 transition-colors">Reset to Proposed</button>
                      <button className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-[#F5F5F4] rounded-full hover:bg-black/5 transition-colors">Reset to Current</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-center">
                    <div className="space-y-4">
                      <label className="text-[10px] uppercase font-bold text-black/40 block">Simulation Lower Limit</label>
                      <input 
                        type="number" 
                        value={results?.proposedRange.lower}
                        className="w-full bg-[#F5F5F4] border-none rounded-xl p-4 font-semibold text-xl focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="space-y-4">
                      <label className="text-[10px] uppercase font-bold text-black/40 block">Simulation Upper Limit</label>
                      <input 
                        type="number" 
                        value={results?.proposedRange.upper}
                        className="w-full bg-[#F5F5F4] border-none rounded-xl p-4 font-semibold text-xl focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="md:col-span-2 bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest mb-1">Simulated Risk Score</p>
                        <p className="text-3xl font-bold text-emerald-900">14.2 <span className="text-sm font-medium opacity-40">Weighted</span></p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest mb-1">Improvement</p>
                        <p className="text-xl font-bold text-emerald-600">+5.1%</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      
      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-black/5 flex flex-col md:flex-row justify-between items-center gap-6 opacity-40">
        <p className="text-xs font-medium">© 2026 APTT Therapeutic Range Verifier. All calculations performed locally.</p>
        <div className="flex gap-6 text-xs font-bold uppercase tracking-widest">
          <a href="#" className="hover:text-black transition-colors">Documentation</a>
          <a href="#" className="hover:text-black transition-colors">Methodology</a>
          <a href="#" className="hover:text-black transition-colors">Support</a>
        </div>
      </footer>
    </div>
  );
}
