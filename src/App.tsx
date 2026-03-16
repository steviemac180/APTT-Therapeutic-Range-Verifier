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
  TrendingUp,
  TrendingDown,
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { 
  ScatterChart, 
  Scatter, 
  XAxis, 
  YAxis, 
  ZAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Line,
  LineChart,
  ComposedChart,
  ReferenceArea,
  ReferenceLine
} from 'recharts';
import { 
  ProcessedDataRow, 
  AnalysisConfig, 
  AnalysisResults, 
  LabConfig,
  FileValidationSummary,
  Range,
  Comparison,
  SetupStep,
  ConfusionMatrix,
  SummaryResults,
  ReportCommentary
} from './types';
import { 
  DEFAULT_XA_RANGE, 
  DEFAULT_APTT_RANGE, 
  DEFAULT_MU_BANDS,
  DEFAULT_MU_UNITS,
  DEFAULT_RISK_WEIGHTS 
} from './constants';
import { 
  parseCSV, 
  validateDataQuality, 
  detectComparisons, 
  getComparisonsSummary, 
  exportProcessedDataToCSV,
  exportDecisionTableToCSV,
  exportKeyOutputsToCSV
} from './services/dataService';
import { runAnalysis } from './services/statsService';
import { calculateSingleRangeMisclassification } from './services/analysis/misclassification';
import { getDemoData, DemoScenario } from './services/demoData';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function InfoTooltip({ title, content }: { title?: string, content: string }) {
  return (
    <div className="group relative inline-block ml-1 align-middle">
      <Info size={12} className="text-black/30 hover:text-black/60 cursor-help transition-colors" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-black text-white rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 shadow-2xl border border-white/10">
        {title && <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1">{title}</div>}
        <div className="text-[10px] leading-relaxed font-medium">{content}</div>
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-black" />
      </div>
    </div>
  );
}

function generateAssumptionsAndLimitations(results: AnalysisResults, config: AnalysisConfig) {
  const assumptions = [
    "The relationship between Anti-Xa and APTT is assumed to be linear within the therapeutic range.",
    "The Anti-Xa assay is considered the gold standard reference for heparin monitoring.",
    `Measurement uncertainty is applied based on ${config.muUnits.xa} for Xa and ${config.muUnits.apttNew} for APTT.`
  ];

  if (config.includeMU) {
    assumptions.push("Proposed ranges incorporate Measurement Uncertainty to minimize clinical risk at boundaries.");
  }

  const limitations = [];
  
  if (results.regressionModel.r2 < 0.85) {
    limitations.push("Lower correlation (R² < 0.85) suggests significant biological or analytical variance in the dataset.");
  }
  
  if (results.summary.qc.censoredCount > 0) {
    limitations.push("Dataset contains capped/censored values which may bias the regression slope if concentrated at range boundaries.");
  }

  if (results.sensitivityAnalysis && !results.sensitivityAnalysis.overallAgreement) {
    limitations.push("Methodological variance detected: different regression models yield significantly different proposed ranges.");
  }

  if (results.summary.xa.count < 30) {
    limitations.push("Small sample size (n < 30) increases the risk of sampling bias and wider uncertainty intervals.");
  }

  if (!config.includeMU) {
    limitations.push("Analysis excludes Measurement Uncertainty; clinical decisions near range boundaries may carry higher risk.");
  }

  // Check for extreme risk weights
  if (config.riskWeights.subToSupra > 5 || config.riskWeights.supraToSub > 5) {
    limitations.push("High risk weighting applied to major misclassifications; results are heavily biased towards safety over sensitivity.");
  }

  return { assumptions, limitations };
}

type AppState = 'setup' | 'dashboard';

function ConfusionMatrixTable({ data, title }: { data: ConfusionMatrix, title: string }) {
  const categories: ('below' | 'therapeutic' | 'above')[] = ['below', 'therapeutic', 'above'];
  const labels = {
    below: 'Sub',
    therapeutic: 'Therapeutic',
    above: 'Supra'
  };

  return (
    <div className="space-y-4">
      <h5 className="text-[10px] font-bold uppercase tracking-widest text-black/40">{title}</h5>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr>
              <th className="p-2 border-b border-black/5 text-left text-black/30 font-bold uppercase">Truth (Xa)</th>
              {categories.map(cat => (
                <th key={cat} className="p-2 border-b border-black/5 text-center text-black/30 font-bold uppercase">{labels[cat]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map(truthCat => (
              <tr key={truthCat}>
                <td className="p-2 border-r border-black/5 font-bold text-black/60 uppercase">{labels[truthCat]}</td>
                {categories.map(predCat => {
                  const val = data[truthCat][predCat];
                  const isMismatch = truthCat !== predCat;
                  return (
                    <td 
                      key={predCat} 
                      className={cn(
                        "p-3 text-center font-semibold text-xs",
                        val === 0 ? "text-black/10" : 
                        isMismatch ? "text-red-600 bg-red-50/30" : "text-emerald-600 bg-emerald-50/30"
                      )}
                    >
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RegressionVisualization({ data, results, config }: { data: ProcessedDataRow[], results: AnalysisResults, config: AnalysisConfig }) {
  const chartData = useMemo(() => {
    // Filter for usable data points
    const usableData = data.filter(d => d.isUsable && d.xa !== null && d.apttNew !== null);
    
    // Sort by Xa for better line rendering
    const sortedData = [...usableData].sort((a, b) => (a.xa || 0) - (b.xa || 0));
    
    // Create points for the regression line
    const minXa = Math.min(...sortedData.map(d => d.xa || 0));
    const maxXa = Math.max(...sortedData.map(d => d.xa || 0));
    
    const regressionPoints = [
      { xa: minXa, aptt: results.regressionModel.intercept + results.regressionModel.slope * minXa },
      { xa: maxXa, aptt: results.regressionModel.intercept + results.regressionModel.slope * maxXa }
    ];

    return {
      points: sortedData.map(d => ({
        xa: d.xa,
        aptt: d.apttNew,
        id: d.id
      })),
      line: regressionPoints
    };
  }, [data, results]);

  return (
    <div className="h-[400px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#00000008" vertical={false} />
          <XAxis 
            type="number" 
            dataKey="xa" 
            name="Anti-Xa" 
            unit=" IU/mL" 
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fontWeight: 600 }}
            label={{ value: 'Anti-Xa (IU/mL)', position: 'bottom', offset: 0, fontSize: 10, fontWeight: 700, textAnchor: 'middle' }}
          />
          <YAxis 
            type="number" 
            dataKey="aptt" 
            name="APTT" 
            unit="s" 
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fontWeight: 600 }}
            label={{ value: 'APTT (Seconds)', angle: -90, position: 'left', offset: 0, fontSize: 10, fontWeight: 700, textAnchor: 'middle' }}
          />
          <Tooltip 
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px' }}
          />
          
          {/* Therapeutic Xa Range Highlight */}
          <ReferenceArea 
            x1={config.therapeuticXaRange.lower} 
            x2={config.therapeuticXaRange.upper} 
            {...{ fill: '#10b981', fillOpacity: 0.05 } as any}
          />
          
          {/* Proposed APTT Range Highlight */}
          <ReferenceArea 
            y1={results.proposedRange.lower} 
            y2={results.proposedRange.upper} 
            {...{ fill: '#10b981', fillOpacity: 0.05 } as any}
          />

          {/* Data Points */}
          <Scatter 
            name="Samples" 
            data={chartData.points} 
            fill="#141414" 
            fillOpacity={0.4}
            shape="circle"
          />
          
          {/* Regression Line */}
          <Line 
            type="monotone" 
            dataKey="aptt" 
            data={chartData.line} 
            stroke="#10b981" 
            strokeWidth={3} 
            dot={false} 
            activeDot={false}
            name="Deming Regression"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TemporalSignalPanel({ results }: { results: AnalysisResults }) {
  const signal = results.temporalSignal;
  
  if (!signal) return null;

  if (!signal.possible) {
    return (
      <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm opacity-60">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-black/[0.03] rounded-full flex items-center justify-center text-black/20">
            <History size={20} />
          </div>
          <div>
            <h4 className="text-sm font-bold uppercase tracking-widest text-black/40">Trend / Temporal Signal Analysis</h4>
            <p className="text-[10px] text-black/30 font-medium">Contextual assessment inactive.</p>
          </div>
        </div>
        <div className="bg-black/[0.02] p-6 rounded-2xl border border-dashed border-black/10">
          <p className="text-xs text-black/40 leading-relaxed italic">
            {signal.interpretation} To enable temporal analysis, ensure your dataset includes successive comparisons where the 'New Lot ID' of one year matches the 'Current Lot ID' of the following year.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
            <Activity size={20} />
          </div>
          <div>
            <h4 className="text-sm font-bold uppercase tracking-widest text-black/80">Trend / Temporal Signal Analysis</h4>
            <p className="text-xs text-black/40">Contextual assessment of lot behavior across successive years.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
            signal.status === 'absent' ? "bg-emerald-50 text-emerald-600" :
            signal.status === 'possible' ? "bg-amber-50 text-amber-600" :
            "bg-red-50 text-red-600"
          )}>
            Signal: {signal.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={signal.metrics}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#00000008" />
                <XAxis 
                  dataKey="year" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#00000040', fontWeight: 600 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#00000040', fontWeight: 600 }}
                  domain={['auto', 'auto']}
                />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: 'none', 
                    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
                    fontSize: '12px',
                    fontWeight: 600
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="slope" 
                  stroke="#6366f1" 
                  strokeWidth={3} 
                  dot={{ r: 6, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 8, strokeWidth: 0 }}
                  name="Regression Slope"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-4 text-[10px] text-black/30 font-medium text-center uppercase tracking-widest">
            Lot Sensitivity (Slope) Trend Across Linked Comparisons
          </p>
        </div>

        <div className="space-y-6">
          <div className="bg-indigo-50/30 p-6 rounded-2xl border border-indigo-100/50">
            <h5 className="text-[10px] font-bold uppercase tracking-widest text-indigo-900/40 mb-3">Interpretation</h5>
            <p className="text-xs text-indigo-900/80 leading-relaxed font-medium">
              {signal.interpretation}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-black/[0.02] p-4 rounded-xl border border-black/5">
              <p className="text-[8px] font-bold text-black/30 uppercase tracking-widest mb-1">Linked Lots</p>
              <p className="text-lg font-bold text-black">{signal.metrics.length}</p>
            </div>
            <div className="bg-black/[0.02] p-4 rounded-xl border border-black/5">
              <p className="text-[8px] font-bold text-black/30 uppercase tracking-widest mb-1">Stability</p>
              <div className="flex items-center gap-2">
                {signal.status === 'absent' ? (
                  <CheckCircle2 size={16} className="text-emerald-500" />
                ) : (
                  <AlertTriangle size={16} className="text-amber-500" />
                )}
                <span className="text-xs font-bold text-black capitalize">{signal.status}</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-black/5">
            <p className="text-[10px] italic text-black/40 leading-relaxed">
              Disclaimer: This analysis is supportive observational evidence based on historical lot performance. 
              It is intended for context only and does not imply a causal relationship or serve as a primary decision basis.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MethodRobustnessPanel({ results }: { results: AnalysisResults }) {
  const sensitivity = results.sensitivityAnalysis;
  if (!sensitivity || !sensitivity.enabled) return null;

  return (
    <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-50 rounded-full flex items-center justify-center text-purple-600">
            <Beaker size={20} />
          </div>
          <div>
            <h4 className="text-sm font-bold uppercase tracking-widest text-black/80">Method Robustness / Sensitivity Analysis</h4>
            <p className="text-xs text-black/40">Comparison of primary model against alternative regression methods.</p>
          </div>
        </div>
        {!sensitivity.overallAgreement && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl border border-red-100">
            <AlertTriangle size={16} />
            <span className="text-[10px] font-bold uppercase tracking-widest">Material Disagreement Detected</span>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-black/5">
              <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-black/40">Regression Method</th>
              <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Proposed Range</th>
              <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Width</th>
              <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Slope</th>
              <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Agreement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            <tr className="bg-emerald-50/30">
              <td className="py-4 text-xs font-bold text-black flex items-center gap-2">
                {results.regressionMethod} <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] rounded uppercase">Primary</span>
              </td>
              <td className="py-4 text-xs font-mono text-center font-bold">{results.proposedRange.lower} – {results.proposedRange.upper}s</td>
              <td className="py-4 text-xs font-mono text-center">{(results.proposedRange.upper - results.proposedRange.lower).toFixed(1)}s</td>
              <td className="py-4 text-xs font-mono text-center">{results.regressionModel.slope.toFixed(3)}</td>
              <td className="py-4 text-center">
                <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-[8px] font-bold uppercase rounded-lg">Reference</span>
              </td>
            </tr>
            {sensitivity.results.map((res, i) => (
              <tr key={i}>
                <td className="py-4 text-xs font-medium text-black/60">{res.method}</td>
                <td className="py-4 text-xs font-mono text-center">{res.proposedRange.lower} – {res.proposedRange.upper}s</td>
                <td className="py-4 text-xs font-mono text-center">{res.width.toFixed(1)}s</td>
                <td className="py-4 text-xs font-mono text-center">{res.slope.toFixed(3)}</td>
                <td className="py-4 text-center">
                  <span className={cn(
                    "px-2 py-1 text-[8px] font-bold uppercase rounded-lg",
                    res.agreement === 'Agree' ? "bg-emerald-50 text-emerald-600" :
                    res.agreement === 'Minor Disagreement' ? "bg-amber-50 text-amber-600" :
                    "bg-red-50 text-red-600"
                  )}>
                    {res.agreement}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!sensitivity.overallAgreement && (
        <div className="p-6 bg-red-50 rounded-2xl border border-red-100 space-y-2">
          <h5 className="text-xs font-bold text-red-900 uppercase tracking-widest">Caution: Methodological Variance</h5>
          <p className="text-xs text-red-800/70 leading-relaxed">
            {sensitivity.disagreementReason}. The primary regression model produces results that differ significantly from alternative statistical methods. 
            This often occurs in datasets with high leverage points, non-linear relationships, or significant outliers. 
            Manual verification of the regression plots for all methods is strongly recommended.
          </p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('setup');
  const [dashboardTab, setDashboardTab] = useState<'executive' | 'technical' | 'comparison'>('executive');
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
    muUnits: DEFAULT_MU_UNITS,
    analysisDepth: 'Standard',
    includeMU: true,
    enableSensitivityAnalysis: false,
    riskWeights: DEFAULT_RISK_WEIGHTS
  });

  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [resultsNoMU, setResultsNoMU] = useState<AnalysisResults | null>(null);
  const [useMU, setUseMU] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [demoScenario, setDemoScenario] = useState<DemoScenario>('no_change');
  const [showConfusionMatrix, setShowConfusionMatrix] = useState(false);
  const [showSimulation, setShowSimulation] = useState(false);
  const [showReportEditor, setShowReportEditor] = useState(false);
  const [reportCommentary, setReportCommentary] = useState<ReportCommentary>({
    executiveSummary: "The validation study for the new APTT reagent lot demonstrates acceptable correlation with the anti-Xa therapeutic range. The proposed therapeutic range maintains clinical safety while optimizing sensitivity to heparin therapy.",
    medicalDirectorNotes: "Based on the statistical analysis and misclassification risk assessment, the proposed range is approved for clinical use. No significant shift in clinical decision-making is expected.",
    technicalNotes: "The method comparison was performed using a representative sample set across the therapeutic spectrum. Quality control data and uncertainty of measurement were within acceptable laboratory limits.",
    limitationsNotes: "This analysis is based on the provided dataset. Results should be interpreted in the context of clinical presentation and other coagulation parameters."
  });
  const [simulatedRange, setSimulatedRange] = useState<Range | null>(null);

  const activeResults = useMU ? results : resultsNoMU;

  const simulatedResults = useMemo(() => {
    if (!activeResults || !simulatedRange || !rawData) return null;
    
    const activeData = rawData.filter(d => d.isUsable && (comparisons.find(c => c.id === d.comparisonId)?.included ?? true));
    const simData = calculateSingleRangeMisclassification(activeData, simulatedRange, analysisConfig, 'apttNew');
    
    return {
      ...simData,
      width: Math.round((simulatedRange.upper - simulatedRange.lower) * 10) / 10,
      vsCurrent: {
        improvement: Math.round((activeResults.misclassification.current.rate - simData.rate) * 10) / 10,
        weightedImprovement: Math.round((activeResults.misclassification.current.weightedScore - simData.weightedScore) * 10) / 10
      },
      vsProposed: {
        improvement: Math.round((activeResults.misclassification.proposed.rate - simData.rate) * 10) / 10,
        weightedImprovement: Math.round((activeResults.misclassification.proposed.weightedScore - simData.weightedScore) * 10) / 10
      }
    };
  }, [activeResults, simulatedRange, rawData, comparisons, analysisConfig]);

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

  const updateMuBand = (category: keyof AnalysisConfig['muBands'], index: number, value: number) => {
    setAnalysisConfig(prev => {
      const nextBands = [...prev.muBands[category]];
      nextBands[index] = { ...nextBands[index], value };
      return {
        ...prev,
        muBands: {
          ...prev.muBands,
          [category]: nextBands
        }
      };
    });
  };

  const updateMuUnit = (category: keyof AnalysisConfig['muUnits'], unit: 'SD' | 'CV%') => {
    setAnalysisConfig(prev => ({
      ...prev,
      muUnits: { ...prev.muUnits, [category]: unit }
    }));
  };

  const updateMuBandBoundary = (category: keyof AnalysisConfig['muBands'], index: number, field: 'lowerBound' | 'upperBound', value: number) => {
    setAnalysisConfig(prev => {
      const nextBands = [...prev.muBands[category]];
      nextBands[index] = { ...nextBands[index], [field]: value };
      return {
        ...prev,
        muBands: { ...prev.muBands, [category]: nextBands }
      };
    });
  };

  const restoreDefaultRiskWeights = () => {
    setAnalysisConfig(prev => ({
      ...prev,
      riskWeights: DEFAULT_RISK_WEIGHTS
    }));
  };

  // Prefill MU boundaries when ranges change
  React.useEffect(() => {
    setAnalysisConfig(prev => {
      const nextXa = [...prev.muBands.xa];
      nextXa[0] = { ...nextXa[0], upperBound: prev.therapeuticXaRange.lower };
      nextXa[1] = { ...nextXa[1], lowerBound: prev.therapeuticXaRange.lower, upperBound: prev.therapeuticXaRange.upper };
      nextXa[2] = { ...nextXa[2], lowerBound: prev.therapeuticXaRange.upper };

      const nextApttCurrent = [...prev.muBands.apttCurrent];
      nextApttCurrent[0] = { ...nextApttCurrent[0], upperBound: prev.currentApprovedRange.lower };
      nextApttCurrent[1] = { ...nextApttCurrent[1], lowerBound: prev.currentApprovedRange.lower, upperBound: prev.currentApprovedRange.upper };
      nextApttCurrent[2] = { ...nextApttCurrent[2], lowerBound: prev.currentApprovedRange.upper };

      const nextApttNew = [...prev.muBands.apttNew];
      nextApttNew[0] = { ...nextApttNew[0], upperBound: prev.currentApprovedRange.lower };
      nextApttNew[1] = { ...nextApttNew[1], lowerBound: prev.currentApprovedRange.lower, upperBound: prev.currentApprovedRange.upper };
      nextApttNew[2] = { ...nextApttNew[2], lowerBound: prev.currentApprovedRange.upper };

      return {
        ...prev,
        muBands: {
          xa: nextXa,
          apttCurrent: nextApttCurrent,
          apttNew: nextApttNew
        }
      };
    });
  }, [analysisConfig.therapeuticXaRange.lower, analysisConfig.therapeuticXaRange.upper, analysisConfig.currentApprovedRange.lower, analysisConfig.currentApprovedRange.upper]);

  const canContinueToConfig = useMemo(() => {
    const included = comparisons.filter(c => c.included);
    if (included.length === 0) return false;
    if (!included.some(c => c.isPrimary)) return false;
    
    // Check exclusion reasons
    const excluded = comparisons.filter(c => !c.included);
    if (excluded.some(c => !c.exclusionReason?.trim())) return false;
    
    return true;
  }, [comparisons]);

  const canRunAnalysis = useMemo(() => {
    const { currentApprovedRange, therapeuticXaRange, muBands } = analysisConfig;
    
    // Check ranges
    if (currentApprovedRange.lower <= 0 || currentApprovedRange.upper <= currentApprovedRange.lower) return false;
    if (therapeuticXaRange.lower <= 0 || therapeuticXaRange.upper <= therapeuticXaRange.lower) return false;
    
    // Check MU values (should be positive)
    const allMuValues = [
      ...muBands.xa.map(b => b.value),
      ...muBands.apttCurrent.map(b => b.value),
      ...muBands.apttNew.map(b => b.value)
    ];
    if (allMuValues.some(v => v <= 0)) return false;
    
    return true;
  }, [analysisConfig]);

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
    const { data, summary, labConfig: demoLab, analysisConfig: demoAnalysis } = getDemoData(demoScenario);
    
    setRawData(data);
    setFileSummary(summary);
    setLabConfig(demoLab);
    setAnalysisConfig(demoAnalysis);
    
    // Auto-detect comparisons for the demo data
    const { updatedData } = detectComparisons(data);
    setRawData(updatedData);
    
    // Smooth transition to setup wizard
    setSetupStep('comparison');
  };

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const resWithMU = await runAnalysis(rawData, { ...analysisConfig, includeMU: true }, comparisons);
    const resWithoutMU = await runAnalysis(rawData, { ...analysisConfig, includeMU: false }, comparisons);
    
    setResults(resWithMU);
    setResultsNoMU(resWithoutMU);
    setSimulatedRange(resWithMU.proposedRange);
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
              className="max-w-3xl mx-auto no-print"
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
                          className="w-full text-[10px] uppercase font-bold tracking-widest text-black/40 bg-transparent border-none focus:ring-0 text-center cursor-pointer hover:text-black/60 transition-colors"
                          value={demoScenario}
                          onChange={(e) => setDemoScenario(e.target.value as DemoScenario)}
                        >
                          <option value="no_change">Scenario: No Change</option>
                          <option value="minor_change">Scenario: Minor Change</option>
                          <option value="major_change">Scenario: Major Change</option>
                          <option value="review_required">Scenario: Review Required</option>
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
                  <div className="space-y-10">
                    <div>
                      <h2 className="text-2xl font-semibold mb-2">Reference Ranges</h2>
                      <p className="text-sm text-black/50">Define the current approved therapeutic boundaries and presets.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">
                            Current APTT Range (sec)
                            <InfoTooltip content="The therapeutic range currently in use for the existing lot." />
                          </h3>
                        </div>
                        <div className="flex gap-4">
                          <div className="flex-1">
                            <label className="text-[10px] uppercase font-bold text-black/40 mb-1 block">Lower Limit</label>
                            <input 
                              type="number" 
                              value={analysisConfig.currentApprovedRange.lower}
                              onChange={(e) => setAnalysisConfig({
                                ...analysisConfig,
                                currentApprovedRange: { ...analysisConfig.currentApprovedRange, lower: parseFloat(e.target.value) || 0 }
                              })}
                              className="w-full bg-[#F5F5F4] border-none rounded-xl p-3 font-semibold focus:ring-2 focus:ring-emerald-500 transition-all"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] uppercase font-bold text-black/40 mb-1 block">Upper Limit</label>
                            <input 
                              type="number" 
                              value={analysisConfig.currentApprovedRange.upper}
                              onChange={(e) => setAnalysisConfig({
                                ...analysisConfig,
                                currentApprovedRange: { ...analysisConfig.currentApprovedRange, upper: parseFloat(e.target.value) || 0 }
                              })}
                              className="w-full bg-[#F5F5F4] border-none rounded-xl p-3 font-semibold focus:ring-2 focus:ring-emerald-500 transition-all"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">
                            Therapeutic anti-Xa Range
                            <InfoTooltip content="The clinical reference range for heparin monitoring (usually 0.3-0.7 IU/mL)." />
                          </h3>
                          <div className="flex gap-2">
                            {[
                              { label: '0.3–0.7', range: { lower: 0.3, upper: 0.7 } },
                              { label: '0.2–0.5', range: { lower: 0.2, upper: 0.5 } }
                            ].map(preset => (
                              <button
                                key={preset.label}
                                onClick={() => setAnalysisConfig({
                                  ...analysisConfig,
                                  therapeuticXaRange: preset.range
                                })}
                                className={cn(
                                  "text-[9px] font-bold uppercase tracking-tighter px-2 py-1 rounded-md transition-all",
                                  analysisConfig.therapeuticXaRange.lower === preset.range.lower && analysisConfig.therapeuticXaRange.upper === preset.range.upper
                                    ? "bg-emerald-600 text-white"
                                    : "bg-black/5 text-black/40 hover:bg-black/10"
                                )}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="flex-1">
                            <label className="text-[10px] uppercase font-bold text-black/40 mb-1 block">Lower Limit</label>
                            <input 
                              type="number" 
                              step="0.01"
                              value={analysisConfig.therapeuticXaRange.lower}
                              onChange={(e) => setAnalysisConfig({
                                ...analysisConfig,
                                therapeuticXaRange: { ...analysisConfig.therapeuticXaRange, lower: parseFloat(e.target.value) || 0 }
                              })}
                              className="w-full bg-[#F5F5F4] border-none rounded-xl p-3 font-semibold focus:ring-2 focus:ring-emerald-500 transition-all"
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
                                therapeuticXaRange: { ...analysisConfig.therapeuticXaRange, upper: parseFloat(e.target.value) || 0 }
                              })}
                              className="w-full bg-[#F5F5F4] border-none rounded-xl p-3 font-semibold focus:ring-2 focus:ring-emerald-500 transition-all"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-10 border-t border-black/5">
                      <div className="flex items-center gap-2 mb-6">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">Advanced Risk Weights</h3>
                        <InfoTooltip 
                          title="Risk Weights" 
                          content="Risk weights determine how heavily different misclassification errors impact the final decision. Higher values indicate more critical errors." 
                        />
                        <button 
                          onClick={restoreDefaultRiskWeights}
                          className="ml-auto text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                        >
                          <History size={12} /> Restore Defaults
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                          { key: 'subToTherapeutic', label: 'Sub → Therapeutic', color: 'text-red-600' },
                          { key: 'supraToTherapeutic', label: 'Supra → Therapeutic', color: 'text-red-600' },
                          { key: 'therapeuticToOutside', label: 'Therapeutic → Outside', color: 'text-amber-600' },
                          { key: 'subToSupra', label: 'Sub → Supra', color: 'text-red-800' },
                          { key: 'supraToSub', label: 'Supra → Sub', color: 'text-red-800' },
                        ].map(weight => (
                          <div key={weight.key} className="bg-[#F5F5F4] p-4 rounded-2xl flex items-center justify-between">
                            <span className={cn("text-[10px] font-bold uppercase tracking-tight", weight.color)}>{weight.label}</span>
                            <input 
                              type="number" 
                              step="0.1"
                              value={analysisConfig.riskWeights[weight.key as keyof typeof analysisConfig.riskWeights]}
                              onChange={(e) => setAnalysisConfig({
                                ...analysisConfig,
                                riskWeights: { ...analysisConfig.riskWeights, [weight.key]: parseFloat(e.target.value) || 0 }
                              })}
                              className="w-12 bg-white border-none rounded-lg p-1.5 text-xs font-bold text-right focus:ring-1 focus:ring-emerald-500"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-8 border-t border-black/5 flex justify-between">
                      <button 
                        onClick={() => setSetupStep('comparison')}
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
                      {/* anti-Xa MU Section */}
                      <div className="p-6 bg-emerald-50/50 rounded-3xl border border-emerald-100">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center gap-2">
                            <Beaker size={18} className="text-emerald-600" />
                            <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-800">anti-Xa MU Bands</h3>
                            <InfoTooltip 
                              title="anti-Xa Measurement Uncertainty" 
                              content="Enter the MU for each range. SD is typically used for lower values (< 0.10), while CV% is used for higher values." 
                            />
                          </div>
                          <div className="flex bg-white rounded-xl p-1 border border-emerald-100 shadow-sm">
                            {(['SD', 'CV%'] as const).map(u => (
                              <button
                                key={u}
                                onClick={() => updateMuUnit('xa', u)}
                                className={cn(
                                  "px-3 py-1 rounded-lg text-[10px] font-bold transition-all",
                                  analysisConfig.muUnits.xa === u ? "bg-emerald-600 text-white shadow-sm" : "text-black/30 hover:text-black/60"
                                )}
                              >
                                {u}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {analysisConfig.muBands.xa.map((band, i) => (
                            <div key={i} className="bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm space-y-3">
                              <div className="flex items-center gap-1">
                                <input 
                                  type="number" 
                                  step="0.01"
                                  value={band.lowerBound}
                                  onChange={(e) => updateMuBandBoundary('xa', i, 'lowerBound', parseFloat(e.target.value) || 0)}
                                  className="w-12 text-[10px] font-bold text-black/40 bg-transparent border-none p-0 focus:ring-0 text-center"
                                />
                                <span className="text-[10px] font-bold text-black/20">–</span>
                                <input 
                                  type="number" 
                                  step="0.01"
                                  value={band.upperBound}
                                  onChange={(e) => updateMuBandBoundary('xa', i, 'upperBound', parseFloat(e.target.value) || 0)}
                                  className="w-12 text-[10px] font-bold text-black/40 bg-transparent border-none p-0 focus:ring-0 text-center"
                                />
                                <span className="text-[10px] font-bold text-black/40 uppercase tracking-tighter ml-auto">
                                  {i === 0 ? 'Low' : i === 1 ? 'Therapeutic' : 'High'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between pt-2 border-t border-black/5">
                                <input 
                                  type="number" 
                                  step="0.01"
                                  value={band.value}
                                  onChange={(e) => updateMuBand('xa', i, parseFloat(e.target.value) || 0)}
                                  className="w-full text-lg font-semibold bg-transparent border-none p-0 focus:ring-0"
                                />
                                <span className="text-xs font-bold text-black/30">{analysisConfig.muUnits.xa}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* APTT Sections */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Current Lot */}
                        <div className="p-6 bg-blue-50/50 rounded-3xl border border-blue-100">
                          <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold uppercase tracking-widest text-blue-800">APTT Current Lot MU</h3>
                              <InfoTooltip 
                                title="Current Lot MU" 
                                content="Measurement uncertainty for the current APTT reagent lot. This is used to calculate the 'MU-Adjusted' therapeutic range." 
                              />
                            </div>
                            <div className="flex bg-white rounded-xl p-1 border border-blue-100 shadow-sm">
                              {(['SD', 'CV%'] as const).map(u => (
                                <button
                                  key={u}
                                  onClick={() => updateMuUnit('apttCurrent', u)}
                                  className={cn(
                                    "px-3 py-1 rounded-lg text-[10px] font-bold transition-all",
                                    analysisConfig.muUnits.apttCurrent === u ? "bg-blue-600 text-white shadow-sm" : "text-black/30 hover:text-black/60"
                                  )}
                                >
                                  {u}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-3">
                            {analysisConfig.muBands.apttCurrent.map((band, i) => (
                              <div key={i} className="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm flex items-center justify-between gap-4">
                                <div className="flex items-center gap-1">
                                  <input 
                                    type="number" 
                                    value={band.lowerBound}
                                    onChange={(e) => updateMuBandBoundary('apttCurrent', i, 'lowerBound', parseFloat(e.target.value) || 0)}
                                    className="w-10 text-[10px] font-bold text-black/40 bg-transparent border-none p-0 focus:ring-0 text-center"
                                  />
                                  <span className="text-[10px] font-bold text-black/20">–</span>
                                  <input 
                                    type="number" 
                                    value={band.upperBound}
                                    onChange={(e) => updateMuBandBoundary('apttCurrent', i, 'upperBound', parseFloat(e.target.value) || 0)}
                                    className="w-10 text-[10px] font-bold text-black/40 bg-transparent border-none p-0 focus:ring-0 text-center"
                                  />
                                </div>
                                <div className="flex-1 flex items-center justify-end gap-2">
                                  <input 
                                    type="number" 
                                    step="0.1"
                                    value={band.value} 
                                    onChange={(e) => updateMuBand('apttCurrent', i, parseFloat(e.target.value) || 0)}
                                    className="w-16 text-right text-sm font-semibold bg-transparent border-none p-0 focus:ring-0" 
                                  />
                                  <span className="text-[10px] font-bold text-black/30">{analysisConfig.muUnits.apttCurrent}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* New Lot */}
                        <div className="p-6 bg-purple-50/50 rounded-3xl border border-purple-100">
                          <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold uppercase tracking-widest text-purple-800">APTT New Lot MU</h3>
                              <InfoTooltip 
                                title="New Lot MU" 
                                content="Measurement uncertainty for the new APTT reagent lot. This helps predict how the new lot will perform relative to the current lot." 
                              />
                            </div>
                            <div className="flex bg-white rounded-xl p-1 border border-purple-100 shadow-sm">
                              {(['SD', 'CV%'] as const).map(u => (
                                <button
                                  key={u}
                                  onClick={() => updateMuUnit('apttNew', u)}
                                  className={cn(
                                    "px-3 py-1 rounded-lg text-[10px] font-bold transition-all",
                                    analysisConfig.muUnits.apttNew === u ? "bg-purple-600 text-white shadow-sm" : "text-black/30 hover:text-black/60"
                                  )}
                                >
                                  {u}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-3">
                            {analysisConfig.muBands.apttNew.map((band, i) => (
                              <div key={i} className="bg-white p-4 rounded-2xl border border-purple-100 shadow-sm flex items-center justify-between gap-4">
                                <div className="flex items-center gap-1">
                                  <input 
                                    type="number" 
                                    value={band.lowerBound}
                                    onChange={(e) => updateMuBandBoundary('apttNew', i, 'lowerBound', parseFloat(e.target.value) || 0)}
                                    className="w-10 text-[10px] font-bold text-black/40 bg-transparent border-none p-0 focus:ring-0 text-center"
                                  />
                                  <span className="text-[10px] font-bold text-black/20">–</span>
                                  <input 
                                    type="number" 
                                    value={band.upperBound}
                                    onChange={(e) => updateMuBandBoundary('apttNew', i, 'upperBound', parseFloat(e.target.value) || 0)}
                                    className="w-10 text-[10px] font-bold text-black/40 bg-transparent border-none p-0 focus:ring-0 text-center"
                                  />
                                </div>
                                <div className="flex-1 flex items-center justify-end gap-2">
                                  <input 
                                    type="number" 
                                    step="0.1"
                                    value={band.value} 
                                    onChange={(e) => updateMuBand('apttNew', i, parseFloat(e.target.value) || 0)}
                                    className="w-16 text-right text-sm font-semibold bg-transparent border-none p-0 focus:ring-0" 
                                  />
                                  <span className="text-[10px] font-bold text-black/30">{analysisConfig.muUnits.apttNew}</span>
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
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-2xl font-semibold mb-2">Final Setup Summary</h2>
                        <p className="text-sm text-black/50">Audit your configuration before running the analysis.</p>
                      </div>
                      <button 
                        onClick={() => exportProcessedDataToCSV(rawData, comparisons)}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-black/10 rounded-xl text-xs font-bold hover:bg-black/5 transition-all shadow-sm"
                      >
                        <Download size={14} /> Export Processed Dataset
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Data Audit Card */}
                      <div className="p-6 bg-[#F5F5F4] rounded-3xl border border-black/5 space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-widest text-black/40 flex items-center gap-2">
                            <FileText size={14} /> Data Audit
                          </h3>
                          <InfoTooltip 
                            title="Data Audit" 
                            content="A summary of the dataset quality. Usable rows are those with both valid anti-Xa and APTT results." 
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[10px] font-bold text-black/40 uppercase tracking-tighter">Uploaded Rows</p>
                            <p className="text-2xl font-semibold">{rawData.length}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-black/40 uppercase tracking-tighter">Usable Rows</p>
                            <p className="text-2xl font-semibold text-emerald-600">{rawData.filter(r => r.isUsable).length}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-black/40 uppercase tracking-tighter">Flagged Rows</p>
                            <p className="text-2xl font-semibold text-amber-600">{rawData.filter(r => r.flags.length > 0).length}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-black/40 uppercase tracking-tighter">Trend Analysis</p>
                            <p className="text-sm font-bold mt-1">
                              {rawData.some(r => r.year !== null) ? (
                                <span className="text-emerald-600 flex items-center gap-1"><TrendingUp size={12} /> Available</span>
                              ) : (
                                <span className="text-black/30">Not Available</span>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-black/5 space-y-3">
                          <p className="text-[10px] font-bold text-black/40 uppercase tracking-tighter">Comparison Breakdown</p>
                          <div className="space-y-2">
                            {comparisons.map(c => (
                              <div key={c.id} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <div className={cn("w-2 h-2 rounded-full", c.included ? "bg-emerald-500" : "bg-red-500")} />
                                  <span className="font-medium">{c.label}</span>
                                  {c.isPrimary && <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase">Primary</span>}
                                </div>
                                <span className={cn("font-bold", c.included ? "text-black/60" : "text-red-500")}>
                                  {c.included ? `${c.rowCount} pts` : `Excluded: ${c.exclusionReason || 'No reason'}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Configuration Audit Card */}
                      <div className="p-6 bg-[#F5F5F4] rounded-3xl border border-black/5 space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-widest text-black/40 flex items-center gap-2">
                            <Settings size={14} /> Clinical Parameters
                          </h3>
                          <InfoTooltip 
                            title="Clinical Parameters" 
                            content="The reference ranges and risk weights that will be used for the final analysis." 
                          />
                        </div>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/50 p-3 rounded-2xl border border-black/5">
                              <p className="text-[10px] font-bold text-black/40 uppercase tracking-tighter mb-1">APTT Range</p>
                              <p className="text-sm font-bold">{analysisConfig.currentApprovedRange.lower} – {analysisConfig.currentApprovedRange.upper}s</p>
                            </div>
                            <div className="bg-white/50 p-3 rounded-2xl border border-black/5">
                              <p className="text-[10px] font-bold text-black/40 uppercase tracking-tighter mb-1">anti-Xa Range</p>
                              <p className="text-sm font-bold">{analysisConfig.therapeuticXaRange.lower} – {analysisConfig.therapeuticXaRange.upper} IU/mL</p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-bold text-black/40 uppercase tracking-tighter">Sensitivity Analysis</p>
                              <button 
                                onClick={() => setAnalysisConfig(prev => ({ ...prev, enableSensitivityAnalysis: !prev.enableSensitivityAnalysis }))}
                                className={cn(
                                  "px-2 py-1 rounded-lg text-[8px] font-bold uppercase tracking-widest transition-all border",
                                  analysisConfig.enableSensitivityAnalysis 
                                    ? "bg-purple-50 border-purple-200 text-purple-700" 
                                    : "bg-slate-50 border-slate-200 text-slate-500"
                                )}
                              >
                                {analysisConfig.enableSensitivityAnalysis ? 'Sensitivity Enabled' : 'Sensitivity Disabled'}
                              </button>
                            </div>

                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-bold text-black/40 uppercase tracking-tighter">MU Configuration</p>
                              <button 
                                onClick={() => setAnalysisConfig(prev => ({ ...prev, includeMU: !prev.includeMU }))}
                                className={cn(
                                  "px-2 py-1 rounded-lg text-[8px] font-bold uppercase tracking-widest transition-all border",
                                  analysisConfig.includeMU 
                                    ? "bg-blue-50 border-blue-200 text-blue-700" 
                                    : "bg-slate-50 border-slate-200 text-slate-500"
                                )}
                              >
                                {analysisConfig.includeMU ? 'MU Enabled' : 'MU Disabled'}
                              </button>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {['xa', 'apttCurrent', 'apttNew'].map(key => (
                                <div key={key} className="bg-white/50 p-2 rounded-xl border border-black/5 text-center">
                                  <p className="text-[8px] font-bold text-black/30 uppercase mb-1">
                                    {key === 'xa' ? 'anti-Xa' : key === 'apttCurrent' ? 'APTT Cur' : 'APTT New'}
                                  </p>
                                  <p className="text-[10px] font-bold">
                                    {analysisConfig.muBands[key as keyof typeof analysisConfig.muBands].length} Bands
                                  </p>
                                  <p className="text-[8px] text-black/40">Unit: {analysisConfig.muUnits[key as keyof typeof analysisConfig.muUnits]}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="pt-2">
                            <div className="flex items-center justify-between text-[10px] font-bold text-black/40 uppercase tracking-tighter mb-2">
                              <span>Risk Weighting</span>
                              <span className="text-emerald-600">Customized</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(analysisConfig.riskWeights).map(([key, val]) => (
                                <div key={key} className="px-2 py-1 bg-white/50 rounded-lg border border-black/5 text-[8px] font-bold">
                                  {val}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {dataFlags.length > 0 && (
                      <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100 space-y-3">
                        <div className="flex items-center gap-2 text-amber-800">
                          <AlertTriangle size={18} />
                          <h3 className="text-sm font-bold uppercase tracking-widest">Quality Alerts</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {dataFlags.map((flag, i) => (
                            <div key={i} className="flex items-start gap-2 text-amber-900/70 text-xs">
                              <div className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                              {flag}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="pt-8 border-t border-black/5 flex justify-between items-center">
                      <button 
                        onClick={() => setSetupStep('mu')}
                        className="text-sm font-semibold text-black/40 hover:text-black flex items-center gap-2"
                      >
                        <ChevronLeft size={20} /> Back
                      </button>
                      
                      <div className="flex items-center gap-4">
                        {!canRunAnalysis && (
                          <p className="text-xs text-red-500 font-bold flex items-center gap-1">
                            <AlertCircle size={14} /> Complete setup to run analysis
                          </p>
                        )}
                        <button 
                          onClick={handleRunAnalysis}
                          disabled={isAnalyzing || !canRunAnalysis}
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
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8 no-print"
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

                <div className="flex items-center gap-4">
                  <div className="flex bg-white rounded-2xl p-1 border border-black/5 shadow-sm">
                    <button 
                      onClick={() => setUseMU(true)}
                      className={cn(
                        "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                        useMU ? "bg-blue-600 text-white shadow-md" : "text-black/40 hover:text-black"
                      )}
                    >
                      <FlaskConical size={14} /> MU-Aware
                    </button>
                    <button 
                      onClick={() => setUseMU(false)}
                      className={cn(
                        "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                        !useMU ? "bg-slate-600 text-white shadow-md" : "text-black/40 hover:text-black"
                      )}
                    >
                      <TrendingUp size={14} /> Standard
                    </button>
                  </div>

                  <div className="flex bg-white rounded-2xl p-1 border border-black/5 shadow-sm">
                    <button 
                      onClick={() => setDashboardTab('executive')}
                      className={cn(
                        "px-6 py-2 rounded-xl text-xs font-bold transition-all",
                        dashboardTab === 'executive' ? "bg-black text-white shadow-md" : "text-black/40 hover:text-black"
                      )}
                    >
                      Executive
                    </button>
                    <button 
                      onClick={() => setDashboardTab('technical')}
                      className={cn(
                        "px-6 py-2 rounded-xl text-xs font-bold transition-all",
                        dashboardTab === 'technical' ? "bg-black text-white shadow-md" : "text-black/40 hover:text-black"
                      )}
                    >
                      Technical
                    </button>
                    <button 
                      onClick={() => setDashboardTab('comparison')}
                      className={cn(
                        "px-6 py-2 rounded-xl text-xs font-bold transition-all",
                        dashboardTab === 'comparison' ? "bg-black text-white shadow-md" : "text-black/40 hover:text-black"
                      )}
                    >
                      MU Impact
                    </button>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setShowSimulation(!showSimulation)}
                    className={cn(
                      "bg-white border border-black/10 hover:border-black/20 text-black font-semibold py-3 px-6 rounded-2xl transition-all flex items-center gap-2",
                      showSimulation && "bg-black text-white border-black"
                    )}
                  >
                    <Beaker size={20} /> Simulation
                  </button>
                  <div className="flex items-center gap-2 bg-white border border-black/10 p-1 rounded-2xl">
                    <button 
                      onClick={() => exportProcessedDataToCSV(rawData, comparisons)}
                      className="hover:bg-black/5 text-black font-semibold py-2 px-4 rounded-xl transition-all flex items-center gap-2 text-sm"
                      title="Export Processed Dataset"
                    >
                      <Download size={16} /> Dataset
                    </button>
                    <button 
                      onClick={() => activeResults && exportDecisionTableToCSV(activeResults)}
                      className="hover:bg-black/5 text-black font-semibold py-2 px-4 rounded-xl transition-all flex items-center gap-2 text-sm border-l border-black/5"
                      title="Export Decision Table"
                    >
                      <TrendingUp size={16} /> Decisions
                    </button>
                    <button 
                      onClick={() => activeResults && exportKeyOutputsToCSV(activeResults, analysisConfig)}
                      className="hover:bg-black/5 text-black font-semibold py-2 px-4 rounded-xl transition-all flex items-center gap-2 text-sm border-l border-black/5"
                      title="Export Key Outputs"
                    >
                      <Activity size={16} /> Key Stats
                    </button>
                  </div>
                  <button 
                    onClick={() => setShowReportEditor(true)}
                    className="bg-black text-white font-semibold py-3 px-8 rounded-2xl hover:bg-black/80 transition-all flex items-center gap-2 shadow-lg shadow-black/10"
                  >
                    <FileText size={20} /> Generate Report
                  </button>
                </div>
              </div>

              {/* Simulation Tool Panel */}
              <AnimatePresence>
                {showSimulation && results && simulatedRange && simulatedResults && (
                  <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="mb-8 bg-black text-white rounded-[32px] p-8 shadow-2xl relative overflow-hidden"
                  >
                    {/* Background Accent */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                    
                    <div className="relative z-10 space-y-8">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-2xl font-semibold tracking-tight">Range Simulation Engine</h3>
                          <p className="text-xs text-white/40 uppercase font-bold tracking-widest mt-1">Real-time Impact Analysis</p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setSimulatedRange(analysisConfig.currentApprovedRange)}
                            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors"
                          >
                            Reset to Current
                          </button>
                          <button 
                            onClick={() => activeResults && setSimulatedRange(activeResults.proposedRange)}
                            className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors"
                          >
                            Reset to Proposed
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        {/* Controls */}
                        <div className="lg:col-span-1 space-y-6">
                          <div className="space-y-4">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">Simulated Lower Limit</label>
                            <div className="flex items-center gap-4">
                              <input 
                                type="range" 
                                min="40" 
                                max="80" 
                                step="1"
                                value={simulatedRange.lower}
                                onChange={(e) => setSimulatedRange({ ...simulatedRange, lower: parseInt(e.target.value) })}
                                className="flex-1 accent-emerald-500"
                              />
                              <span className="text-2xl font-mono font-bold w-12">{simulatedRange.lower}</span>
                            </div>
                          </div>
                          <div className="space-y-4">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">Simulated Upper Limit</label>
                            <div className="flex items-center gap-4">
                              <input 
                                type="range" 
                                min="80" 
                                max="130" 
                                step="1"
                                value={simulatedRange.upper}
                                onChange={(e) => setSimulatedRange({ ...simulatedRange, upper: parseInt(e.target.value) })}
                                className="flex-1 accent-emerald-500"
                              />
                              <span className="text-2xl font-mono font-bold w-12">{simulatedRange.upper}</span>
                            </div>
                          </div>
                          <div className="pt-4 border-t border-white/10">
                            <div className="flex justify-between text-xs">
                              <span className="text-white/40">Simulated Width</span>
                              <span className="font-bold">{simulatedResults.width}s</span>
                            </div>
                          </div>
                        </div>

                        {/* Metrics */}
                        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="bg-white/5 rounded-2xl p-6 space-y-4">
                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Misclassification</h4>
                            <div className="text-4xl font-bold">{simulatedResults.rate}%</div>
                            <div className="space-y-2">
                              <div className="flex justify-between text-[10px] uppercase tracking-widest">
                                <span className="text-white/40">vs Current</span>
                                <span className={cn("font-bold", simulatedResults.vsCurrent.improvement >= 0 ? "text-emerald-400" : "text-red-400")}>
                                  {simulatedResults.vsCurrent.improvement > 0 ? '+' : ''}{simulatedResults.vsCurrent.improvement}%
                                </span>
                              </div>
                              <div className="flex justify-between text-[10px] uppercase tracking-widest">
                                <span className="text-white/40">vs Proposed</span>
                                <span className={cn("font-bold", simulatedResults.vsProposed.improvement >= 0 ? "text-emerald-400" : "text-red-400")}>
                                  {simulatedResults.vsProposed.improvement > 0 ? '+' : ''}{simulatedResults.vsProposed.improvement}%
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-white/5 rounded-2xl p-6 space-y-4">
                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Weighted Risk</h4>
                            <div className="text-4xl font-bold">{simulatedResults.weightedScore}</div>
                            <div className="space-y-2">
                              <div className="flex justify-between text-[10px] uppercase tracking-widest">
                                <span className="text-white/40">vs Current</span>
                                <span className={cn("font-bold", simulatedResults.vsCurrent.weightedImprovement >= 0 ? "text-emerald-400" : "text-red-400")}>
                                  {simulatedResults.vsCurrent.weightedImprovement > 0 ? '+' : ''}{simulatedResults.vsCurrent.weightedImprovement.toFixed(1)}
                                </span>
                              </div>
                              <div className="flex justify-between text-[10px] uppercase tracking-widest">
                                <span className="text-white/40">vs Proposed</span>
                                <span className={cn("font-bold", simulatedResults.vsProposed.weightedImprovement >= 0 ? "text-emerald-400" : "text-red-400")}>
                                  {simulatedResults.vsProposed.weightedImprovement > 0 ? '+' : ''}{simulatedResults.vsProposed.weightedImprovement.toFixed(1)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-white/5 rounded-2xl p-4 overflow-hidden">
                            <ConfusionMatrixTable title="Simulated Matrix" data={simulatedResults.matrix} />
                          </div>
                        </div>
                      </div>

                      <div className="pt-8 border-t border-white/10 flex items-center justify-between">
                        <div className="flex items-center gap-3 text-white/40">
                          <AlertCircle size={16} />
                          <p className="text-[10px] font-bold uppercase tracking-widest">Simulation does not affect the official report unless confirmed</p>
                        </div>
                        <button 
                          onClick={() => {
                            if (useMU && results) {
                              setResults({
                                ...results,
                                proposedRange: simulatedRange
                              });
                            } else if (!useMU && resultsNoMU) {
                              setResultsNoMU({
                                ...resultsNoMU,
                                proposedRange: simulatedRange
                              });
                            }
                            setShowSimulation(false);
                          }}
                          className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold text-sm transition-all shadow-lg shadow-emerald-900/20"
                        >
                          Confirm for Reporting
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Main Content Area */}
              {dashboardTab === 'executive' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Stability Banner */}
                  {activeResults?.warnings && activeResults.warnings.length > 0 && (
                    <div className="lg:col-span-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-4 items-start">
                      <AlertTriangle className="text-amber-600 shrink-0" size={20} />
                      <div className="space-y-1">
                        <h5 className="text-sm font-bold text-amber-900">Analysis Stability Warnings</h5>
                        <ul className="text-xs text-amber-800 list-disc list-inside space-y-0.5">
                          {activeResults.warnings.map((warning, idx) => (
                            <li key={idx}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                      {/* Assumptions & Limitations */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 border-t border-black/5">
                        <div className="space-y-4">
                          <h4 className="text-xs font-bold uppercase tracking-widest text-black/40 flex items-center gap-2">
                            Key Assumptions
                            <InfoTooltip content="Fundamental premises upon which this statistical model is built." />
                          </h4>
                          <ul className="space-y-3">
                            {generateAssumptionsAndLimitations(activeResults, analysisConfig).assumptions.map((item, i) => (
                              <li key={i} className="flex gap-3 text-xs text-black/60 leading-relaxed">
                                <div className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-4">
                          <h4 className="text-xs font-bold uppercase tracking-widest text-black/40 flex items-center gap-2">
                            Limitations & Cautions
                            <InfoTooltip content="Factors that may limit the generalisability or accuracy of these findings." />
                          </h4>
                          <ul className="space-y-3">
                            {generateAssumptionsAndLimitations(activeResults, analysisConfig).limitations.length > 0 ? (
                              generateAssumptionsAndLimitations(activeResults, analysisConfig).limitations.map((item, i) => (
                                <li key={i} className="flex gap-3 text-xs text-black/60 leading-relaxed">
                                  <div className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                                  {item}
                                </li>
                              ))
                            ) : (
                              <li className="text-xs text-black/30 italic">No significant limitations identified for this dataset.</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Executive Decision Card */}
                  <div className={cn(
                    "lg:col-span-2 p-8 rounded-[32px] border shadow-sm flex flex-col justify-between min-h-[320px]",
                    activeResults?.decision === 'No change' ? "bg-emerald-50 border-emerald-100" :
                    activeResults?.decision === 'Minor change' ? "bg-amber-50 border-amber-100" :
                    activeResults?.decision === 'Major change' ? "bg-red-50 border-red-100" :
                    "bg-slate-50 border-slate-100"
                  )}>
                    <div>
                      <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-4 h-4 rounded-full animate-pulse",
                            activeResults?.decision === 'No change' ? "bg-emerald-500" :
                            activeResults?.decision === 'Minor change' ? "bg-amber-500" :
                            activeResults?.decision === 'Major change' ? "bg-red-500" :
                            "bg-slate-500"
                          )} />
                          <span className="text-xs font-bold uppercase tracking-widest opacity-60">Executive Recommendation</span>
                        </div>
                        <div className="px-4 py-1.5 bg-white/60 backdrop-blur-sm rounded-full border border-black/5 text-[10px] font-bold uppercase tracking-widest">
                          {activeResults?.confidence}
                        </div>
                      </div>
                      
                      <h3 className="text-6xl font-semibold mb-6 tracking-tight">{activeResults?.decision}</h3>
                      <p className="text-lg text-black/70 leading-relaxed max-w-2xl">
                        {activeResults?.interpretation}
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
                            <p className="text-4xl font-semibold text-emerald-700">{activeResults?.proposedRange.lower} – {activeResults?.proposedRange.upper}</p>
                            <p className="text-[10px] font-bold text-emerald-600/40 uppercase">Seconds</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-[#F5F5F4] p-4 rounded-2xl space-y-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-black/40">Lower Shift</span>
                        <span className={cn("font-bold", (activeResults?.shifts.lower || 0) > 0 ? "text-red-600" : "text-emerald-600")}>
                          {activeResults?.shifts.lower && activeResults.shifts.lower > 0 ? '+' : ''}{activeResults?.shifts.lower.toFixed(1)} sec
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-black/40">Upper Shift</span>
                        <span className={cn("font-bold", (activeResults?.shifts.upper || 0) > 0 ? "text-red-600" : "text-emerald-600")}>
                          {activeResults?.shifts.upper && activeResults.shifts.upper > 0 ? '+' : ''}{activeResults?.shifts.upper.toFixed(1)} sec
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-black/40">Width Shift</span>
                        <span className={cn("font-bold", (activeResults?.shifts.width || 0) > 0 ? "text-red-600" : "text-emerald-600")}>
                          {activeResults?.shifts.width && activeResults.shifts.width > 0 ? '+' : ''}{activeResults?.shifts.width.toFixed(1)} sec
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Misclassification Card */}
                  <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-6">
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40">Misclassification Risk</h4>
                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full",
                          activeResults?.misclassification.improvement! > 0 ? "bg-emerald-100 text-emerald-700" : 
                          activeResults?.misclassification.improvement! < 0 ? "bg-red-100 text-red-700" : 
                          "bg-slate-100 text-slate-600"
                        )}>
                          {activeResults?.misclassification.improvement! > 0 ? 'Improved' : 
                           activeResults?.misclassification.improvement! < 0 ? 'Worsened' : 'Unchanged'}
                        </span>
                      </div>
                      
                      <div className="flex items-end gap-4 mb-8">
                        <div className="flex-1 space-y-2">
                          <div className="h-24 bg-slate-100 rounded-xl relative overflow-hidden">
                            <div className="absolute bottom-0 w-full bg-slate-400 transition-all duration-1000" style={{ height: `${activeResults?.misclassification.current.rate}%` }} />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-bold text-black/40">{activeResults?.misclassification.current.rate}%</span>
                            </div>
                          </div>
                          <p className="text-[10px] font-bold text-center uppercase tracking-tighter opacity-40">Current</p>
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="h-24 bg-emerald-50 rounded-xl relative overflow-hidden">
                            <div className="absolute bottom-0 w-full bg-emerald-500 transition-all duration-1000" style={{ height: `${activeResults?.misclassification.proposed.rate}%` }} />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-bold text-emerald-700">{activeResults?.misclassification.proposed.rate}%</span>
                            </div>
                          </div>
                          <p className="text-[10px] font-bold text-center uppercase tracking-tighter text-emerald-600">Proposed</p>
                        </div>
                      </div>
                      
                      <p className="text-sm text-black/60 leading-relaxed">
                        {activeResults?.misclassification.improvement! > 0 ? (
                          <>The proposed range reduces overall misclassification risk by <span className="font-bold text-emerald-600">{activeResults?.misclassification.improvement}%</span>.</>
                        ) : activeResults?.misclassification.improvement! < 0 ? (
                          <>The proposed range increases misclassification risk by <span className="font-bold text-red-600">{Math.abs(activeResults?.misclassification.improvement!)}%</span>.</>
                        ) : (
                          <>The proposed range maintains the existing misclassification risk level.</>
                        )}
                      </p>
                    </div>
                    <button 
                      onClick={() => setShowConfusionMatrix(!showConfusionMatrix)}
                      className="mt-8 text-xs font-bold uppercase tracking-widest text-black/40 hover:text-black flex items-center gap-2 transition-colors"
                    >
                      {showConfusionMatrix ? 'Hide' : 'View'} Confusion Matrix <ChevronRight size={14} className={cn("transition-transform", showConfusionMatrix && "rotate-90")} />
                    </button>
                  </div>

                  {/* Advanced Misclassification Panel */}
                  <AnimatePresence>
                    {showConfusionMatrix && activeResults && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="lg:col-span-3 bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden"
                      >
                        <div className="p-8 space-y-8">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-lg font-semibold tracking-tight">Advanced Misclassification Analysis</h4>
                              <p className="text-xs text-black/40 uppercase font-bold tracking-widest mt-1">Weighted Risk & Confusion Matrix</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1">Weighted Risk Improvement</p>
                              <p className={cn(
                                "text-2xl font-bold",
                                activeResults.misclassification.weightedImprovement > 0 ? "text-emerald-600" : 
                                activeResults.misclassification.weightedImprovement < 0 ? "text-red-600" : "text-black/40"
                              )}>
                                {activeResults.misclassification.weightedImprovement > 0 ? '+' : ''}
                                {activeResults.misclassification.weightedImprovement.toFixed(1)}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                            <div className="space-y-6">
                              <ConfusionMatrixTable 
                                title="Current Approved Range" 
                                data={activeResults.misclassification.current.matrix} 
                              />
                              <div className="bg-[#F5F5F4] p-4 rounded-2xl flex justify-between items-center">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">Weighted Risk Score</span>
                                <span className="text-lg font-bold">{activeResults.misclassification.current.weightedScore}</span>
                              </div>
                            </div>
                            <div className="space-y-6">
                              <ConfusionMatrixTable 
                                title="Proposed New Range" 
                                data={activeResults.misclassification.proposed.matrix} 
                              />
                              <div className="bg-emerald-50 p-4 rounded-2xl flex justify-between items-center">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600/60">Weighted Risk Score</span>
                                <span className="text-lg font-bold text-emerald-700">{activeResults.misclassification.proposed.weightedScore}</span>
                              </div>
                            </div>
                          </div>

                          <div className="pt-8 border-t border-black/5">
                            <div className="flex items-start gap-3 bg-blue-50/50 p-4 rounded-2xl">
                              <Info size={16} className="text-blue-500 mt-0.5" />
                              <p className="text-xs text-blue-800 leading-relaxed">
                                <strong>Weighted Risk</strong> is calculated by multiplying each misclassification type by its assigned risk weight. 
                                A lower score indicates a safer range. The confusion matrix shows how Anti-Xa "truth" categories (rows) compare to 
                                APTT-based classifications (columns).
                              </p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Lot Comparison Card */}
                  <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm space-y-6">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40">Model Predicted Limits</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">Current Lot</p>
                        <div className="space-y-1">
                          <p className="text-lg font-semibold">{activeResults?.currentLotPredicted.lower} – {activeResults?.currentLotPredicted.upper}</p>
                          <p className="text-[10px] text-black/40 uppercase font-bold tracking-tighter">Width: {activeResults?.currentLotPredicted.width}s</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600/60">New Lot</p>
                        <div className="space-y-1">
                          <p className="text-lg font-semibold text-emerald-700">{activeResults?.newLotPredicted.lower} – {activeResults?.newLotPredicted.upper}</p>
                          <p className="text-[10px] text-emerald-600/40 uppercase font-bold tracking-tighter">Width: {activeResults?.newLotPredicted.width}s</p>
                        </div>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-black/5">
                      <p className="text-[10px] text-black/40 leading-relaxed italic">
                        Predictions based on therapeutic Anti-Xa range of {analysisConfig.therapeuticXaRange.lower} – {analysisConfig.therapeuticXaRange.upper} IU/mL.
                      </p>
                    </div>
                  </div>

                  {/* Uncertainty Summary Card */}
                  <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm space-y-8">
                    <div className="flex justify-between items-start">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40">Bootstrap Uncertainty (95% CI)</h4>
                      <span className="text-[10px] font-bold text-black/30 uppercase tracking-widest">{activeResults?.uncertainty.iterations} Iterations</span>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-6">
                      <div className="space-y-4">
                        <div className="flex justify-between items-end">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">Predicted Limits</p>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-black/20 italic">95% Confidence Interval</p>
                        </div>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-black/60">Lower Limit</span>
                            <span className="text-sm font-bold">{activeResults?.uncertainty.lowerInterval[0].toFixed(1)} – {activeResults?.uncertainty.lowerInterval[1].toFixed(1)}s</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-black/60">Upper Limit</span>
                            <span className="text-sm font-bold">{activeResults?.uncertainty.upperInterval[0].toFixed(1)} – {activeResults?.uncertainty.upperInterval[1].toFixed(1)}s</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-black/60">Therapeutic Width</span>
                            <span className="text-sm font-bold">{activeResults?.uncertainty.widthInterval[0].toFixed(1)} – {activeResults?.uncertainty.widthInterval[1].toFixed(1)}s</span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-6 border-t border-black/5 space-y-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">Shift Uncertainty</p>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-black/60">Lower Shift</span>
                            <span className="text-sm font-bold">{activeResults?.uncertainty.lowerShiftInterval[0] > 0 ? '+' : ''}{activeResults?.uncertainty.lowerShiftInterval[0]} to {activeResults?.uncertainty.lowerShiftInterval[1] > 0 ? '+' : ''}{activeResults?.uncertainty.lowerShiftInterval[1]}s</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-black/60">Upper Shift</span>
                            <span className="text-sm font-bold">{activeResults?.uncertainty.upperShiftInterval[0] > 0 ? '+' : ''}{activeResults?.uncertainty.upperShiftInterval[0]} to {activeResults?.uncertainty.upperShiftInterval[1] > 0 ? '+' : ''}{activeResults?.uncertainty.upperShiftInterval[1]}s</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-black/60">Width Shift</span>
                            <span className="text-sm font-bold">{activeResults?.uncertainty.widthShiftInterval[0] > 0 ? '+' : ''}{activeResults?.uncertainty.widthShiftInterval[0]} to {activeResults?.uncertainty.widthShiftInterval[1] > 0 ? '+' : ''}{activeResults?.uncertainty.widthShiftInterval[1]}s</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Range Comparison Visual with Intervals */}
                  <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm space-y-8 col-span-1 md:col-span-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40">Range Stability & Uncertainty</h4>
                    
                    <div className="relative h-48 flex flex-col justify-center gap-12">
                      {/* Scale Max Calculation */}
                      {(() => {
                        const maxVal = Math.max(
                          analysisConfig.currentApprovedRange.upper + 20,
                          results?.uncertainty.upperInterval[1]! + 20,
                          100
                        );
                        const scaleStep = Math.ceil(maxVal / 4 / 10) * 10;
                        const finalMax = scaleStep * 4;

                        return (
                          <>
                            {/* Current Range */}
                            <div className="relative">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-black/30">Current Approved</span>
                                <span className="text-xs font-bold">{analysisConfig.currentApprovedRange.lower} – {analysisConfig.currentApprovedRange.upper}s</span>
                              </div>
                              <div className="h-4 bg-slate-100 rounded-full relative overflow-hidden">
                                <div 
                                  className="absolute h-full bg-slate-400/40" 
                                  style={{ 
                                    left: `${(analysisConfig.currentApprovedRange.lower / finalMax) * 100}%`, 
                                    width: `${((analysisConfig.currentApprovedRange.upper - analysisConfig.currentApprovedRange.lower) / finalMax) * 100}%` 
                                  }} 
                                />
                              </div>
                            </div>

                            {/* Proposed Range with CI */}
                            <div className="relative">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600/60">Proposed New (with 95% CI)</span>
                                <span className="text-xs font-bold text-emerald-700">{activeResults?.proposedRange.lower} – {activeResults?.proposedRange.upper}s</span>
                              </div>
                              <div className="h-4 bg-emerald-50 rounded-full relative">
                                {/* Confidence Intervals (Shadows) */}
                                <div 
                                  className="absolute h-8 -top-2 bg-emerald-200/30 rounded-sm blur-[2px]" 
                                  style={{ 
                                    left: `${(activeResults?.uncertainty.lowerInterval[0]! / finalMax) * 100}%`, 
                                    width: `${((activeResults?.uncertainty.lowerInterval[1]! - activeResults?.uncertainty.lowerInterval[0]!) / finalMax) * 100}%` 
                                  }} 
                                />
                                <div 
                                  className="absolute h-8 -top-2 bg-emerald-200/30 rounded-sm blur-[2px]" 
                                  style={{ 
                                    left: `${(activeResults?.uncertainty.upperInterval[0]! / finalMax) * 100}%`, 
                                    width: `${((activeResults?.uncertainty.upperInterval[1]! - activeResults?.uncertainty.upperInterval[0]!) / finalMax) * 100}%` 
                                  }} 
                                />
                                
                                {/* Main Range */}
                                <div 
                                  className="absolute h-full bg-emerald-500" 
                                  style={{ 
                                    left: `${(activeResults?.proposedRange.lower! / finalMax) * 100}%`, 
                                    width: `${((activeResults?.proposedRange.upper! - activeResults?.proposedRange.lower!) / finalMax) * 100}%` 
                                  }} 
                                />
                              </div>
                            </div>
                            
                            {/* Scale */}
                            <div className="absolute bottom-0 w-full flex justify-between text-[8px] font-bold text-black/20 uppercase tracking-widest pt-4 border-t border-black/5">
                              <span>0s</span>
                              <span>{scaleStep}s</span>
                              <span>{scaleStep * 2}s</span>
                              <span>{scaleStep * 3}s</span>
                              <span>{finalMax}s</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Regression Visualization */}
                  <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h4 className="text-sm font-bold uppercase tracking-widest text-black/80">Regression Analysis</h4>
                        <p className="text-xs text-black/40">Correlation between Anti-Xa and New Lot APTT.</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1">Correlation (R²)</p>
                        <p className="text-xl font-bold text-black">{(activeResults?.regressionModel.r2 || 0).toFixed(3)}</p>
                      </div>
                    </div>
                    {activeResults && (
                      <RegressionVisualization 
                        data={rawData} 
                        results={activeResults} 
                        config={analysisConfig} 
                      />
                    )}
                  </div>

                  {/* Simulation Tool */}
                  <div className="lg:col-span-3 bg-white p-8 rounded-[32px] border border-black/5 shadow-sm">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h4 className="text-sm font-bold uppercase tracking-widest text-black/80">Proposed Range Simulation</h4>
                        <p className="text-xs text-black/40">Adjust limits to see real-time impact on misclassification and risk.</p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => activeResults && setSimulatedRange(activeResults.proposedRange)}
                          className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-[#F5F5F4] rounded-full hover:bg-black/5 transition-colors"
                        >
                          Reset to Proposed
                        </button>
                        <button 
                          onClick={() => setSimulatedRange(analysisConfig.currentApprovedRange)}
                          className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-[#F5F5F4] rounded-full hover:bg-black/5 transition-colors"
                        >
                          Reset to Current
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-center">
                      <div className="space-y-4">
                        <label className="text-[10px] uppercase font-bold text-black/40 block">Simulation Lower Limit</label>
                        <input 
                          type="number" 
                          value={simulatedRange?.lower || activeResults?.proposedRange.lower}
                          onChange={(e) => setSimulatedRange(prev => ({ ...prev!, lower: parseFloat(e.target.value) || 0 }))}
                          className="w-full bg-[#F5F5F4] border-none rounded-xl p-4 font-semibold text-xl focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="space-y-4">
                        <label className="text-[10px] uppercase font-bold text-black/40 block">Simulation Upper Limit</label>
                        <input 
                          type="number" 
                          value={simulatedRange?.upper || activeResults?.proposedRange.upper}
                          onChange={(e) => setSimulatedRange(prev => ({ ...prev!, upper: parseFloat(e.target.value) || 0 }))}
                          className="w-full bg-[#F5F5F4] border-none rounded-xl p-4 font-semibold text-xl focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="md:col-span-2 bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest mb-1">Simulated Risk Score</p>
                          <p className="text-3xl font-bold text-emerald-900">{simulatedResults?.weightedScore.toFixed(1)} <span className="text-sm font-medium opacity-40">Weighted</span></p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest mb-1">Improvement</p>
                          <p className={cn(
                            "text-xl font-bold",
                            (simulatedResults?.vsCurrent.weightedImprovement || 0) > 0 ? "text-emerald-600" : "text-red-600"
                          )}>
                            {(simulatedResults?.vsCurrent.weightedImprovement || 0) > 0 ? '+' : ''}
                            {simulatedResults?.vsCurrent.weightedImprovement.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : dashboardTab === 'technical' ? (
                <div className="space-y-8">
                  {/* Technical Summary View */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {/* Regression Method */}
                    <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-4">Regression Engine</h4>
                      <div className="space-y-2">
                        <p className="text-sm font-bold text-black">{activeResults?.regressionMethod}</p>
                        <p className="text-[10px] text-black/40 leading-relaxed">
                          {activeResults?.regressionMethod === 'Weighted Deming' 
                            ? 'Weights assigned per-sample based on MU band configuration.' 
                            : `Standard Deming used. ${activeResults?.regressionReason || ''}`}
                        </p>
                      </div>
                    </div>

                    {/* Comparison Row Counts */}
                    <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-4">Row Counts by Comparison</h4>
                      <div className="space-y-3">
                        {activeResults?.summary.comparisons.map(c => (
                          <div key={c.id} className="flex justify-between items-center">
                            <span className={cn("text-xs", c.isPrimary ? "font-bold text-black" : "text-black/60")}>
                              {c.label} {c.isPrimary && "(Primary)"}
                            </span>
                            <span className="text-xs font-mono font-bold">{c.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* QC & Censoring */}
                    <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-4">QC & Censoring Summary</h4>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-black/60">Total Usable Rows</span>
                          <span className="text-xs font-mono font-bold">{activeResults?.summary.qc.totalUsable}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-black/60">Capped/Censored Values</span>
                          <span className="text-xs font-mono font-bold text-amber-600">{activeResults?.summary.qc.censoredCount}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-black/60">Flagged (but included)</span>
                          <span className="text-xs font-mono font-bold text-amber-600">{activeResults?.summary.qc.flaggedUsableCount}</span>
                        </div>
                      </div>
                    </div>

                    {/* Paired Differences */}
                    <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-4">Paired Differences (Current - New)</h4>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-black/60">Mean Difference</span>
                          <span className="text-xs font-mono font-bold">{activeResults?.summary.differences.mean.toFixed(2)}s</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-black/60">Median Difference</span>
                          <span className="text-xs font-mono font-bold">{activeResults?.summary.differences.median.toFixed(2)}s</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-black/60">Mean Absolute Diff</span>
                          <span className="text-xs font-mono font-bold">{activeResults?.summary.differences.absMean.toFixed(2)}s</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-black/60">Std Deviation (Diff)</span>
                          <span className="text-xs font-mono font-bold">{activeResults?.summary.differences.stdDev.toFixed(2)}s</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Distribution Tables */}
                  <div className="bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
                    <div className="px-8 py-6 border-b border-black/5 bg-black/[0.01]">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-black/40">Distribution Statistics</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-black/[0.02] border-b border-black/5">
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40">Metric</th>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Anti-Xa (IU/mL)</th>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">APTT New (s)</th>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">APTT Current (s)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          <tr>
                            <td className="px-8 py-4 text-xs font-bold text-black/60">Mean</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.xa.mean.toFixed(3)}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttNew.mean.toFixed(1)}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttCurrent.mean.toFixed(1)}</td>
                          </tr>
                          <tr>
                            <td className="px-8 py-4 text-xs font-bold text-black/60">Median</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.xa.median.toFixed(3)}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttNew.median.toFixed(1)}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttCurrent.median.toFixed(1)}</td>
                          </tr>
                          <tr>
                            <td className="px-8 py-4 text-xs font-bold text-black/60">Min</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.xa.min.toFixed(3)}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttNew.min.toFixed(1)}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttCurrent.min.toFixed(1)}</td>
                          </tr>
                          <tr>
                            <td className="px-8 py-4 text-xs font-bold text-black/60">Max</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.xa.max.toFixed(3)}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttNew.max.toFixed(1)}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttCurrent.max.toFixed(1)}</td>
                          </tr>
                          <tr>
                            <td className="px-8 py-4 text-xs font-bold text-black/60">N (Included)</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.xa.count}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttNew.count}</td>
                            <td className="px-8 py-4 text-xs font-mono text-center">{activeResults?.summary.apttCurrent.count}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {activeResults && <TemporalSignalPanel results={activeResults} />}
                  {activeResults && <MethodRobustnessPanel results={activeResults} />}

                  <div className="bg-amber-50 border border-amber-100 p-6 rounded-2xl flex gap-4">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 shrink-0">
                      <Beaker size={20} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-amber-900 mb-1">Statistical Engine Note</h4>
                      <p className="text-xs text-amber-800/70 leading-relaxed">
                        The current analysis uses a modular architecture. Regression models and misclassification logic are currently using placeholder calculations 
                        while the core statistical engine is being finalised. Summary statistics above are calculated from the actual processed dataset.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Side-by-Side Range Comparison */}
                    <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm space-y-6">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40">Proposed Range Comparison</h4>
                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-4">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600/60">MU-Aware (Weighted)</p>
                          <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                            <p className="text-3xl font-bold text-blue-900">{results?.proposedRange.lower} – {results?.proposedRange.upper}s</p>
                            <p className="text-[10px] font-bold text-blue-600/40 uppercase mt-1">Width: {(results!.proposedRange.upper - results!.proposedRange.lower).toFixed(1)}s</p>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600/60">Standard (Unweighted)</p>
                          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <p className="text-3xl font-bold text-slate-900">{resultsNoMU?.proposedRange.lower} – {resultsNoMU?.proposedRange.upper}s</p>
                            <p className="text-[10px] font-bold text-slate-600/40 uppercase mt-1">Width: {(resultsNoMU!.proposedRange.upper - resultsNoMU!.proposedRange.lower).toFixed(1)}s</p>
                          </div>
                        </div>
                      </div>
                      <div className="pt-6 border-t border-black/5">
                        <p className="text-xs text-black/60 leading-relaxed">
                          {(() => {
                            const muWidth = results!.proposedRange.upper - results!.proposedRange.lower;
                            const stdWidth = resultsNoMU!.proposedRange.upper - resultsNoMU!.proposedRange.lower;
                            const diff = Math.abs(muWidth - stdWidth);
                            const action = diff < 0.1 ? 'maintains a similar' : muWidth < stdWidth ? 'tightens the' : 'widens the';
                            return (
                              <>
                                The MU-Aware engine {action} therapeutic range by <span className="font-bold">{diff.toFixed(1)}s</span> compared to standard analysis.
                              </>
                            );
                          })()}
                        </p>
                      </div>
                    </div>

                    {/* Risk Profile Comparison */}
                    <div className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm space-y-6">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40">Risk Profile Comparison</h4>
                      <div className="space-y-6">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-black/60">Weighted Risk Score (MU-Aware)</span>
                          <span className="text-xl font-bold text-blue-600">{results?.misclassification.proposed.weightedScore}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-black/60">Weighted Risk Score (Standard)</span>
                          <span className="text-xl font-bold text-slate-600">{resultsNoMU?.misclassification.proposed.weightedScore}</span>
                        </div>
                        <div className="pt-4 border-t border-black/5">
                          <div className="flex items-center gap-2 text-emerald-600">
                            <CheckCircle2 size={16} />
                            <p className="text-xs font-bold uppercase tracking-widest">
                              MU-Aware analysis provides a {((resultsNoMU!.misclassification.proposed.weightedScore - results!.misclassification.proposed.weightedScore) / resultsNoMU!.misclassification.proposed.weightedScore * 100).toFixed(1)}% safer risk profile.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Detailed Metrics Table */}
                  <div className="bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
                    <div className="px-8 py-6 border-b border-black/5 bg-black/[0.01]">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-black/40">Comparative Metrics Audit</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-black/[0.02] border-b border-black/5">
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40">Metric</th>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">MU-Aware (Proposed)</th>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Standard (Proposed)</th>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Delta</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          {[
                            { label: 'Lower Limit (s)', mu: results?.proposedRange.lower, std: resultsNoMU?.proposedRange.lower },
                            { label: 'Upper Limit (s)', mu: results?.proposedRange.upper, std: resultsNoMU?.proposedRange.upper },
                            { label: 'Range Width (s)', mu: results!.proposedRange.upper - results!.proposedRange.lower, std: resultsNoMU!.proposedRange.upper - resultsNoMU!.proposedRange.lower },
                            { label: 'Misclassification Rate (%)', mu: results?.misclassification.proposed.rate, std: resultsNoMU?.misclassification.proposed.rate },
                            { label: 'Weighted Risk Score', mu: results?.misclassification.proposed.weightedScore, std: resultsNoMU?.misclassification.proposed.weightedScore },
                          ].map((row, i) => (
                            <tr key={i}>
                              <td className="px-8 py-4 text-xs font-bold text-black/60">{row.label}</td>
                              <td className="px-8 py-4 text-xs font-mono text-center font-bold text-blue-600">{row.mu?.toFixed(1)}</td>
                              <td className="px-8 py-4 text-xs font-mono text-center">{row.std?.toFixed(1)}</td>
                              <td className={cn(
                                "px-8 py-4 text-xs font-mono text-center font-bold",
                                (row.mu! - row.std!) === 0 ? "text-black/20" : (row.mu! - row.std!) > 0 ? "text-red-500" : "text-emerald-500"
                              )}>
                                {(row.mu! - row.std!) > 0 ? '+' : ''}{(row.mu! - row.std!).toFixed(1)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      
      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-black/5 flex flex-col md:flex-row justify-between items-center gap-6 opacity-40 no-print">
        <p className="text-xs font-medium">© 2026 APTT Therapeutic Range Verifier. All calculations performed locally.</p>
        <div className="flex gap-6 text-xs font-bold uppercase tracking-widest">
          <a href="#" className="hover:text-black transition-colors">Documentation</a>
          <a href="#" className="hover:text-black transition-colors">Methodology</a>
          <a href="#" className="hover:text-black transition-colors">Support</a>
        </div>
      </footer>

      <ReportEditorModal 
        isOpen={showReportEditor}
        onClose={() => setShowReportEditor(false)}
        commentary={reportCommentary}
        onUpdate={setReportCommentary}
        onPrint={() => {
          setShowReportEditor(false);
          setTimeout(() => window.print(), 100);
        }}
      />

      {activeResults && (
        <PrintReport 
          results={activeResults}
          config={analysisConfig}
          commentary={reportCommentary}
          rawData={rawData}
          comparisons={comparisons}
        />
      )}
    </div>
  );
}

function ReportEditorModal({ 
  isOpen, 
  onClose, 
  commentary, 
  onUpdate,
  onPrint
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  commentary: ReportCommentary;
  onUpdate: (newCommentary: ReportCommentary) => void;
  onPrint: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm no-print">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-8 border-b border-black/5 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Report Commentary</h2>
            <p className="text-xs text-black/40 uppercase font-bold tracking-widest mt-1">Customize narrative sections before generation</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          <div className="space-y-4">
            <label className="text-[10px] uppercase font-bold text-black/40 tracking-widest">Executive Summary</label>
            <textarea 
              value={commentary.executiveSummary}
              onChange={(e) => onUpdate({ ...commentary, executiveSummary: e.target.value })}
              className="w-full h-32 bg-[#F5F5F4] border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-black transition-all"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <label className="text-[10px] uppercase font-bold text-black/40 tracking-widest">Medical Director Notes</label>
              <textarea 
                value={commentary.medicalDirectorNotes}
                onChange={(e) => onUpdate({ ...commentary, medicalDirectorNotes: e.target.value })}
                className="w-full h-48 bg-[#F5F5F4] border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-black transition-all"
              />
            </div>
            <div className="space-y-4">
              <label className="text-[10px] uppercase font-bold text-black/40 tracking-widest">Technical & QC Notes</label>
              <textarea 
                value={commentary.technicalNotes}
                onChange={(e) => onUpdate({ ...commentary, technicalNotes: e.target.value })}
                className="w-full h-48 bg-[#F5F5F4] border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-black transition-all"
              />
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-[10px] uppercase font-bold text-black/40 tracking-widest">Assumptions & Limitations</label>
            <textarea 
              value={commentary.limitationsNotes}
              onChange={(e) => onUpdate({ ...commentary, limitationsNotes: e.target.value })}
              className="w-full h-32 bg-[#F5F5F4] border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-black transition-all"
            />
          </div>
        </div>

        <div className="p-8 border-t border-black/5 bg-[#F5F5F4]/50 flex justify-end gap-4">
          <button 
            onClick={onClose}
            className="px-6 py-3 text-sm font-bold uppercase tracking-widest text-black/40 hover:text-black transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={onPrint}
            className="bg-black text-white font-bold py-3 px-10 rounded-2xl hover:bg-black/80 transition-all flex items-center gap-2 shadow-lg shadow-black/10"
          >
            <FileText size={20} /> Finalize & Print
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function PrintReport({ 
  results, 
  config, 
  commentary, 
  rawData, 
  comparisons 
}: { 
  results: AnalysisResults; 
  config: AnalysisConfig; 
  commentary: ReportCommentary;
  rawData: ProcessedDataRow[];
  comparisons: Comparison[];
}) {
  return (
    <div className="print-only bg-white text-black p-8 font-sans">
      {/* Medical Director Report */}
      <section className="space-y-8">
        <div className="flex justify-between items-start border-b-2 border-black pb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tighter">Medical Director Validation Report</h1>
            <p className="text-sm font-bold uppercase tracking-widest text-black/60">APTT Therapeutic Range Verification</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-widest">Date: {new Date().toLocaleDateString()}</p>
            <p className="text-xs font-bold uppercase tracking-widest">Status: FINAL</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8">
          <div className="col-span-2 space-y-6">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3 border-b border-black/10 pb-1">Executive Summary</h2>
              <p className="text-sm leading-relaxed">{commentary.executiveSummary}</p>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="bg-black/5 p-4 rounded-2xl">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2">Decision Category</h3>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-4 h-4 rounded-full",
                    results.decision === 'No change' ? "bg-emerald-500" :
                    results.decision === 'Minor change' ? "bg-amber-500" : "bg-red-500"
                  )} />
                  <span className="text-lg font-bold uppercase tracking-tight">
                    {results.decision}
                  </span>
                </div>
              </div>
              <div className="bg-black/5 p-4 rounded-2xl">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2">Confidence Level</h3>
                <span className="text-lg font-bold uppercase tracking-tight">{results.confidence}</span>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3 border-b border-black/10 pb-1">Proposed Range Shift</h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 border border-black/5 rounded-xl">
                  <p className="text-[8px] font-bold uppercase text-black/40">Lower Limit</p>
                  <p className="text-xl font-bold">{results.shifts.lower > 0 ? '+' : ''}{results.shifts.lower.toFixed(1)}s</p>
                </div>
                <div className="text-center p-3 border border-black/5 rounded-xl">
                  <p className="text-[8px] font-bold uppercase text-black/40">Upper Limit</p>
                  <p className="text-xl font-bold">{results.shifts.upper > 0 ? '+' : ''}{results.shifts.upper.toFixed(1)}s</p>
                </div>
                <div className="text-center p-3 border border-black/5 rounded-xl">
                  <p className="text-[8px] font-bold uppercase text-black/40">Width Shift</p>
                  <p className="text-xl font-bold">
                    {results.shifts.width > 0 ? '+' : ''}{results.shifts.width.toFixed(1)}s
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-1 space-y-6">
            <div className="bg-black p-6 rounded-[32px] text-white">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-4">Proposed Range</h3>
              <div className="text-4xl font-bold tracking-tighter mb-2">
                {results.proposedRange.lower} – {results.proposedRange.upper}s
              </div>
              <p className="text-[10px] font-medium text-white/60">Optimized for {config.therapeuticXaRange.lower}-{config.therapeuticXaRange.upper} IU/mL anti-Xa</p>
            </div>

            <div className="space-y-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-black/40">Impact Summary</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-black/60">Misclassification</span>
                  <span className="font-bold">{(results.misclassification.proposed.rate).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-black/60">Risk Score</span>
                  <span className="font-bold">{results.misclassification.proposed.weightedScore.toFixed(1)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-black/60">Improvement</span>
                  <span className="font-bold">{results.misclassification.improvement.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3 border-b border-black/10 pb-1">Medical Director Commentary</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{commentary.medicalDirectorNotes}</p>
        </div>

        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3 border-b border-black/10 pb-1">Assumptions & Limitations</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{commentary.limitationsNotes}</p>
        </div>
      </section>

      <div className="page-break" />

      {/* Technical Report */}
      <section className="space-y-8 pt-8">
        <div className="flex justify-between items-start border-b-2 border-black pb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tighter">Technical Validation Supplement</h1>
            <p className="text-sm font-bold uppercase tracking-widest text-black/60">Statistical Analysis & QC Summary</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-12">
          <div className="space-y-6">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3 border-b border-black/10 pb-1">Methodology</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{commentary.technicalNotes}</p>
            </div>

            <div className="space-y-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-black/40">Regression Statistics</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-black/5">
                  <tr>
                    <td className="py-2 text-black/60">Correlation (R²)</td>
                    <td className="py-2 font-bold text-right">{results.regressionModel.r2.toFixed(4)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-black/60">Slope</td>
                    <td className="py-2 font-bold text-right">{results.regressionModel.slope.toFixed(4)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-black/60">Intercept</td>
                    <td className="py-2 font-bold text-right">{results.regressionModel.intercept.toFixed(4)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-black/60">Method</td>
                    <td className="py-2 font-bold text-right">{results.regressionMethod}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3 border-b border-black/10 pb-1">Data Quality Summary</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-black/5 rounded-xl">
                  <p className="text-[8px] font-bold uppercase text-black/40">Total Points</p>
                  <p className="text-lg font-bold">{rawData.length}</p>
                </div>
                <div className="p-3 bg-black/5 rounded-xl">
                  <p className="text-[8px] font-bold uppercase text-black/40">Usable Points</p>
                  <p className="text-lg font-bold">{results.summary.qc.totalUsable}</p>
                </div>
                <div className="p-3 bg-black/5 rounded-xl">
                  <p className="text-[8px] font-bold uppercase text-black/40">Excluded Points</p>
                  <p className="text-lg font-bold text-red-600">{rawData.filter(d => d.excluded).length}</p>
                </div>
                <div className="p-3 bg-black/5 rounded-xl">
                  <p className="text-[8px] font-bold uppercase text-black/40">Primary Comparison</p>
                  <p className="text-xs font-bold truncate">{comparisons.find(c => c.isPrimary)?.label || 'None'}</p>
                </div>
              </div>
            </div>

            {config.includeMU && (
              <div className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-black/40">Uncertainty of Measurement (Therapeutic Band)</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 border border-black/5 rounded-lg text-center">
                    <p className="text-[8px] font-bold text-black/40 uppercase">anti-Xa</p>
                    <p className="text-xs font-bold">{config.muBands.xa[1]?.value}{config.muUnits.xa === 'CV%' ? '%' : ''}</p>
                  </div>
                  <div className="p-2 border border-black/5 rounded-lg text-center">
                    <p className="text-[8px] font-bold text-black/40 uppercase">APTT Cur</p>
                    <p className="text-xs font-bold">{config.muBands.apttCurrent[1]?.value}{config.muUnits.apttCurrent === 'CV%' ? '%' : ''}</p>
                  </div>
                  <div className="p-2 border border-black/5 rounded-lg text-center">
                    <p className="text-[8px] font-bold text-black/40 uppercase">APTT New</p>
                    <p className="text-xs font-bold">{config.muBands.apttNew[1]?.value}{config.muUnits.apttNew === 'CV%' ? '%' : ''}</p>
                  </div>
                </div>
              </div>
            )}

            {results.temporalSignal && results.temporalSignal.possible && (
              <div className="space-y-4">
                <h2 className="text-xs font-bold uppercase tracking-widest mb-3 border-b border-black/10 pb-1">Trend Analysis (Temporal Signal)</h2>
                <p className="text-sm leading-relaxed mb-4">{results.temporalSignal.interpretation}</p>
                <div className="grid grid-cols-2 gap-4">
                  {results.temporalSignal.metrics.map((m, i) => (
                    <div key={i} className="p-3 border border-black/5 rounded-xl">
                      <p className="text-[8px] font-bold uppercase text-black/40">{m.label}</p>
                      <div className="flex justify-between items-end">
                        <p className="text-lg font-bold">R² {m.r2.toFixed(3)}</p>
                        <p className="text-[10px] text-black/60">n={m.n}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3 border-b border-black/10 pb-1">Exclusion Audit</h2>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-black">
                <th className="text-left py-2">ID</th>
                <th className="text-left py-2">Reason</th>
                <th className="text-right py-2">Xa</th>
                <th className="text-right py-2">APTT New</th>
                <th className="text-right py-2">APTT Cur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {rawData.filter(d => d.excluded).slice(0, 10).map(d => (
                <tr key={d.id}>
                  <td className="py-1">{d.id}</td>
                  <td className="py-1">{d.exclusionReason}</td>
                  <td className="py-1 text-right">{d.xa}</td>
                  <td className="py-1 text-right">{d.apttNew}</td>
                  <td className="py-1 text-right">{d.apttCurrent}</td>
                </tr>
              ))}
              {rawData.filter(d => d.excluded).length > 10 && (
                <tr>
                  <td colSpan={5} className="py-1 text-center italic text-black/40">
                    ... and {rawData.filter(d => d.excluded).length - 10} more exclusions
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
