import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Sparkles, X } from 'lucide-react';
import { buildCapabilityCloud, CAPABILITY_FIELDS, layoutCloud, termTitle } from '../utils/capabilityCloud';

const FOLD_KEY = 'projectsCapabilitiesFolded';
const MAX_HEIGHT = 300;
const FIELDS_BY_ID = new Map(CAPABILITY_FIELDS.map((field) => [field.id, field]));

const readFolded = () => {
  try {
    return localStorage.getItem(FOLD_KEY) === 'true';
  } catch {
    return false;
  }
};

// Text width in px with the page font (the SVG words use the same font).
let measureContext = null;
const measureText = (text, fontSize) => {
  if (typeof document === 'undefined') return text.length * fontSize * 0.6;
  if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * fontSize * 0.6;
  const family = window.getComputedStyle(document.body).fontFamily || 'sans-serif';
  measureContext.font = `700 ${fontSize}px ${family}`;
  return measureContext.measureText(text).width;
};

const useWidth = (ref) => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
};

const CloudPicture = ({ terms, activeQuery, onSelectTerm }) => {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  // The spiral is as wide as the card allows, so the cloud fills the card
  // instead of growing tall (rounded, so small resizes do not re-layout).
  const aspect = width ? Math.min(6, Math.max(1.6, Math.round((width / MAX_HEIGHT) * 2) / 2)) : 3;
  const { words, bounds } = useMemo(() => layoutCloud(terms, measureText, { aspect }), [terms, aspect]);
  // Never enlarge; shrink only when the cloud is wider or taller than the card.
  const scale = Math.min(1, width ? width / bounds.width : 1, MAX_HEIGHT / bounds.height);
  const pick = (term) => onSelectTerm?.(activeQuery === term.value.toLowerCase() ? '' : term.value);
  // While a word is selected, the others stay faded, so the filter is visible.
  const anySelected = words.some((word) => word.term.value.toLowerCase() === activeQuery);

  return (
    <div ref={wrapRef} className="flex w-full justify-center py-2">
      <svg
        role="list"
        aria-label="Capability terms"
        width={Math.max(1, bounds.width * scale)}
        height={Math.max(1, bounds.height * scale)}
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        className="max-w-full overflow-visible"
      >
        {words.map((word) => {
          const { term } = word;
          const key = `${term.field}:${term.value}`;
          const field = FIELDS_BY_ID.get(term.field);
          const active = activeQuery === term.value.toLowerCase();
          const dimmed = hovered ? hovered !== key : anySelected && !active;
          const cx = word.x + word.w / 2;
          const cy = word.y + word.h / 2;
          return (
            <g key={key} role="listitem">
              <g
                role="button"
                tabIndex={0}
                aria-label={term.value}
                aria-pressed={active}
                onClick={() => pick(term)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    pick(term);
                  }
                }}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setFocused(key)}
                onBlur={() => setFocused(null)}
                className={`cursor-pointer outline-none transition-opacity duration-200 ${dimmed ? (hovered ? 'opacity-30' : 'opacity-40') : 'opacity-100'}`}
              >
                <title>{termTitle(term, field.label)}</title>
                {(active || focused === key) && (
                  <rect
                    x={word.x}
                    y={word.y}
                    width={word.w}
                    height={word.h}
                    rx={6}
                    className={active ? 'fill-primary/10 stroke-primary/50' : 'fill-transparent stroke-ring'}
                    strokeWidth={1.5}
                  />
                )}
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={word.vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
                  style={{ fontSize: `${word.fontSize}px` }}
                  className={`font-bold ${field.fillClass}`}
                >
                  {term.value}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// Research and experimental capabilities of the projects shown on the Projects
// page, from their Project Description (methods, measured quantities,
// facility, fuels, keywords), as a word cloud: the more projects use a term,
// the larger it is. It follows what is loaded and filtered, and shows an empty
// card when there is nothing to show. Clicking a word searches the projects
// for it. Read-only.
const CapabilityCloud = ({ projects = [], loading = false, searchQuery = '', onSelectTerm }) => {
  const [folded, setFolded] = useState(readFolded);
  const cloud = useMemo(() => buildCapabilityCloud(projects), [projects]);
  const counts = cloud.terms.map((term) => term.count);
  const flat = counts.length > 1 && Math.max(...counts) === Math.min(...counts);
  const fieldsInUse = CAPABILITY_FIELDS.filter((field) => cloud.terms.some((term) => term.field === field.id));
  const activeQuery = searchQuery.trim().toLowerCase();
  // The word picked in the cloud (the search text is exactly one of its terms).
  const selectedTerm = activeQuery ? cloud.terms.find((term) => term.value.toLowerCase() === activeQuery) : null;

  const toggle = () => {
    setFolded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FOLD_KEY, String(next));
      } catch {
        // Folding still works for this visit without storage.
      }
      return next;
    });
  };

  const summary = loading
    ? 'Loading…'
    : cloud.total === 0
      ? 'No projects loaded'
      : `${cloud.terms.length} ${cloud.terms.length === 1 ? 'term' : 'terms'} from ${cloud.described} of ${cloud.total} ${cloud.total === 1 ? 'project' : 'projects'}`;

  let body;
  if (loading) {
    body = <p className="py-4 text-center text-sm text-muted-foreground">Loading projects…</p>;
  } else if (cloud.total === 0) {
    body = (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No projects loaded. Add a project folder to see the research and experimental capabilities of your projects.
      </p>
    );
  } else if (cloud.terms.length === 0) {
    body = (
      <p className="py-4 text-center text-sm text-muted-foreground">
        None of these projects has capabilities in its Project Description yet. Fill in Methods, Measured quantities,
        Facility, Fuels and Keywords on each project&apos;s Project Description tab.
      </p>
    );
  } else {
    body = (
      <>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {fieldsInUse.map((field) => (
            <span key={field.id} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${field.dotClass}`} aria-hidden="true" />
              {field.label}
            </span>
          ))}
          <span className="ml-auto">Larger = used in more projects · click a word to find its projects</span>
        </div>
        <CloudPicture terms={cloud.terms} activeQuery={activeQuery} onSelectTerm={onSelectTerm} />
        {flat && (
          <p className="text-center text-[11px] text-muted-foreground">
            Every term is used by {counts[0] === 1 ? 'one project' : `${counts[0]} projects`} so far; terms shared by
            more projects grow larger.
          </p>
        )}
      </>
    );
  }

  return (
    <section
      aria-label="Research and experimental capabilities"
      className={`mb-8 rounded-lg border border-border bg-card ${folded ? 'px-4 py-2.5' : 'px-4 py-3'}`}
    >
      <div className={`flex items-center gap-2 ${folded ? '' : 'mb-2'}`}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!folded}
          title={folded ? 'Show the capabilities' : 'Fold the capabilities'}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Sparkles size={16} className="shrink-0 text-primary" />
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            Research and experimental capabilities
          </span>
          <span className="truncate text-xs text-muted-foreground">· {summary}</span>
        </button>
        {selectedTerm && (
          <button
            type="button"
            onClick={() => onSelectTerm?.('')}
            title="Clear the word filter and show all projects"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            Filter: {selectedTerm.value}
            <X size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={folded ? 'Show the capabilities' : 'Fold the capabilities'}
          className="shrink-0 rounded-md p-0.5 text-muted-foreground"
        >
          <ChevronDown size={16} className={`transition-transform ${folded ? '-rotate-90' : ''}`} />
        </button>
      </div>
      {!folded && body}
    </section>
  );
};

export default CapabilityCloud;
