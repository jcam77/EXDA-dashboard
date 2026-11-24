// Helpers for the editable pre-experiment checklist (Reports/checklist.json).
// Items keep a stable id, so renaming or moving an item keeps its tick in
// Reports/checklist_state.json. Numbers ("1.2") are not stored: they follow
// the order on screen.

export const ICON_CHOICES = [
  { value: 'list-checks', label: 'Checklist' },
  { value: 'warehouse', label: 'Building' },
  { value: 'hard-hat', label: 'Helmet' },
  { value: 'cog', label: 'Gear' },
  { value: 'activity', label: 'Signal' },
  { value: 'flame', label: 'Flame' },
  { value: 'gauge', label: 'Gauge' },
  { value: 'shield', label: 'Shield' },
];
export const DEFAULT_GROUP_ICON = 'list-checks';

// Sign-off keys in checklist_state.json; never used as item ids.
const RESERVED_IDS = new Set(['resp_name', 'inst_init', 'final_confirm']);
export const MAX_TITLE = 120;
export const MAX_TEXT = 300;

export const cloneChecklist = (checklist) => ({
  groups: (checklist?.groups || []).map((group) => ({
    id: group.id,
    title: group.title,
    icon: group.icon || DEFAULT_GROUP_ICON,
    items: (group.items || []).map((item) => ({ id: item.id, text: item.text })),
  })),
});

export const allIds = (checklist) => {
  const ids = new Set(RESERVED_IDS);
  (checklist?.groups || []).forEach((group) => {
    ids.add(group.id);
    (group.items || []).forEach((item) => ids.add(item.id));
  });
  return ids;
};

export const itemIds = (checklist) =>
  (checklist?.groups || []).flatMap((group) => (group.items || []).map((item) => item.id));

// A new id that is not used anywhere in the checklist (nor reserved).
export const newId = (prefix, usedIds, random = Math.random) => {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = `${prefix}-${random().toString(36).slice(2, 8)}`;
    if (/^[A-Za-z0-9_-]{1,64}$/.test(candidate) && !usedIds.has(candidate)) return candidate;
  }
  throw new Error('Could not create a unique id');
};

export const moveInArray = (array, index, delta) => {
  const target = index + delta;
  if (target < 0 || target >= array.length) return array;
  const next = array.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

export const itemLabel = (groupIndex, itemIndex) => `${groupIndex + 1}.${itemIndex + 1}`;

// First problem that would make the backend refuse the checklist, or ''.
export const checklistProblem = (checklist) => {
  const groups = checklist?.groups || [];
  for (let g = 0; g < groups.length; g += 1) {
    const title = String(groups[g].title || '').trim();
    if (!title) return `Group ${g + 1} needs a title.`;
    if (title.length > MAX_TITLE) return `The title of group ${g + 1} is longer than ${MAX_TITLE} characters.`;
    const items = groups[g].items || [];
    for (let i = 0; i < items.length; i += 1) {
      const text = String(items[i].text || '').trim();
      if (!text) return `Check ${itemLabel(g, i)} has no text.`;
      if (text.length > MAX_TEXT) return `Check ${itemLabel(g, i)} is longer than ${MAX_TEXT} characters.`;
    }
  }
  return '';
};

// Trimmed copy for saving.
export const cleanForSave = (checklist) => ({
  groups: (checklist?.groups || []).map((group) => ({
    id: group.id,
    title: String(group.title || '').trim(),
    icon: group.icon || DEFAULT_GROUP_ICON,
    items: (group.items || []).map((item) => ({ id: item.id, text: String(item.text || '').trim() })),
  })),
});

// Items present before editing and missing after (their ticks stop counting).
export const removedItems = (before, after) => {
  const kept = new Set(itemIds(after));
  return (before?.groups || []).flatMap((group) =>
    (group.items || []).filter((item) => !kept.has(item.id)));
};
