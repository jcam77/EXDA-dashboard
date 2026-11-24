import { describe, expect, it } from 'vitest';
import {
  addTag, canonicalTag, cloneDescription, descriptionProblem, filledCount, matchSuggestions, newExtraId, sameDescription,
} from '../src/utils/projectDescription';

const fields = [
  { id: 'methods', label: 'Methods', kind: 'tags' },
  { id: 'research_questions', label: 'Research questions', kind: 'text' },
];
const known = [{ value: 'pressure', count: 3 }, { value: 'flame arrival', count: 2 }, { value: 'H2 concentration', count: 1 }];

describe('project description helpers', () => {
  it('reuses the known spelling of a term', () => {
    expect(canonicalTag('  Pressure ', known)).toBe('pressure');
    expect(canonicalTag('new  term', known)).toBe('new term');
  });

  it('adds a term once, ignoring case and spaces', () => {
    expect(addTag(['pressure'], 'PRESSURE')).toEqual(['pressure']);
    expect(addTag(['pressure'], '  ')).toEqual(['pressure']);
    expect(addTag(['pressure'], ' flame  arrival ')).toEqual(['pressure', 'flame arrival']);
  });

  it('suggests matching terms, starts-with first, without terms already chosen', () => {
    expect(matchSuggestions('a', known).map((s) => s.value)).toEqual(['flame arrival', 'H2 concentration']);
    expect(matchSuggestions('', known, ['pressure']).map((s) => s.value)).toEqual(['flame arrival', 'H2 concentration']);
    expect(matchSuggestions('fl', known).map((s) => s.value)).toEqual(['flame arrival']);
  });

  it('reports extra fields the backend would refuse', () => {
    expect(descriptionProblem({ extra: [{ label: 'Vent' }] }, fields)).toBe('');
    expect(descriptionProblem({ extra: [{ label: ' ' }] }, fields)).toBe('Extra field 1 needs a name.');
    expect(descriptionProblem({ extra: [{ label: 'methods' }] }, fields)).toBe('"methods" is already a standard field.');
    expect(descriptionProblem({ extra: [{ label: 'Vent' }, { label: 'vent' }] }, fields))
      .toBe('There is already a field called "vent".');
  });

  it('counts filled standard fields and detects changes on a copy', () => {
    const original = { standard: { methods: ['vented explosion'], research_questions: '' }, extra: [] };
    expect(filledCount(original, fields)).toBe(1);
    const draft = cloneDescription(original);
    expect(sameDescription(original, draft)).toBe(true);
    draft.standard.research_questions = 'Why?';
    expect(sameDescription(original, draft)).toBe(false);
    expect(original.standard.research_questions).toBe('');
  });

  it('makes extra field ids that do not clash', () => {
    const values = [0.5, 0.5, 0.25];
    let call = 0;
    const fake = () => values[Math.min(call++, values.length - 1)];
    const first = newExtraId([], fake);
    const second = newExtraId([{ id: first }], fake);
    expect(second).not.toBe(first);
    expect(first).toMatch(/^extra-[a-z0-9]+$/);
  });
});
