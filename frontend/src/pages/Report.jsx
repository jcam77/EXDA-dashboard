import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Download, Construction, Database } from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';
import { EXDA_DISPLAY_TIME_ZONE, formatExdaClock } from '../utils/timezone';
import UnifiedModal from '../components/UnifiedModal';

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
  const [metadataPdf, setMetadataPdf] = useState({ found: false, filename: '', relativePath: '' });
  const [checkingMetadataPdf, setCheckingMetadataPdf] = useState(false);
  const [showMetadataPreview, setShowMetadataPreview] = useState(false);
  const [exportModal, setExportModal] = useState({ show: false, type: 'success', title: '', content: null });

  const metadataPdfUrls = useMemo(() => {
    if (!projectPath || !metadataPdf?.relativePath) return { inlineUrl: '', downloadUrl: '' };
    const encodedProject = encodeURIComponent(projectPath);
    const encodedPath = encodeURIComponent(metadataPdf.relativePath);
    const inlineUrl = `${apiBaseUrl}/project_artifact_file?projectPath=${encodedProject}&path=${encodedPath}`;
    return {
      inlineUrl,
      downloadUrl: `${inlineUrl}&download=1`,
    };
  }, [apiBaseUrl, metadataPdf, projectPath]);

  const refreshLatestMetadataPdf = async () => {
    if (!projectPath) {
      setMetadataPdf({ found: false, filename: '', relativePath: '' });
      setShowMetadataPreview(false);
      return;
    }
    try {
      setCheckingMetadataPdf(true);
      const response = await fetch(
        `${apiBaseUrl}/latest_report_artifact?projectPath=${encodeURIComponent(projectPath)}&kind=metadata&format=pdf`,
      );
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Could not check latest metadata PDF');
      }
      if (payload?.found && payload?.relativePath) {
        setMetadataPdf({
          found: true,
          filename: String(payload.filename || ''),
          relativePath: String(payload.relativePath || ''),
        });
      } else {
        setMetadataPdf({ found: false, filename: '', relativePath: '' });
        setShowMetadataPreview(false);
      }
    } catch {
      setMetadataPdf({ found: false, filename: '', relativePath: '' });
      setShowMetadataPreview(false);
    } finally {
      setCheckingMetadataPdf(false);
    }
  };

  useEffect(() => {
    refreshLatestMetadataPdf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, apiBaseUrl]);

  const exportMetadataReport = async (format) => {
    if (!projectPath) {
      setExportModal({
        show: true,
        type: 'error',
        title: 'Project Required',
        content: (
          <div>
            Open a project first. Export files are saved to the project <span className="font-mono">Reports</span> folder.
          </div>
        ),
      });
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
      setExportModal({
        show: true,
        type: 'success',
        title: `${String(format).toUpperCase()} Exported`,
        content: (
          <div className="space-y-2">
            <p>Export saved to:</p>
            <p className="break-all rounded border border-border bg-black/30 px-2 py-1 font-mono text-xs text-zinc-300">
              {String(payload.path || '')}
            </p>
          </div>
        ),
      });
      if (String(format).toLowerCase() === 'pdf') {
        refreshLatestMetadataPdf();
      }
    } catch (error) {
      const message = error?.message || 'Unknown error';
      setStatus(`Export failed: ${message}`);
      setExportModal({
        show: true,
        type: 'error',
        title: `Could Not Export ${String(format).toUpperCase()}`,
        content: <div>{message}</div>,
      });
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
          <div className="mt-3 rounded-lg border border-sidebar-border bg-background/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-foreground">Latest Metadata PDF</p>
                <p className="text-[11px] text-muted-foreground">
                  {checkingMetadataPdf
                    ? 'Checking latest file...'
                    : metadataPdf.found
                      ? (metadataPdf.filename || 'Metadata report available')
                      : 'No metadata PDF found yet. Export one to enable preview.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowMetadataPreview((prev) => !prev)}
                  disabled={!metadataPdfUrls.inlineUrl}
                  className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {showMetadataPreview ? 'Hide Preview' : 'Preview'}
                </button>
                <a
                  href={metadataPdfUrls.inlineUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    if (!metadataPdfUrls.inlineUrl) event.preventDefault();
                  }}
                  className={`inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold ${metadataPdfUrls.inlineUrl ? 'text-foreground hover:bg-muted/60' : 'cursor-not-allowed text-muted-foreground opacity-60'}`}
                >
                  Open PDF
                </a>
                <a
                  href={metadataPdfUrls.downloadUrl || '#'}
                  onClick={(event) => {
                    if (!metadataPdfUrls.downloadUrl) event.preventDefault();
                  }}
                  className={`inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold ${metadataPdfUrls.downloadUrl ? 'text-foreground hover:bg-muted/60' : 'cursor-not-allowed text-muted-foreground opacity-60'}`}
                >
                  Download
                </a>
              </div>
            </div>
            {showMetadataPreview && metadataPdfUrls.inlineUrl ? (
              <div className="mt-3 overflow-hidden rounded border border-sidebar-border bg-background">
                <iframe
                  title="Metadata report preview"
                  src={metadataPdfUrls.inlineUrl}
                  className="h-[320px] w-full"
                />
              </div>
            ) : null}
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
      <UnifiedModal modal={exportModal} setModal={setExportModal} />
    </div>
  );
};

export default ReportPage;
