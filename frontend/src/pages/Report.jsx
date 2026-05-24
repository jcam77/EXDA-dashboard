import React, { useMemo, useState } from 'react';
import { FileText, Download, Construction, Database } from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';
import { EXDA_DISPLAY_TIME_ZONE, formatExdaClock } from '../utils/timezone';

const ReportPage = ({
  projectPath = '',
  planName = '',
}) => {
  const apiBaseUrl = useMemo(() => getBackendBaseUrl(), []);
  const projectName = useMemo(
    () => String(projectPath || '').split(/[/\\]/).filter(Boolean).pop() || 'No project selected',
    [projectPath],
  );
  const [status, setStatus] = useState('');
  const [busyFormat, setBusyFormat] = useState('');

  const exportMetadataReport = async (format) => {
    if (!projectPath) {
      window.alert('Open a project first. Export files are saved to the project Reports folder.');
      return;
    }
    try {
      setBusyFormat(format);
      const response = await fetch(`${apiBaseUrl}/export_metadata_report_artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          format,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `Failed to export ${String(format).toUpperCase()}`);
      }
      setStatus(`${String(format).toUpperCase()} exported to Reports (${formatExdaClock(new Date())} ${EXDA_DISPLAY_TIME_ZONE})`);
      window.alert(`${String(format).toUpperCase()} exported to:\n${payload.path}`);
    } catch (error) {
      const message = error?.message || 'Unknown error';
      setStatus(`Export failed: ${message}`);
      window.alert(`Could not export ${String(format).toUpperCase()}.\n${message}`);
    } finally {
      setBusyFormat('');
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-card/80 p-5">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-primary" />
          <h2 className="text-lg font-bold text-foreground">Report</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate structured project reports for delivery and traceability.
        </p>
        <p className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          Project: <span className="text-foreground">{projectName}</span>
          {planName ? <span className="ml-4">Plan: <span className="text-foreground">{planName}</span></span> : null}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-sidebar-border bg-card/60 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Database size={16} className="text-primary" />
            <h3 className="text-base font-semibold text-foreground">1. Metadata Report</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Builds one consolidated metadata report from Plan, DAQ Systems, Sensors Mapping, and Gas Mixing.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            CSV is exported as sectioned blocks (one labeled section per module), and PDF is exported as one merged file.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => exportMetadataReport('csv')}
              disabled={busyFormat !== ''}
              className="inline-flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={14} />
              {busyFormat === 'csv' ? 'Exporting CSV...' : 'Export Metadata CSV'}
            </button>
            <button
              type="button"
              onClick={() => exportMetadataReport('pdf')}
              disabled={busyFormat !== ''}
              className="inline-flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={14} />
              {busyFormat === 'pdf' ? 'Exporting PDF...' : 'Export Metadata PDF'}
            </button>
          </div>
          {status ? (
            <p className="mt-3 text-xs text-muted-foreground">{status}</p>
          ) : null}
        </section>

        <section className="rounded-xl border border-sidebar-border bg-card/60 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Construction size={16} className="text-amber-400" />
            <h3 className="text-base font-semibold text-foreground">2. Experiments Report</h3>
            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-300">
              Under Construction
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            This subgroup is intentionally simplified in MVP mode and will be enabled in a future release.
          </p>
        </section>
      </div>
    </div>
  );
};

export default ReportPage;
