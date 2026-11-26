// Research and experimental capabilities cloud on the Projects page.
// Built from the projects that are loaded and shown (folder and status
// filters), from the capability fields of their Project Description
// (backend: project_description.CAPABILITY_FIELD_IDS). Read-only.

// Colours: theme tokens --cloud-* (index.css), a validated categorical palette
// that stays distinct for colour-blind readers and readable in both themes.
export const CAPABILITY_FIELDS = [
  { id: 'methods', label: 'Methods', fillClass: 'fill-cloud-methods', dotClass: 'bg-cloud-methods' },
  { id: 'measured_quantities', label: 'Measured quantities', fillClass: 'fill-cloud-measured', dotClass: 'bg-cloud-measured' },
  { id: 'technical_skills', label: 'Technical skills', fillClass: 'fill-cloud-skills', dotClass: 'bg-cloud-skills' },
  { id: 'facility', label: 'Facility / rig', fillClass: 'fill-cloud-facility', dotClass: 'bg-cloud-facility' },
  { id: 'fuels', label: 'Fuels / mixtures', fillClass: 'fill-cloud-fuels', dotClass: 'bg-cloud-fuels' },
  { id: 'keywords', label: 'Keywords', fillClass: 'fill-muted-foreground', dotClass: 'bg-muted-foreground' },
];

const FIELD_ORDER = new Map(CAPABILITY_FIELDS.map((field, index) => [field.id, index]));
const norm = (text) => String(text || '').trim().replace(/\s+/g, ' ');

// Terms of the given projects, counted once per project (ignoring case; the
// first spelling seen is kept), most used first, then by field and name.
export const buildCapabilityCloud = (projects = []) => {
  const byKey = new Map();
  let described = 0;
  for (const project of projects) {
    const capabilities = project?.capabilities || {};
    let used = false;
    for (const field of CAPABILITY_FIELDS) {
      const seenInProject = new Set();
      for (const raw of capabilities[field.id] || []) {
        const value = norm(raw);
        const key = `${field.id}\u0000${value.toLowerCase()}`;
        if (!value || seenInProject.has(key)) continue;
        seenInProject.add(key);
        used = true;
        const entry = byKey.get(key) || { field: field.id, value, count: 0, projects: [] };
        entry.count += 1;
        entry.projects.push(project.name || '');
        byKey.set(key, entry);
      }
    }
    if (used) described += 1;
  }
  const terms = [...byKey.values()].sort((a, b) => (
    b.count - a.count
    || FIELD_ORDER.get(a.field) - FIELD_ORDER.get(b.field)
    || a.value.localeCompare(b.value)
  ));
  return { terms, described, total: projects.length };
};

// Font size in px: terms used by more projects are larger (square-root scale,
// so one very common term does not shrink all others to the minimum). While
// every term is used by the same number of projects, all get one middle size.
export const FLAT_FONT_SIZE = 22;
export const termFontSize = (count, maxCount, minCount = 1, min = 14, max = 46) => {
  if (!(maxCount > minCount)) return FLAT_FONT_SIZE;
  const share = Math.sqrt(Math.max(0, count - minCount)) / Math.sqrt(maxCount - minCount);
  return Math.round(min + (max - min) * Math.min(1, share));
};

// Every third word from the third on is turned vertical, if it is short
// enough to stay readable and not one of the large words (those read
// horizontally; when all words have one size, any of them may turn).
const isVertical = (index, value, fontSize, largest, flat) => (
  index >= 2 && index % 3 === 2 && value.length <= 18 && (flat || fontSize <= 0.65 * largest)
);

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Word cloud layout: the terms (most used first) are placed one by one on an
// elliptic spiral around the centre, each at the first spot where its box
// does not overlap the boxes already placed. Deterministic (same terms, same
// picture). `measure(text, fontSize)` returns the text width in px.
// Returns { words: [{ term, fontSize, vertical, x, y, w, h }], bounds }, with
// x/y the top-left corner of each word's box (centre of the cloud at 0,0).
export const layoutCloud = (terms, measure, { padding = 4, aspect = 2.2, step = 0.12, maxSteps = 6000 } = {}) => {
  const counts = terms.map((term) => term.count);
  const maxCount = counts.length ? Math.max(...counts) : 0;
  const minCount = counts.length ? Math.min(...counts) : 0;
  const flat = maxCount === minCount;
  const largest = termFontSize(maxCount, maxCount, minCount);
  const placed = [];
  terms.forEach((term, index) => {
    const fontSize = termFontSize(term.count, maxCount, minCount);
    const vertical = isVertical(index, term.value, fontSize, largest, flat);
    const textW = measure(term.value, fontSize) + 2 * padding;
    const textH = fontSize * 1.18 + 2 * padding;
    const w = vertical ? textH : textW;
    const h = vertical ? textW : textH;
    let box = null;
    for (let i = 0; i < maxSteps; i += 1) {
      const t = i * step;
      const r = 1.6 * t;
      const candidate = { x: r * aspect * Math.cos(t) - w / 2, y: r * Math.sin(t) - h / 2, w, h };
      if (!placed.some((other) => overlaps(candidate, other))) {
        box = candidate;
        break;
      }
    }
    if (box) placed.push({ term, fontSize, vertical, ...box });
  });
  const bounds = placed.reduce(
    (acc, word) => ({
      minX: Math.min(acc.minX, word.x),
      minY: Math.min(acc.minY, word.y),
      maxX: Math.max(acc.maxX, word.x + word.w),
      maxY: Math.max(acc.maxY, word.y + word.h),
    }),
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  );
  return { words: placed, bounds: { ...bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY } };
};

export const termTitle = (term, fieldLabel) => {
  const n = term.count;
  const names = [...term.projects].sort((a, b) => a.localeCompare(b)).join(', ');
  return `${fieldLabel}: used in ${n} ${n === 1 ? 'project' : 'projects'} (${names}). Click to find them.`;
};
