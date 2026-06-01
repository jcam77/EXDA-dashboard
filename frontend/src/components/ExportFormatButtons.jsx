import React from 'react';
import { Download } from 'lucide-react';

const ExportFormatButtons = ({
  onExportCsv,
  onExportPdf,
  busyFormat = '',
  disabled = false,
  className = '',
  size = 'sm',
  csvLabel = 'Export CSV',
  pdfLabel = 'Export PDF',
}) => {
  const sizeClass = size === 'md'
    ? 'px-4 py-2 text-sm rounded-xl'
    : 'px-3 py-1.5 text-xs rounded-md';

  const buttonClass = `inline-flex items-center gap-2 border border-primary/35 bg-primary/10 font-semibold text-primary hover:border-primary/60 hover:bg-primary/20 transition disabled:cursor-not-allowed disabled:opacity-60 ${sizeClass}`;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onExportCsv}
        disabled={disabled || busyFormat !== ''}
        className={buttonClass}
      >
        <Download size={14} />
        {busyFormat === 'csv' ? 'Exporting CSV...' : csvLabel}
      </button>
      <button
        type="button"
        onClick={onExportPdf}
        disabled={disabled || busyFormat !== ''}
        className={buttonClass}
      >
        <Download size={14} />
        {busyFormat === 'pdf' ? 'Exporting PDF...' : pdfLabel}
      </button>
    </div>
  );
};

export default ExportFormatButtons;
