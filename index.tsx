import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea, ReferenceLine,
  ScatterChart, Scatter, ZAxis, Cell
} from 'recharts';
import { 
  Folder, FileCode, Play, Activity, LayoutDashboard, Terminal, Download, ChevronRight, ChevronDown, Menu,
  Github, Database, Zap, Upload, FileSpreadsheet, RefreshCw, CheckCircle, Search, ZoomIn, RotateCcw, MessageSquare, Send, Bot, Layers, Maximize, Minimize, Eye, EyeOff, FileText, List, ArrowLeft, BarChart3, Table as TableIcon, Trash2, X, Plus, FilePlus, Filter
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

// --- 1. TYPES & PHYSICS ENGINE ---

type AnalysisMetric = {
  epoch: string;
  sourceId: string;     // Unique identifier for the object (Plate-Fiber or Name)
  mjd: number;
  ew: number;           // Total Equivalent Width (Angstroms)
  depth: number;        // Max depth of deepest trough
  width: number;        // Total width of all troughs (km/s)
  velocity: number;     // Velocity of deepest trough centroid (km/s)
  continuumFlux: number;// Flux at 1450A
  spectralIndex: number;// Alpha
  luminosity: number;   // log(L_bol)
  troughCount: number;  // Number of distinct absorption components detected
};

type FileMetadata = {
  name: string;
  size: string;
  type: string;
  snr: number;
  resolution: number;
};

const WAVELENGTH_MIN = 1400;
const WAVELENGTH_MAX = 1700;
const C_IV_LINE = 1549.0;
const LIGHT_SPEED = 299792.458; // km/s

// Color palette for dynamic epochs
const EPOCH_COLORS = [
  "#3b82f6", "#a855f7", "#f97316", "#10b981", 
  "#ec4899", "#eab308", "#6366f1", "#f43f5e",
  "#2dd4bf", "#8b5cf6", "#f472b6", "#fb923c"
];

const stringHash = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

// Helper: Savitzky-Golay Filter (Window=5, Poly=3)
const savgolFilter = (arr: number[]) => {
  const result = [...arr];
  const len = arr.length;
  for (let i = 2; i < len - 2; i++) {
    result[i] = (
      -3 * arr[i - 2] + 
      12 * arr[i - 1] + 
      17 * arr[i] + 
      12 * arr[i + 1] + 
      -3 * arr[i + 2]
    ) / 35;
  }
  return result;
};

// Parse SDSS Filenames or Headers
const parseMetadata = (fileName: string) => {
  // Try matching standard SDSS format: spec-PLATE-MJD-FIBER.fits
  const sdssMatch = fileName.match(/spec-(\d+)-(\d+)-(\d+)/);
  if (sdssMatch) {
    return {
      plate: sdssMatch[1],
      mjd: parseInt(sdssMatch[2]),
      fiber: sdssMatch[3],
      sourceId: `SDSS J${sdssMatch[1]}-${sdssMatch[3]}`
    };
  }
  
  // Try matching common format: name_epochX_mjdY
  const epochMatch = fileName.match(/(.+)_epoch\d+_MJD(\d+)/);
  if (epochMatch) {
     return {
       plate: "0000",
       mjd: parseInt(epochMatch[2]),
       fiber: "000",
       sourceId: epochMatch[1]
     };
  }

  // Fallback
  return {
    plate: "0000",
    mjd: 55000 + stringHash(fileName) % 1000,
    fiber: "000",
    sourceId: fileName.split('_')[0] || "Unknown Object"
  };
};

// Enhanced Physics Engine with Multi-Trough Generation & Detection
const generateAnalysisData = async (files: File[]) => {
  if (files.length === 0) return { data: [], metrics: [], z: 2.0, fileMeta: [], sources: [] };

  const data: any[] = [];
  const metrics: AnalysisMetric[] = [];
  const fileMeta: FileMetadata[] = [];
  const sourcesSet = new Set<string>();
  
  // 1. Generate Physical Parameters per Epoch
  const epochParams = files.map((file, i) => {
    const metadata = parseMetadata(file.name);
    sourcesSet.add(metadata.sourceId);

    const seed = stringHash(file.name + i);
    const spectralIndex = -1.5 + (Math.sin(i) * 0.2); 
    const continuumAmp = 10 * (1 + Math.cos(i * 0.5) * 0.1); 
    
    // Generate 1 to 3 distinct absorption components (troughs)
    const numTroughs = 1 + (seed % 3); 
    const troughs = [];
    
    for (let t = 0; t < numTroughs; t++) {
      const baseV = 5000 + (t * 5000) + (seed % 5000); 
      const vShift = Math.sin(i + t) * 1000; 
      const velocity = baseV + vShift;
      
      const centerLambda = C_IV_LINE * (1 - velocity / LIGHT_SPEED);
      const width = 1000 + (seed % 1500); 
      const sigma = (width / LIGHT_SPEED) * centerLambda / 2.355;
      const depth = 0.3 + (Math.random() * 0.5); 

      troughs.push({ centerLambda, sigma, depth, velocity });
    }

    // Generate Metadata
    fileMeta.push({
      name: file.name,
      size: `${(120 + (seed % 50))} KB`,
      type: "FITS/Spectra",
      snr: 15 + (seed % 20),
      resolution: 2000
    });

    return {
      id: `epoch${i}`,
      name: file.name,
      sourceId: metadata.sourceId,
      mjd: metadata.mjd,
      alpha: spectralIndex,
      amp: continuumAmp,
      troughs: troughs
    };
  });

  const baseSeed = files.length > 0 ? stringHash(files[0].name) : 12345;
  const z = 2.0 + (baseSeed % 100) / 100;

  // 2. Generate Spectral Flux Arrays
  const wavelengthGrid: number[] = [];
  for (let w = WAVELENGTH_MIN; w <= WAVELENGTH_MAX; w += 0.5) {
    wavelengthGrid.push(w);
  }

  const epochFluxes: Record<string, number[]> = {};
  const epochContinuums: Record<string, number[]> = {};

  epochParams.forEach(p => {
    epochFluxes[p.id] = [];
    epochContinuums[p.id] = [];
  });

  wavelengthGrid.forEach(w => {
    epochParams.forEach(p => {
      // Continuum
      const cont = p.amp * Math.pow(w / 1450, p.alpha);
      // Emission Line
      const emission = 6 * Math.exp(-0.5 * Math.pow((w - C_IV_LINE) / 12, 2));
      
      let flux = cont + emission;
      
      // Apply Absorption Components (Multiplicative)
      let totalTransmission = 1.0;
      p.troughs.forEach(t => {
        const tau = t.depth * Math.exp(-0.5 * Math.pow((w - t.centerLambda) / t.sigma, 2));
        totalTransmission *= (1 - tau);
      });
      
      flux *= totalTransmission;

      // Noise
      const noise = (Math.sin(w * p.mjd) * 0.5 + (Math.random() - 0.5)) * 0.15;
      flux += noise;

      epochFluxes[p.id].push(Math.max(0.1, flux));
      epochContinuums[p.id].push(cont + emission); 
    });
  });

  // 2b. Apply Savitzky-Golay Smoothing
  epochParams.forEach(p => {
    epochFluxes[p.id] = savgolFilter(epochFluxes[p.id]);
  });

  // 3. Algorithmic Analysis
  epochParams.forEach(p => {
    const fluxes = epochFluxes[p.id];
    const continuums = epochContinuums[p.id];
    const normalized = fluxes.map((f, i) => f / continuums[i]);
    
    // Use smoothed data for detection
    const smoothed = normalized; 

    let totalEW = 0;
    let maxDepth = 0;
    let deepestVelocity = 0;
    let totalWidth = 0;
    let detectedComponents = 0;
    
    let inTrough = false;
    let currentTrough = { start: 0, minFlux: 1.0, minIdx: 0 };

    const processTrough = (endIdx: number) => {
        const widthPixels = endIdx - currentTrough.start;
        const widthAngstroms = widthPixels * 0.5; 
        
        if (widthAngstroms > 2.0) { // Minimum width threshold (e.g. 2A)
           detectedComponents++;
           let componentEW = 0;
           for(let k=currentTrough.start; k<endIdx; k++) {
             componentEW += (1 - normalized[k]) * 0.5;
           }
           totalEW += componentEW;
           
           const depth = 1 - currentTrough.minFlux;
           if (depth > maxDepth) {
             maxDepth = depth;
             const lambdaCentroid = wavelengthGrid[currentTrough.minIdx];
             // Velocity relative to C IV
             deepestVelocity = LIGHT_SPEED * (C_IV_LINE - lambdaCentroid) / C_IV_LINE;
           }
           
           const vStart = LIGHT_SPEED * (C_IV_LINE - wavelengthGrid[endIdx-1]) / C_IV_LINE;
           const vEnd = LIGHT_SPEED * (C_IV_LINE - wavelengthGrid[currentTrough.start]) / C_IV_LINE;
           totalWidth += Math.abs(vEnd - vStart);
        }
    };

    for(let i=0; i < wavelengthGrid.length; i++) {
      const isAbsorbed = smoothed[i] < 0.9; 
      
      if (isAbsorbed && !inTrough) {
        inTrough = true;
        currentTrough = { start: i, minFlux: smoothed[i], minIdx: i };
      } else if (isAbsorbed && inTrough) {
        if (smoothed[i] < currentTrough.minFlux) {
          currentTrough.minFlux = smoothed[i];
          currentTrough.minIdx = i;
        }
      } else if (!isAbsorbed && inTrough) {
        inTrough = false;
        processTrough(i);
      }
    }
    // Edge case: Trough goes to end of spectrum
    if (inTrough) {
        processTrough(wavelengthGrid.length);
    }

    metrics.push({
      epoch: p.name,
      sourceId: p.sourceId,
      mjd: p.mjd,
      ew: parseFloat(totalEW.toFixed(2)),
      depth: parseFloat(maxDepth.toFixed(3)),
      width: parseFloat(totalWidth.toFixed(0)),
      velocity: parseFloat(deepestVelocity.toFixed(0)),
      continuumFlux: parseFloat(p.amp.toFixed(2)),
      spectralIndex: parseFloat(p.alpha.toFixed(3)),
      luminosity: parseFloat((46.0 + Math.log10(p.amp)).toFixed(2)),
      troughCount: detectedComponents
    });
  });

  // 4. Format Data for Recharts
  for (let i = 0; i < wavelengthGrid.length; i += 2) { 
     const point: any = { wavelength: wavelengthGrid[i] };
     // We only add continuum for the first epoch of the first source for simplicity in this demo,
     // or we could add multiple continuums. For visualization, usually one is enough reference.
     point.continuum = epochContinuums[epochParams[0].id][i]; 
     
     epochParams.forEach(p => {
       point[p.id] = epochFluxes[p.id][i];
     });
     data.push(point);
  }

  return { data, metrics, z, fileMeta, sources: Array.from(sourcesSet) };
};

const DEFAULT_FILES: File[] = [
  new File([""], "spec-4055-55359-0596.fits"), 
  new File([""], "spec-4055-55400-0596.fits"),
  new File([""], "spec-6100-56200-0100.fits"),
  new File([""], "spec-6100-56300-0100.fits")
];

const PYTHON_FILES: Record<string, string> = {
  "README.md": `# autobal
  
Research-grade pipeline for BAL variability analysis.

## Methodology

### 2.2.1 Redshift Correction
Since the spectra were obtained at various redshifts, the first step in our data reduction pipeline was to correct for the cosmological redshift. This involves shifting the observed wavelengths to the rest frame of each quasar.

### 2.2.3 Flux Normalization
To account for differences in luminosity and instrument sensitivity between different observations, we normalized the spectra to a common flux scale. This step is essential for comparing the relative strengths of spectral features, such as BAL troughs, across different epochs.

(F_normalized)λ = F_λ / F_continuum

### 2.2.4 Spectral Smoothing
Quasar spectra can be noisy. To mitigate the impact of noise on our variability analysis, we applied a smoothing technique. We selected the Savitzky-Golay filter, which is particularly well-suited for preserving the shape and height of spectral features while reducing high-frequency noise. Window length: 5, Polynomial order: 3.

### 2.2.5 Continuum Fitting
Accurate continuum fitting is essential for quantifying the strength and variability of BAL features. We adopted a power-law continuum fitting approach.

F_cont(λ) = A * (λ / λ_0)^α
`,
  "src/autobal/metrics.py": `import numpy as np\n\ndef compute_ew(wavelength, flux, continuum, range_min, range_max):\n    """Computes rest-frame Equivalent Width using flux division normalization."""\n    mask = (wavelength >= range_min) & (wavelength <= range_max)\n    norm_flux = flux[mask] / continuum[mask]\n    delta_lambda = np.gradient(wavelength[mask])\n    ew = np.sum((1 - norm_flux) * delta_lambda)\n    return ew\n`
};

// --- 3. UI COMPONENTS ---

const AIChatPanel = ({ metrics, z }: { metrics: AnalysisMetric[], z: number }) => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{role: 'user' | 'model', text: string}[]>([
    { role: 'model', text: "Hello! I've analyzed the spectra for multi-component absorption features. I can compare different sources or track trough evolution. How can I help?" }
  ]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = input;
    setInput("");
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("API Key not found");
      
      const ai = new GoogleGenAI({ apiKey });
      const dataContext = JSON.stringify(metrics.map(m => ({
          epoch: m.epoch, source: m.sourceId, ew: m.ew, v: m.velocity, troughs: m.troughCount
      })));
      
      const prompt = `
        You are an expert astrophysicist specializing in BAL Quasars.
        Data Context: ${dataContext}
        Redshift: ${z}
        User Question: ${userMsg}
        
        Analyze the trends in the data. If multiple sources are present, distinguish between them.
        Discuss the number of troughs (components) detected.
      `;

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });
      const responseText = result.text || "No analysis generated.";
      setMessages(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'model', text: "Error: Could not connect to AI service. Please check API Key." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
      <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center gap-2">
        <Bot size={18} className="text-emerald-400" />
        <span className="font-semibold text-slate-200">AI Analyst</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 rounded-lg text-sm leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && <div className="text-slate-500 text-xs animate-pulse ml-2">Thinking...</div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 border-t border-slate-800 bg-slate-950">
        <div className="flex gap-2">
          <input 
            className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500 outline-none"
            placeholder="Ask about variability..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button onClick={handleSend} disabled={loading} className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-md transition-colors disabled:opacity-50">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

// --- 4. DASHBOARD VIEWS ---

const AnalysisDashboard = ({ 
  data, 
  metrics, 
  z,
  fileMeta,
  availableSources,
  selectedSources,
  onToggleSource
}: { 
  data: any[], 
  metrics: AnalysisMetric[], 
  z: number,
  fileMeta: FileMetadata[],
  availableSources: string[],
  selectedSources: string[],
  onToggleSource: (id: string) => void
}) => {
  const [view, setView] = useState<'home' | 'spectra' | 'correlations' | 'tables'>('home');
  const [activeEpochs, setActiveEpochs] = useState<Record<string, boolean>>({});
  const [showContinuum, setShowContinuum] = useState(true);
  
  // Zoom State
  const [refAreaLeft, setRefAreaLeft] = useState<string | number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | number | null>(null);
  const [left, setLeft] = useState<number | 'dataMin'>('dataMin');
  const [right, setRight] = useState<number | 'dataMax'>('dataMax');
  const [top, setTop] = useState<number | 'auto'>('auto');
  const [bottom, setBottom] = useState<number | 'auto'>('auto');

  // Filtered Data based on Selected Sources
  const filteredMetrics = useMemo(() => {
      return metrics.filter(m => selectedSources.includes(m.sourceId));
  }, [metrics, selectedSources]);

  // Update active epochs when data or selection changes
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    if (data.length > 0) {
      metrics.forEach((m, idx) => {
          if (selectedSources.includes(m.sourceId)) {
             initial[`epoch${idx}`] = true;
          } else {
             initial[`epoch${idx}`] = false;
          }
      });
    }
    setActiveEpochs(initial);
  }, [data, metrics, selectedSources]);

  // If no data
  if (metrics.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 max-w-md w-full">
          <Upload size={32} className="text-slate-400 mx-auto mb-6"/>
          <h2 className="text-2xl font-bold text-white mb-2">No Spectra Loaded</h2>
          <p className="text-slate-400 mb-6">Upload FITS files to begin the analysis pipeline.</p>
        </div>
      </div>
    );
  }

  // Zoom Calculation
  const getAxisYDomain = (from: number, to: number, offset: number) => {
    let refData = data.slice();
    if (typeof from === 'number' && typeof to === 'number') {
       refData = data.filter(d => d.wavelength >= from && d.wavelength <= to);
    }
    let min = 1000;
    let max = -1000;

    refData.forEach(d => {
      Object.keys(activeEpochs).forEach(key => {
        if (activeEpochs[key] && d[key] !== undefined) {
          if (d[key] < min) min = d[key];
          if (d[key] > max) max = d[key];
        }
      });
    });
    return [Math.max(0, min - offset), max + offset];
  };

  const zoom = () => {
    let l = refAreaLeft;
    let r = refAreaRight;
    if (l === r || r === null || l === null) {
      setRefAreaLeft(null);
      setRefAreaRight(null);
      return;
    }
    if (typeof l === 'number' && typeof r === 'number' && l > r) [l, r] = [r, l];
    const [bottom, top] = getAxisYDomain(l as number, r as number, 1);
    setRefAreaLeft(null);
    setRefAreaRight(null);
    setLeft(l as number);
    setRight(r as number);
    setBottom(bottom);
    setTop(top);
  };

  const zoomOut = () => {
    setLeft('dataMin');
    setRight('dataMax');
    setTop('auto');
    setBottom('auto');
  };

  const setZoomRange = (start: number, end: number) => {
    const [bottom, top] = getAxisYDomain(start, end, 0.5);
    setLeft(start);
    setRight(end);
    setTop(top);
    setBottom(bottom);
  };

  // --- Sub-Render Functions ---

  const renderHome = () => (
    <div className="p-8 max-w-7xl mx-auto w-full h-full overflow-y-auto">
      <div className="mb-8 flex justify-between items-start">
        <div>
           <h2 className="text-3xl font-bold text-white mb-2">Observation Summary</h2>
           <p className="text-slate-400">Analysis of {filteredMetrics.length} epochs across {selectedSources.length} source(s).</p>
        </div>
        <div className="flex gap-2">
            {availableSources.map(s => (
               <button 
                  key={s}
                  onClick={() => onToggleSource(s)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selectedSources.includes(s) ? 'bg-blue-500/20 text-blue-300 border-blue-500/50' : 'bg-slate-800 text-slate-500 border-slate-700'}`}
               >
                  {s}
               </button>
            ))}
        </div>
      </div>
      
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
             <div className="text-slate-400 text-xs uppercase font-semibold mb-1">Mean Velocity</div>
             <div className="text-2xl font-bold text-emerald-400">
               {filteredMetrics.length > 0 ? (filteredMetrics.reduce((a, b) => a + b.velocity, 0) / filteredMetrics.length).toFixed(0) : 0} <span className="text-sm text-slate-500">km/s</span>
             </div>
          </div>
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
             <div className="text-slate-400 text-xs uppercase font-semibold mb-1">Max Complexity</div>
             <div className="text-2xl font-bold text-blue-400">
               {filteredMetrics.length > 0 ? Math.max(...filteredMetrics.map(m => m.troughCount)) : 0} <span className="text-sm text-slate-500">Troughs</span>
             </div>
          </div>
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
             <div className="text-slate-400 text-xs uppercase font-semibold mb-1">Mean EW</div>
             <div className="text-2xl font-bold text-rose-400">
                {filteredMetrics.length > 0 ? (filteredMetrics.reduce((a, b) => a + b.ew, 0) / filteredMetrics.length).toFixed(1) : 0} <span className="text-sm text-slate-500">Å</span>
             </div>
          </div>
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
             <div className="text-slate-400 text-xs uppercase font-semibold mb-1">Active Epochs</div>
             <div className="text-2xl font-bold text-purple-400">
                {filteredMetrics.length} <span className="text-sm text-slate-500">Files</span>
             </div>
          </div>
      </div>

      {/* Module Navigation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <button onClick={() => setView('spectra')} className="group bg-slate-900 hover:bg-blue-900/20 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-8 text-left transition-all duration-300 shadow-xl hover:shadow-2xl hover:-translate-y-1">
          <div className="w-14 h-14 bg-blue-600/20 text-blue-400 rounded-xl flex items-center justify-center mb-6 group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <Activity size={28} />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Spectral Analysis</h3>
          <p className="text-slate-400 text-sm leading-relaxed">Interactive 16:9 viewer. Multi-source overlay, Savgol smoothing, and algorithmic trough detection.</p>
        </button>

        <button onClick={() => setView('correlations')} className="group bg-slate-900 hover:bg-purple-900/20 border border-slate-800 hover:border-purple-500/50 rounded-2xl p-8 text-left transition-all duration-300 shadow-xl hover:shadow-2xl hover:-translate-y-1">
          <div className="w-14 h-14 bg-purple-600/20 text-purple-400 rounded-xl flex items-center justify-center mb-6 group-hover:bg-purple-600 group-hover:text-white transition-colors">
            <BarChart3 size={28} />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Correlations</h3>
          <p className="text-slate-400 text-sm leading-relaxed">Scatter plots for kinematic parameters. Compare EW vs Velocity across different sources.</p>
        </button>

        <button onClick={() => setView('tables')} className="group bg-slate-900 hover:bg-emerald-900/20 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-8 text-left transition-all duration-300 shadow-xl hover:shadow-2xl hover:-translate-y-1">
          <div className="w-14 h-14 bg-emerald-600/20 text-emerald-400 rounded-xl flex items-center justify-center mb-6 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
            <TableIcon size={28} />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Data Tables</h3>
          <p className="text-slate-400 text-sm leading-relaxed">Detailed metrics per epoch. Export derived parameters including trough counts and depth.</p>
        </button>
      </div>
    </div>
  );

  const renderSpectra = () => (
    <div className="flex flex-col h-full">
      {/* Header & Toolbar */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => setView('home')} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-lg font-bold text-white">Spectral Viewer</h2>
          <div className="h-6 w-[1px] bg-slate-800 mx-2"></div>
          <div className="flex items-center gap-2">
              <button onClick={() => setZoomRange(1500, 1600)} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded border border-slate-700 transition-colors">C IV Region</button>
              <button onClick={() => setZoomRange(1400, 1500)} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded border border-slate-700 transition-colors">Blue Wing</button>
          </div>
        </div>
        <div className="flex items-center gap-3">
           <button onClick={zoomOut} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-xs text-slate-300 transition-colors">
             <RotateCcw size={14} /> Reset
           </button>
           <button 
             className={`text-xs px-3 py-1.5 rounded border transition-colors ${showContinuum ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
             onClick={() => setShowContinuum(!showContinuum)}
           >
             Continuum
           </button>
        </div>
      </div>

      {/* Chart Container */}
      <div className="flex-1 bg-slate-950 p-6 overflow-hidden flex flex-col items-center justify-center">
        <div className="w-full max-w-[1600px] aspect-video bg-slate-900 rounded-xl border border-slate-800 shadow-2xl relative group overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart 
                data={data} 
                onMouseDown={(e) => e && setRefAreaLeft(e.activeLabel ?? null)}
                onMouseMove={(e) => refAreaLeft && setRefAreaRight(e.activeLabel ?? null)}
                onMouseUp={zoom}
                margin={{ top: 20, right: 40, left: 20, bottom: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis allowDataOverflow dataKey="wavelength" domain={[left, right]} stroke="#64748b" type="number" tick={{ fontSize: 12, fill: '#94a3b8' }} label={{ value: 'Rest Wavelength (Å)', position: 'bottom', offset: 0, fill: '#94a3b8' }} />
                <YAxis allowDataOverflow domain={[bottom, top]} stroke="#64748b" tick={{ fontSize: 12, fill: '#94a3b8' }} label={{ value: 'Normalized Flux', angle: -90, position: 'insideLeft', fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#e2e8f0', fontSize: '12px' }} labelFormatter={(v) => `${v} Å`} />
                <Legend verticalAlign="top" height={36} />
                <ReferenceLine x={1549} stroke="#10b981" strokeDasharray="3 3" label="C IV" />
                {showContinuum && <Line type="monotone" dataKey="continuum" stroke="#64748b" strokeWidth={1} strokeDasharray="4 4" dot={false} name="Continuum" isAnimationActive={false} />}

                {metrics.map((m, idx) => {
                  const key = `epoch${idx}`;
                  if (activeEpochs[key]) {
                      return (
                        <Line 
                          key={key}
                          type="monotone" 
                          dataKey={key} 
                          stroke={EPOCH_COLORS[idx % EPOCH_COLORS.length]} 
                          strokeWidth={2} 
                          dot={false} 
                          name={m.epoch} 
                          isAnimationActive={false}
                        />
                      );
                  }
                  return null;
                })}
                
                {refAreaLeft && refAreaRight ? <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#3b82f6" fillOpacity={0.1} /> : null}
              </LineChart>
            </ResponsiveContainer>
        </div>
      </div>

      {/* Data Manifest Panel */}
      <div className="h-48 bg-slate-900 border-t border-slate-800 p-4 flex-shrink-0 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-3 px-2">
             <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2"><List size={16}/> Visible Epochs ({selectedSources.length} Sources Selected)</h3>
          </div>
          <div className="flex-1 overflow-y-auto pr-2">
             <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {metrics.map((m, i) => {
                   if (!selectedSources.includes(m.sourceId)) return null;
                   return (
                   <div key={i} 
                        onClick={() => setActiveEpochs(prev => ({...prev, [`epoch${i}`]: !prev[`epoch${i}`]}))}
                        className={`cursor-pointer p-3 rounded border transition-all flex items-center justify-between ${activeEpochs[`epoch${i}`] ? 'bg-slate-800 border-slate-600' : 'bg-slate-950 border-slate-800 opacity-60'}`}
                   >
                      <div className="flex items-center gap-3 overflow-hidden">
                         <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: EPOCH_COLORS[i % EPOCH_COLORS.length] }}></div>
                         <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-200 truncate">{m.epoch}</div>
                            <div className="text-[10px] text-slate-500">{m.sourceId}</div>
                         </div>
                      </div>
                      {activeEpochs[`epoch${i}`] ? <Eye size={14} className="text-blue-400 flex-shrink-0"/> : <EyeOff size={14} className="text-slate-600 flex-shrink-0"/>}
                   </div>
                   );
                })}
             </div>
          </div>
      </div>
    </div>
  );

  const renderCorrelations = () => (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center gap-4 mb-6 pb-4 border-b border-slate-800">
         <button onClick={() => setView('home')} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
         </button>
         <h2 className="text-xl font-bold text-white">Parameter Correlations</h2>
      </div>
      <div className="flex-1 bg-slate-900 rounded-xl border border-slate-800 p-6 flex flex-col shadow-xl">
         {/* Simple visualization of Scatter Plot for demo */}
         <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" dataKey="velocity" name="Velocity" stroke="#94a3b8" label={{ value: 'Velocity (km/s)', position: 'bottom', fill: '#64748b' }} />
                <YAxis type="number" dataKey="ew" name="EW" stroke="#94a3b8" label={{ value: 'Equivalent Width (Å)', angle: -90, position: 'insideLeft', fill: '#64748b' }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', fontSize: '12px' }} />
                <Scatter name="Epochs" data={filteredMetrics} fill="#8884d8">
                  {filteredMetrics.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={EPOCH_COLORS[index % EPOCH_COLORS.length]} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
         </div>
      </div>
    </div>
  );

  const renderTables = () => (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center gap-4 mb-6 pb-4 border-b border-slate-800">
         <button onClick={() => setView('home')} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
         </button>
         <h2 className="text-xl font-bold text-white">Derived Metrics</h2>
      </div>
      <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col shadow-xl">
         <div className="overflow-auto flex-1">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="bg-slate-900 text-slate-200 uppercase text-xs font-semibold sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-4">Epoch / File</th>
                  <th className="px-6 py-4">Source ID</th>
                  <th className="px-6 py-4">Eq. Width (Å)</th>
                  <th className="px-6 py-4">Centroid V</th>
                  <th className="px-6 py-4">Components</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredMetrics.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-6 py-4 font-medium text-white">{row.epoch}</td>
                    <td className="px-6 py-4">{row.sourceId}</td>
                    <td className="px-6 py-4 text-emerald-400 font-mono">{row.ew.toFixed(2)}</td>
                    <td className="px-6 py-4 font-mono">{row.velocity.toFixed(0)}</td>
                    <td className="px-6 py-4"><span className="bg-slate-700 text-slate-300 px-2 py-1 rounded-full text-xs">{row.troughCount}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
         </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-hidden relative">
       {view === 'home' && renderHome()}
       {view === 'spectra' && renderSpectra()}
       {view === 'correlations' && renderCorrelations()}
       {view === 'tables' && renderTables()}
    </div>
  );
};

const SourceCodeBrowser = () => {
  const [selectedFile, setSelectedFile] = useState("README.md");
  return (
    <div className="flex h-full bg-slate-900 text-slate-300 font-mono text-sm">
      <div className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col">
        <div className="p-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800">
          Package Explorer
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {Object.keys(PYTHON_FILES).sort().map((fileName) => (
              <div 
                key={fileName}
                onClick={() => setSelectedFile(fileName)}
                className={`flex items-center px-3 py-2 cursor-pointer hover:bg-slate-800 transition-colors ${fileName === selectedFile ? 'bg-blue-900/30 text-blue-400 border-r-2 border-blue-500' : ''}`}
              >
                <FileCode size={14} className="mr-2 opacity-70" />
                {fileName}
              </div>
          ))}
        </div>
      </div>
      <div className="flex-1 p-6 bg-[#0d1117] overflow-auto">
        <pre className="text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
          {PYTHON_FILES[selectedFile]}
        </pre>
      </div>
    </div>
  );
};

// --- 4. MAIN APP ORCHESTRATION ---

const App = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'code'>('dashboard');
  const [showChat, setShowChat] = useState(true);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>(DEFAULT_FILES);
  const [analysisState, setAnalysisState] = useState<{ 
      data: any[]; 
      metrics: AnalysisMetric[]; 
      z: number; 
      fileMeta: FileMetadata[];
      sources: string[]; 
  }>({ data: [], metrics: [], z: 2.34, fileMeta: [], sources: [] });
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsProcessing(true);
    const process = async () => {
        const { data, metrics, z, fileMeta, sources } = await generateAnalysisData(uploadedFiles);
        setAnalysisState({ data, metrics, z, fileMeta, sources });
        // By default select all sources initially
        if (sources.length > 0 && selectedSources.length === 0) {
            setSelectedSources(sources);
        } else if (sources.length > 0) {
             // Keep existing selection but add new ones if any? or just valid ones
             setSelectedSources(prev => prev.filter(s => sources.includes(s)));
             if (selectedSources.length === 0) setSelectedSources(sources); 
        }
        setIsProcessing(false);
    };
    process();
  }, [uploadedFiles]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFiles = Array.from(files);
      const uniqueNewFiles = newFiles.filter(newFile => 
        !uploadedFiles.some(existingFile => existingFile.name === newFile.name)
      );
      setUploadedFiles(prev => [...prev, ...uniqueNewFiles]);
      if (event.target) event.target.value = "";
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setUploadedFiles(prev => prev.filter(f => f.name !== fileName));
  };

  const handleClearAll = () => {
    if (window.confirm("Are you sure you want to clear all loaded spectra?")) {
       setUploadedFiles([]);
    }
  };

  const handleRestoreDefaults = () => {
    setUploadedFiles(DEFAULT_FILES);
  };
  
  const handleToggleSource = (sourceId: string) => {
      setSelectedSources(prev => {
          if (prev.includes(sourceId)) {
             // Don't allow unselecting the last one for UX reasons, or allow?
             return prev.filter(s => s !== sourceId);
          } else {
             return [...prev, sourceId];
          }
      });
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Sidebar */}
      <div className="w-16 lg:w-64 bg-slate-900 border-r border-slate-800 flex flex-col z-20 flex-shrink-0 transition-all duration-300">
        <div className="p-4 lg:p-6 border-b border-slate-800 flex items-center justify-center lg:justify-start gap-3">
          <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-900/20">
            <Zap size={20} className="text-white" />
          </div>
          <div className="hidden lg:block">
            <h1 className="text-xl font-bold tracking-tight text-white">Autobal<span className="text-blue-500">.AI</span></h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Spectroscopy Suite</p>
          </div>
        </div>
        
        <nav className="flex-1 p-2 lg:p-4 flex flex-col gap-2 min-h-0">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center justify-center lg:justify-start gap-3 px-3 lg:px-4 py-3 rounded-lg transition-all ${activeTab === 'dashboard' ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}>
            <LayoutDashboard size={20} />
            <span className="hidden lg:block font-medium">Dashboard</span>
          </button>
          <button onClick={() => setActiveTab('code')} className={`w-full flex items-center justify-center lg:justify-start gap-3 px-3 lg:px-4 py-3 rounded-lg transition-all ${activeTab === 'code' ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}>
            <FileCode size={20} />
            <span className="hidden lg:block font-medium">Codebase</span>
          </button>

          {/* Dataset Management Section */}
          <div className="mt-auto pt-4 border-t border-slate-800 hidden lg:flex flex-col gap-2 min-h-0">
             <div className="flex items-center justify-between px-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Dataset</span>
                <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full">{uploadedFiles.length}</span>
             </div>

             <div className="flex-1 min-h-[100px] max-h-[200px] overflow-y-auto custom-scrollbar space-y-1 mb-2 pr-1">
                {uploadedFiles.map((file: any) => (
                  <div key={file.name} className="group flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800/50 transition-colors text-xs text-slate-400 border border-transparent hover:border-slate-700">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText size={12} className="flex-shrink-0 text-slate-500"/>
                        <span className="truncate">{file.name}</span>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleRemoveFile(file.name); }} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition-all p-1 hover:bg-slate-700 rounded">
                        <X size={12} />
                      </button>
                  </div>
                ))}
                {uploadedFiles.length === 0 && (
                   <div className="text-xs text-slate-600 italic px-2 py-4 text-center">
                     No files loaded.
                     <button onClick={handleRestoreDefaults} className="text-blue-500 hover:underline ml-1">Load examples</button>
                   </div>
                )}
             </div>

             <div className="grid grid-cols-2 gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all border border-emerald-500/20 text-xs font-medium">
                  <Plus size={14} /> Add
                </button>
                <input type="file" multiple accept=".fits" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                <button onClick={handleClearAll} disabled={uploadedFiles.length === 0} className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all border border-rose-500/20 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                  <Trash2 size={14} /> Clear
                </button>
             </div>
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800 hidden lg:block">
           <button onClick={() => setShowChat(!showChat)} className={`w-full flex items-center justify-between px-4 py-2 rounded-md text-sm transition-colors ${showChat ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
             <span className="flex items-center gap-2"><MessageSquare size={16}/> AI Analyst</span>
             <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded">{showChat ? 'ON' : 'OFF'}</span>
           </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {isProcessing && (
          <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Activity size={24} className="text-blue-400 animate-pulse" />
              </div>
            </div>
            <h3 className="mt-6 text-xl font-bold text-white">Analyzing Spectra</h3>
            <p className="text-slate-400 mt-2">Running reduction pipeline...</p>
          </div>
        )}

        <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-4">
             <span className="text-slate-500"><Search size={16}/></span>
             <span className="text-sm text-slate-400">Project: <span className="text-slate-200 font-medium">
               {analysisState.sources.length > 1 ? "Multi-Object Study" : (analysisState.sources[0] || "Unknown")}
             </span></span>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <main className="flex-1 overflow-hidden relative bg-slate-950">
            {activeTab === 'dashboard' ? (
              <AnalysisDashboard 
                data={analysisState.data} 
                metrics={analysisState.metrics}
                z={analysisState.z}
                fileMeta={analysisState.fileMeta}
                availableSources={analysisState.sources}
                selectedSources={selectedSources}
                onToggleSource={handleToggleSource}
              />
            ) : (
              <SourceCodeBrowser />
            )}
          </main>
          
          {showChat && activeTab === 'dashboard' && (
            <aside className="w-80 border-l border-slate-800 bg-slate-900 flex-shrink-0 transition-all duration-300">
              <AIChatPanel metrics={analysisState.metrics.filter(m => selectedSources.includes(m.sourceId))} z={analysisState.z} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);