import React from 'react';

const NODE_MAP = [
  { id: 'user', label: 'User', x: 40, y: 120, kind: 'entry', details: 'Operator defines runs and triggers analysis.', refs: ['frontend/src/pages/Home.jsx'] },
  { id: 'plan', label: 'Plan', x: 120, y: 120, kind: 'ui', details: 'Plan tab stores run metadata and associations.', refs: ['frontend/src/pages/Plan.jsx'] },
  { id: 'meta', label: 'Run Meta', x: 200, y: 120, kind: 'ui', details: 'Per-run fields and data-file links.', refs: ['frontend/src/pages/Plan.jsx'] },
  { id: 'raw', label: 'Raw Data', x: 280, y: 72, kind: 'data', details: 'Raw experiment files under project tree.', refs: ['Projects/<project>/Raw_Data/<run>/...'] },
  { id: 'clean', label: 'Clean Data', x: 280, y: 120, kind: 'data', details: 'Processed/cleaned files per run.', refs: ['Projects/<project>/Clean_Data/<run>/...'] },
  { id: 'cfd', label: 'CFD Data', x: 280, y: 168, kind: 'data', details: 'CFD references and simulation artifacts.', refs: ['Projects/<project>/CFD_Data/'] },
  { id: 'api', label: 'API Routes', x: 380, y: 120, kind: 'backend', details: 'Flask endpoints for state + calculations.', refs: ['backend/routes/state.py', 'backend/routes/calculation_api_routes.py'] },
  { id: 'pressure', label: 'Pressure', x: 480, y: 72, kind: 'analysis', details: 'Pressure metrics and peak/impulse pipeline.', refs: ['backend/modules/pressure_analysis.py'] },
  { id: 'ewt', label: 'EWT', x: 480, y: 120, kind: 'analysis', details: 'Empirical Wavelet Transform decomposition.', refs: ['backend/modules/ewt_analysis.py'] },
  { id: 'verify', label: 'Verification', x: 480, y: 168, kind: 'analysis', details: 'Cross-check calculations and summary tables.', refs: ['frontend/src/pages/AppCalculationsVerification.jsx'] },
  { id: 'decision', label: 'Decision', x: 590, y: 120, kind: 'decision', details: 'Engineering assessment: repeat, proceed, report.', refs: ['frontend/src/pages/Report.jsx'] },
];

const EDGE_MAP = [
  ['user', 'plan'],
  ['plan', 'meta'],
  ['meta', 'raw'],
  ['meta', 'clean'],
  ['meta', 'cfd'],
  ['raw', 'api'],
  ['clean', 'api'],
  ['cfd', 'api'],
  ['api', 'pressure'],
  ['api', 'ewt'],
  ['api', 'verify'],
  ['pressure', 'decision'],
  ['ewt', 'decision'],
  ['verify', 'decision'],
];

const PHASES = [
  { title: 'Plan and run definition', edges: new Set(['user-plan', 'plan-meta']) },
  { title: 'Data organization per test', edges: new Set(['meta-raw', 'meta-clean', 'meta-cfd']) },
  { title: 'Frontend to backend pipeline', edges: new Set(['raw-api', 'clean-api', 'cfd-api']) },
  { title: 'Analysis and verification', edges: new Set(['api-pressure', 'api-ewt', 'api-verify']) },
  { title: 'Engineering decision support', edges: new Set(['pressure-decision', 'ewt-decision', 'verify-decision']) },
];

const KIND_CLASS = {
  entry: 'bg-secondary text-secondary-foreground border-secondary/40',
  ui: 'bg-primary/20 text-primary border-primary/40',
  data: 'bg-info/20 text-info border-info/40',
  backend: 'bg-accent/20 text-accent border-accent/40',
  analysis: 'bg-success/20 text-success border-success/40',
  decision: 'bg-warning/20 text-warning border-warning/40',
};

const edgeKey = (a, b) => `${a}-${b}`;

const nodeById = Object.fromEntries(NODE_MAP.map((n) => [n.id, n]));

const ArchitectureFlowMap = () => {
  const [phaseIndex, setPhaseIndex] = React.useState(0);
  const [selectedId, setSelectedId] = React.useState('api');

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setPhaseIndex((prev) => (prev + 1) % PHASES.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  const activeEdges = PHASES[phaseIndex].edges;
  const selected = nodeById[selectedId] || NODE_MAP[0];

  return (
    <div className="rounded-xl border border-sidebar-border bg-card/60 p-4 sm:p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Interactive Architecture Map</h3>
        <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
          Phase {phaseIndex + 1}: {PHASES[phaseIndex].title}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        <div className="rounded-lg border border-border bg-background/40 p-2">
          <svg viewBox="0 0 640 220" className="w-full h-auto">
            {EDGE_MAP.map(([a, b]) => {
              const from = nodeById[a];
              const to = nodeById[b];
              const key = edgeKey(a, b);
              const isActive = activeEdges.has(key);
              return (
                <line
                  key={key}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isActive ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
                  strokeWidth={isActive ? 2.4 : 1.4}
                  strokeOpacity={isActive ? 0.95 : 0.55}
                />
              );
            })}
            {NODE_MAP.map((node) => {
              const isSelected = selectedId === node.id;
              return (
                <g key={node.id} onClick={() => setSelectedId(node.id)} className="cursor-pointer">
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={isSelected ? 13 : 11}
                    fill={isSelected ? 'hsl(var(--primary))' : 'hsl(var(--muted))'}
                    stroke={isSelected ? 'hsl(var(--accent))' : 'hsl(var(--border))'}
                    strokeWidth={1.5}
                  />
                  <text x={node.x} y={node.y + 24} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="rounded-lg border border-border bg-background/50 p-3">
          <div className={`inline-flex rounded border px-2 py-1 text-[10px] font-semibold ${KIND_CLASS[selected.kind] || KIND_CLASS.entry}`}>
            {selected.kind}
          </div>
          <h4 className="mt-2 text-sm font-semibold text-foreground">{selected.label}</h4>
          <p className="mt-2 text-xs text-muted-foreground">{selected.details}</p>
          <div className="mt-3">
            <div className="text-[10px] font-semibold text-muted-foreground mb-1">Real references</div>
            <div className="space-y-1">
              {(selected.refs || []).map((ref) => (
                <code key={ref} className="block rounded border border-border bg-muted/20 px-2 py-1 text-[10px] text-foreground">
                  {ref}
                </code>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArchitectureFlowMap;
