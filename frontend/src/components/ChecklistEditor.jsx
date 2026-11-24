import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import ChecklistGroupIcon from './ChecklistGroupIcon';
import {
  allIds, DEFAULT_GROUP_ICON, ICON_CHOICES, itemLabel, MAX_TEXT, MAX_TITLE, moveInArray, newId,
} from '../utils/checklistDefinition';

// Edit mode of the checklist: same two-column grid as the normal view, with
// inputs and small controls. Changes stay in the draft until Save.

const ICON_BUTTON = 'inline-flex h-7 w-7 items-center justify-center rounded border border-sidebar-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-30 disabled:hover:bg-muted/30';
const INPUT = 'w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-ring';

const ChecklistEditor = ({ draft, setDraft, confirmDeleteGroup }) => {
  const groups = draft.groups;

  const updateGroups = (fn) => setDraft((prev) => ({ ...prev, groups: fn(prev.groups) }));
  const updateGroup = (gIdx, patch) => updateGroups((gs) => gs.map((g, i) => (i === gIdx ? { ...g, ...patch } : g)));
  const updateItems = (gIdx, fn) => updateGroups((gs) => gs.map((g, i) => (i === gIdx ? { ...g, items: fn(g.items) } : g)));

  const addItem = (gIdx) => updateItems(gIdx, (items) => [...items, { id: newId('item', allIds(draft)), text: '' }]);
  const addGroup = () => updateGroups((gs) => [
    ...gs,
    { id: newId('group', allIds(draft)), title: '', icon: DEFAULT_GROUP_ICON, items: [{ id: newId('item', allIds(draft)), text: '' }] },
  ]);
  const deleteGroup = async (gIdx) => {
    if (await confirmDeleteGroup(groups[gIdx])) updateGroups((gs) => gs.filter((_, i) => i !== gIdx));
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 items-start">
      {groups.map((group, gIdx) => (
        <div key={group.id} className="rounded-xl border border-primary/30 bg-card/50 p-5">
          <div className="flex items-center gap-2 mb-4">
            <ChecklistGroupIcon name={group.icon} />
            <span className="text-sm font-black uppercase whitespace-nowrap">Group {gIdx + 1}:</span>
            <input
              className={`${INPUT} font-semibold`}
              value={group.title}
              maxLength={MAX_TITLE}
              placeholder="Group title"
              onChange={(e) => updateGroup(gIdx, { title: e.target.value })}
            />
            <select
              className="bg-background border border-border rounded-lg px-1 py-1.5 text-xs"
              value={group.icon}
              title="Group icon"
              onChange={(e) => updateGroup(gIdx, { icon: e.target.value })}
            >
              {ICON_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
            <button type="button" className={ICON_BUTTON} title="Move group up" disabled={gIdx === 0}
              onClick={() => updateGroups((gs) => moveInArray(gs, gIdx, -1))}><ArrowUp size={14} /></button>
            <button type="button" className={ICON_BUTTON} title="Move group down" disabled={gIdx === groups.length - 1}
              onClick={() => updateGroups((gs) => moveInArray(gs, gIdx, 1))}><ArrowDown size={14} /></button>
            <button type="button" className={`${ICON_BUTTON} hover:text-red-400`} title="Delete group"
              onClick={() => deleteGroup(gIdx)}><Trash2 size={14} /></button>
          </div>

          <div className="space-y-2">
            {group.items.length === 0 && (
              <div className="text-xs text-muted-foreground italic px-1">No checks yet.</div>
            )}
            {group.items.map((item, iIdx) => (
              <div key={item.id} className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">{itemLabel(gIdx, iIdx)}</span>
                <input
                  className={INPUT}
                  value={item.text}
                  maxLength={MAX_TEXT}
                  placeholder="Describe the check"
                  onChange={(e) => updateItems(gIdx, (items) => items.map((it, i) => (i === iIdx ? { ...it, text: e.target.value } : it)))}
                />
                <button type="button" className={ICON_BUTTON} title="Move up" disabled={iIdx === 0}
                  onClick={() => updateItems(gIdx, (items) => moveInArray(items, iIdx, -1))}><ArrowUp size={14} /></button>
                <button type="button" className={ICON_BUTTON} title="Move down" disabled={iIdx === group.items.length - 1}
                  onClick={() => updateItems(gIdx, (items) => moveInArray(items, iIdx, 1))}><ArrowDown size={14} /></button>
                <button type="button" className={`${ICON_BUTTON} hover:text-red-400`} title="Delete check"
                  onClick={() => updateItems(gIdx, (items) => items.filter((_, i) => i !== iIdx))}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => addItem(gIdx)}
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            <Plus size={12} /> Add check
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addGroup}
        className="flex min-h-[120px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sidebar-border text-sm font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary transition"
      >
        <Plus size={18} /> Add group
      </button>
    </div>
  );
};

export default ChecklistEditor;
