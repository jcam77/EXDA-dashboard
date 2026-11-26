import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { filterCatalog, findCatalogSkill, skillsOutsideCatalog } from '../utils/skillsCatalog';

const NEW_CATEGORY = '__new__';
const FIELD = 'w-full rounded-md border border-sidebar-border bg-input px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/60';

// Technical skills picked from the team's standard list, grouped by category,
// so the same skill has the same name in every project. Typing filters the
// list; a skill that is missing is added to the team list on purpose (with a
// category), and is then picked. Names outside the list (e.g. from a project
// of another team) are kept and marked.
const SkillPicker = ({ value = [], onChange, catalog, catalogError = '', onAddSkill, disabled = false, label = '' }) => {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [adding, setAdding] = useState(null);  // { name, category, newCategory, error, busy }
  const inputRef = useRef(null);

  const groups = useMemo(() => filterCatalog(catalog, text, value), [catalog, text, value]);
  const flat = useMemo(() => groups.flatMap((group) => group.skills), [groups]);
  const outside = useMemo(() => new Set(skillsOutsideCatalog(catalog, value)), [catalog, value]);
  const typed = text.trim();
  const exact = typed ? findCatalogSkill(catalog, typed) : '';
  const canPropose = Boolean(typed && !exact && onAddSkill && catalog);

  const pick = (name) => {
    if (name && !value.some((item) => item.toLowerCase() === name.toLowerCase())) onChange([...value, name]);
    setText('');
    setHighlight(-1);
    setOpen(false);
  };
  const remove = (name) => onChange(value.filter((item) => item !== name));

  const startAdding = () => {
    // No category is preselected: the user chooses one, so a skill never lands in a wrong category.
    setAdding({ name: typed, category: '', newCategory: '', error: '', busy: false });
    setOpen(false);
  };

  const saveNewSkill = async () => {
    const category = adding.category === NEW_CATEGORY ? adding.newCategory : adding.category;
    setAdding((prev) => ({ ...prev, busy: true, error: '' }));
    const result = await onAddSkill(adding.name, category);
    if (result.ok) {
      pick(findCatalogSkill(result.catalog, adding.name) || adding.name.trim());
      setAdding(null);
    } else {
      setAdding((prev) => ({ ...prev, busy: false, error: result.error }));
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' && flat.length) {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => (index + 1) % flat.length);
    } else if (event.key === 'ArrowUp' && flat.length) {
      event.preventDefault();
      setHighlight((index) => (index <= 0 ? flat.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && flat[highlight]) pick(flat[highlight]);
      else if (exact) pick(exact);
      else if (flat.length === 1) pick(flat[0]);
    } else if (event.key === 'Backspace' && !text && value.length) {
      remove(value[value.length - 1]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-md border border-sidebar-border bg-input px-2 py-1.5 ${
          disabled ? 'opacity-60' : 'focus-within:border-primary/60'
        }`}
      >
        {value.map((name) => {
          const unknown = outside.has(name);
          return (
            <span
              key={name}
              title={unknown ? 'Not in the team\'s standard skills list' : undefined}
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${
                unknown ? 'border-warning/50 bg-warning/10 text-warning' : 'border-primary/30 bg-primary/10 text-primary'
              }`}
            >
              {unknown && <AlertTriangle size={11} aria-hidden="true" />}
              {name}
              {!disabled && (
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); remove(name); }}
                  aria-label={`Remove ${name}`}
                  className="rounded opacity-70 hover:opacity-100"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
        {!disabled && (
          <input
            ref={inputRef}
            value={text}
            aria-label={label}
            onChange={(event) => { setText(event.target.value); setOpen(true); setHighlight(-1); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            aria-autocomplete="list"
            placeholder={value.length ? '' : 'Search the skills list, e.g. CFD, imaging, CAD'}
            className="min-w-[10rem] flex-1 bg-transparent py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        )}
        {disabled && !value.length && <span className="py-0.5 text-sm text-muted-foreground/70">—</span>}
      </div>

      {open && !disabled && (groups.length > 0 || canPropose) && (
        <div
          role="listbox"
          aria-label="Technical skills list"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border border-sidebar-border bg-card py-1 shadow-lg"
        >
          {groups.map((group) => (
            <div key={group.category}>
              <div className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.category}
              </div>
              {group.skills.map((name) => {
                const index = flat.indexOf(name);
                return (
                  <div
                    key={name}
                    role="option"
                    aria-selected={index === highlight}
                    onMouseDown={(event) => { event.preventDefault(); pick(name); }}
                    onMouseEnter={() => setHighlight(index)}
                    className={`cursor-pointer px-5 py-1 text-sm ${
                      index === highlight ? 'bg-primary/10 text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {name}
                  </div>
                );
              })}
            </div>
          ))}
          {canPropose && (
            <button
              type="button"
              onMouseDown={(event) => { event.preventDefault(); startAdding(); }}
              className="mt-1 flex w-full items-center gap-2 border-t border-sidebar-border px-3 py-2 text-left text-sm text-primary hover:bg-primary/10"
            >
              <Plus size={14} />
              Add &ldquo;{typed}&rdquo; to the team&apos;s skills list…
            </button>
          )}
        </div>
      )}
      </div>

      {adding && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="text-xs font-semibold text-foreground">Add a skill to the team&apos;s list</div>
          <p className="text-[11px] text-muted-foreground">
            Everyone picks from the same list, so check that the skill is not already there under another name.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-[11px] text-muted-foreground">
              Skill
              <input
                className={FIELD}
                value={adding.name}
                onChange={(event) => { const { value: name } = event.target; setAdding((prev) => ({ ...prev, name })); }}
              />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              Category
              <select
                className={FIELD}
                value={adding.category}
                onChange={(event) => { const { value: category } = event.target; setAdding((prev) => ({ ...prev, category })); }}
              >
                <option value="" disabled>Choose a category…</option>
                {(catalog?.categories || []).map((category) => (
                  <option key={category.name} value={category.name}>{category.name}</option>
                ))}
                <option value={NEW_CATEGORY}>New category…</option>
              </select>
            </label>
          </div>
          {adding.category === NEW_CATEGORY && (
            <input
              className={FIELD}
              aria-label="New category name"
              placeholder="Name of the new category"
              value={adding.newCategory}
              onChange={(event) => { const { value: newCategory } = event.target; setAdding((prev) => ({ ...prev, newCategory })); }}
            />
          )}
          {adding.error && <p className="text-[11px] text-destructive">{adding.error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdding(null)}
              className="rounded-md border border-sidebar-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={adding.busy || !adding.name.trim() || !adding.category
                || (adding.category === NEW_CATEGORY && !adding.newCategory.trim())}
              onClick={saveNewSkill}
              className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {adding.busy ? 'Adding…' : 'Add and use'}
            </button>
          </div>
        </div>
      )}

      {catalogError && <p className="text-[11px] text-destructive">{catalogError}</p>}
    </div>
  );
};

export default SkillPicker;
