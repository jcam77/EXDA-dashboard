import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { addTag, canonicalTag, matchSuggestions } from '../utils/projectDescription';

// Short terms as chips. While typing, terms used in other projects are offered,
// and a typed term that matches one takes its spelling.
// Arrow keys pick a suggestion; Enter adds the picked suggestion, or else exactly
// what was typed. Comma adds what was typed. Backspace on an empty box removes the last term.
const TagInput = ({ value = [], onChange, suggestions = [], placeholder = '', disabled = false, label = '' }) => {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);  // -1 = no suggestion picked
  const inputRef = useRef(null);

  const available = matchSuggestions(text, suggestions, value);
  const matches = open ? available : [];

  const commit = (raw) => {
    const tag = canonicalTag(raw, suggestions);
    if (tag) onChange(addTag(value, tag));
    setText('');
    setHighlight(-1);
    // Close the list after adding, so it does not cover the next field.
    setOpen(false);
  };

  const remove = (tag) => onChange(value.filter((item) => item !== tag));

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' && available.length) {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => (index + 1) % available.length);
    } else if (event.key === 'ArrowUp' && matches.length) {
      event.preventDefault();
      setHighlight((index) => (index <= 0 ? matches.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (matches[highlight]) commit(matches[highlight].value);
      else if (text.trim()) commit(text);
    } else if (event.key === ',') {
      event.preventDefault();
      commit(text);
    } else if (event.key === 'Backspace' && !text && value.length) {
      remove(value[value.length - 1]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-md border border-sidebar-border bg-input px-2 py-1.5 ${
          disabled ? 'opacity-60' : 'focus-within:border-primary/60'
        }`}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); remove(tag); }}
                aria-label={`Remove ${tag}`}
                className="rounded text-primary/70 hover:text-primary"
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            ref={inputRef}
            value={text}
            aria-label={label}
            onChange={(event) => { setText(event.target.value); setOpen(true); setHighlight(-1); }}
            onFocus={() => setOpen(true)}
            onBlur={() => { if (text.trim()) commit(text); setOpen(false); }}
            onKeyDown={onKeyDown}
            aria-autocomplete="list"
            placeholder={value.length ? '' : placeholder}
            className="min-w-[8rem] flex-1 bg-transparent py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        )}
        {disabled && !value.length && <span className="py-0.5 text-sm text-muted-foreground/70">—</span>}
      </div>
      {matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto rounded-md border border-sidebar-border bg-card py-1 shadow-lg"
        >
          {matches.map((item, index) => (
            <li
              key={item.value}
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => { event.preventDefault(); commit(item.value); }}
              onMouseEnter={() => setHighlight(index)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm ${
                index === highlight ? 'bg-primary/10 text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span className="truncate">{item.value}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {item.count} {item.count === 1 ? 'project' : 'projects'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TagInput;
