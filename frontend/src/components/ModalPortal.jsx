import { createPortal } from 'react-dom';

// Renders a pop-up window at the end of <body>.
//
// Pages are drawn inside a container with its own stacking context
// (WorkspacePage: `relative z-0`), so a pop-up rendered inside a page can never
// rise above the sticky app header, whatever its z-index: the header covered
// the top of the run card and of the DAQ/sensor/camera editors. Rendering the
// pop-up at the document level puts it on top of everything. The theme class
// ('dark') is on <html>, so colours are unaffected.
const ModalPortal = ({ children }) => {
  if (typeof document === 'undefined' || !document.body) return children;
  return createPortal(children, document.body);
};

export default ModalPortal;
