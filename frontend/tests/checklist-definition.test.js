import { describe, expect, it } from 'vitest';
import {
  allIds, checklistProblem, cleanForSave, cloneChecklist, itemIds, itemLabel, moveInArray, newId, removedItems,
} from '../src/utils/checklistDefinition';

const sample = {
  groups: [
    { id: 'facility', title: 'Facility', icon: 'warehouse', items: [{ id: 'vent', text: 'Vent OFF' }, { id: 'gate', text: 'Gate closed' }] },
    { id: 'group-x', title: 'Extra', icon: 'list-checks', items: [] },
  ],
};

describe('checklist definition helpers', () => {
  it('numbers follow the order on screen', () => {
    expect(itemLabel(0, 0)).toBe('1.1');
    expect(itemLabel(3, 2)).toBe('4.3');
  });

  it('new ids never clash with existing or reserved ids', () => {
    const used = allIds(sample);
    expect(used.has('final_confirm')).toBe(true);
    const values = [0.1, 0.1, 0.5];
    let call = 0;
    const fake = () => values[Math.min(call++, values.length - 1)];
    const first = newId('item', used, fake);
    used.add(first);
    const second = newId('item', used, fake); // same random value first -> must retry
    expect(second).not.toBe(first);
    expect(first).toMatch(/^item-[a-z0-9]+$/);
  });

  it('moving keeps all items and ignores moves past the ends', () => {
    expect(moveInArray(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveInArray(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveInArray(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('reports what the backend would refuse', () => {
    expect(checklistProblem(sample)).toBe('');
    const noText = cloneChecklist(sample);
    noText.groups[0].items[1].text = '  ';
    expect(checklistProblem(noText)).toBe('Check 1.2 has no text.');
    const noTitle = cloneChecklist(sample);
    noTitle.groups[1].title = '';
    expect(checklistProblem(noTitle)).toBe('Group 2 needs a title.');
  });

  it('trims texts for saving and keeps ids (ticks stay attached)', () => {
    const draft = cloneChecklist(sample);
    draft.groups[0].items[0].text = '  Vent OFF (renamed)  ';
    const clean = cleanForSave(draft);
    expect(clean.groups[0].items[0]).toEqual({ id: 'vent', text: 'Vent OFF (renamed)' });
    expect(itemIds(clean)).toEqual(['vent', 'gate']);
  });

  it('lists the checks removed by an edit', () => {
    const draft = cloneChecklist(sample);
    draft.groups[0].items = draft.groups[0].items.filter((item) => item.id !== 'gate');
    expect(removedItems(sample, draft).map((item) => item.id)).toEqual(['gate']);
    expect(removedItems(sample, cloneChecklist(sample))).toEqual([]);
  });

  it('editing a copy does not change the original', () => {
    const draft = cloneChecklist(sample);
    draft.groups[0].items[0].text = 'changed';
    expect(sample.groups[0].items[0].text).toBe('Vent OFF');
  });
});
