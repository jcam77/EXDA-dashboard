import React from 'react';

// A file or folder path that wraps only after a separator ("/" or "\"),
// never in the middle of a folder or file name. Monospace, as in the design guide.
const PathText = ({ path, className = '' }) => {
  const parts = String(path || '').split(/(?<=[\\/])/);
  return (
    <span className={`font-mono [overflow-wrap:normal] [word-break:normal] ${className}`} title={path}>
      {parts.map((part, index) => (
        // Parts of one path never reorder, so the index is a stable key.
        // Each part stays on one line (browsers would otherwise break after "-").
        <React.Fragment key={index}><span className="whitespace-nowrap">{part}</span>{index < parts.length - 1 && <wbr />}</React.Fragment>
      ))}
    </span>
  );
};

export default PathText;
