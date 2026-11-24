import React from 'react';

// The title bar every workspace tab starts with: the tab's icon (same as in the
// tab bar), an uppercase title, an optional one-line description, and optional
// tab-specific controls on the right.
const PageHeader = ({ icon: Icon, title, subtitle, children, className = '' }) => (
  <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 ${className}`}>
    <div className="flex min-w-0 items-center gap-3">
      {Icon && <Icon className="shrink-0 text-primary" size={24} />}
      <div className="min-w-0">
        <h1 className="text-xl font-bold uppercase tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
    {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
  </div>
);

export default PageHeader;
