import React, { useMemo, useState } from 'react';
import { resolveMappingForRun } from '../utils/runOverrides';

// EXDA-Check C4: configurations changed within groups (probes absent for some
// runs, a sensor re-mounted, a cable swap). A mapping named exactly like a run
// overrides that run's group mapping. This panel creates such overrides and
// shows which mapping each run uses.

const RunOverridePanel = ({
  planRuns = [],
  mappingKeys = [],
  getGroupFromRunName,
  onCreateOverride,
  onSelectMapping,
  itemLabel = 'sensors',
}) => {
  const [runToOverride, setRunToOverride] = useState('');
  const rows = useMemo(
    () => planRuns.map((run) => ({ run, ...resolveMappingForRun(run, mappingKeys, getGroupFromRunName) })),
    [getGroupFromRunName, mappingKeys, planRuns]
  );
  const overrideCount = rows.filter((row) => row.source === 'run override').length;

  if (!planRuns.length) return null;
  return (
    <details className="mt-3 rounded-lg border border-sidebar-border bg-card/40 p-3 text-xs">
      <summary className="cursor-pointer font-semibold text-foreground">
        Per-run overrides ({overrideCount} of {planRuns.length} runs use their own {itemLabel} mapping)
      </summary>
      <div className="mt-2 text-muted-foreground">
        A mapping named exactly like a run replaces its group mapping for that run only (for example when a
        probe was absent, moved or re-cabled for some runs). Other runs keep the group mapping.
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={runToOverride}
          onChange={(event) => setRunToOverride(event.target.value)}
          className="rounded border border-sidebar-border bg-background px-2 py-1 text-xs text-foreground"
        >
          <option value="">Choose a run…</option>
          {rows.map((row) => (
            <option key={row.run} value={row.run}>
              {row.run}{row.source === 'run override' ? ' (has override)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!runToOverride}
          onClick={() => {
            onCreateOverride(runToOverride);
            setRunToOverride('');
          }}
          className="rounded border border-primary/40 bg-primary/15 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/25 disabled:opacity-50"
        >
          Create / open run override
        </button>
      </div>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1">Run</th>
            <th className="py-1">Mapping used</th>
            <th className="py-1">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.run} className="border-t border-border/60">
              <td className="py-1 font-mono">{row.run}</td>
              <td className="py-1">
                {row.key ? (
                  <button type="button" className="underline" onClick={() => onSelectMapping(row.key)}>
                    {row.key}
                  </button>
                ) : '-'}
              </td>
              <td className={`py-1 ${row.source === 'run override' ? 'text-primary font-semibold' : row.source === 'none' ? 'text-destructive' : ''}`}>
                {row.source === 'none' ? 'no mapping' : row.source}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
};

export default RunOverridePanel;
