// Helpers for the Project Description tab (see backend/modules/project_description.py).

export const cloneDescription = (description) => JSON.parse(JSON.stringify(description || { standard: {}, extra: [] }));

export const sameDescription = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

const norm = (text) => String(text || '').trim().replace(/\s+/g, ' ');

// A typed term that matches a known term (ignoring case) takes the known spelling,
// so the same thing gets the same name in every project.
export const canonicalTag = (input, suggestions = []) => {
  const typed = norm(input);
  const known = suggestions.find((item) => item.value.toLowerCase() === typed.toLowerCase());
  return known ? known.value : typed;
};

export const addTag = (tags, tag) => {
  const value = norm(tag);
  if (!value) return tags;
  if (tags.some((existing) => existing.toLowerCase() === value.toLowerCase())) return tags;
  return [...tags, value];
};

// Suggestions for what is being typed: terms starting with it first, then terms
// containing it; terms already chosen are left out.
export const matchSuggestions = (input, suggestions = [], chosen = [], limit = 8) => {
  const typed = norm(input).toLowerCase();
  const taken = new Set(chosen.map((tag) => tag.toLowerCase()));
  const open = suggestions.filter((item) => !taken.has(item.value.toLowerCase()));
  if (!typed) return open.slice(0, limit);
  const starts = open.filter((item) => item.value.toLowerCase().startsWith(typed));
  const contains = open.filter((item) => !item.value.toLowerCase().startsWith(typed) && item.value.toLowerCase().includes(typed));
  return [...starts, ...contains].slice(0, limit);
};

export const newExtraId = (extra = [], random = Math.random) => {
  const used = new Set(extra.map((item) => item.id));
  for (;;) {
    const id = `extra-${random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
};

// What the backend would refuse, as a readable message ('' when fine).
export const descriptionProblem = (description, fields = []) => {
  const standardLabels = new Set(fields.map((field) => field.label.toLowerCase()));
  const seen = new Set();
  for (const [index, item] of (description?.extra || []).entries()) {
    const label = norm(item.label);
    if (!label) return `Extra field ${index + 1} needs a name.`;
    if (standardLabels.has(label.toLowerCase())) return `"${label}" is already a standard field.`;
    if (seen.has(label.toLowerCase())) return `There is already a field called "${label}".`;
    seen.add(label.toLowerCase());
  }
  return '';
};

// How many standard fields have something in them.
export const filledCount = (description, fields = []) => fields.filter((field) => {
  const value = description?.standard?.[field.id];
  return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
}).length;
