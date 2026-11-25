import { describe, expect, it } from 'vitest';
import {
  buildCapabilityCloud, CAPABILITY_FIELDS, FLAT_FONT_SIZE, layoutCloud, termFontSize, termTitle,
} from '../src/utils/capabilityCloud';

const project = (name, capabilities) => ({ name, capabilities });

describe('capabilities cloud', () => {
  it('is empty when no projects are loaded', () => {
    expect(buildCapabilityCloud([])).toEqual({ terms: [], described: 0, total: 0 });
    expect(buildCapabilityCloud()).toEqual({ terms: [], described: 0, total: 0 });
  });

  it('counts each term once per project, ignoring case, most used first', () => {
    const cloud = buildCapabilityCloud([
      project('Wk22', { methods: ['vented explosion', 'DAQ characterisation'], measured_quantities: ['pressure'] }),
      project('Wk27', { methods: ['Vented explosion', 'vented  explosion'], facility: ['VH2D chamber'] }),
      project('Empty', {}),
    ]);
    expect(cloud.total).toBe(3);
    expect(cloud.described).toBe(2);
    expect(cloud.terms[0]).toEqual({ field: 'methods', value: 'vented explosion', count: 2, projects: ['Wk22', 'Wk27'] });
    expect(cloud.terms.map((t) => t.value)).toEqual(['vented explosion', 'DAQ characterisation', 'pressure', 'VH2D chamber']);
  });

  it('keeps the same word in different fields apart', () => {
    const cloud = buildCapabilityCloud([project('A', { methods: ['pressure'], keywords: ['pressure'] })]);
    expect(cloud.terms.map((t) => t.field)).toEqual(['methods', 'keywords']);
  });

  it('ignores fields that are not capabilities', () => {
    const cloud = buildCapabilityCloud([project('A', { partners: ['LU'], methods: [] })]);
    expect(cloud.terms).toEqual([]);
    expect(cloud.described).toBe(0);
    expect(CAPABILITY_FIELDS.map((f) => f.id)).not.toContain('partners');
  });

  it('sizes words by use, within limits', () => {
    expect(termFontSize(1, 1, 1)).toBe(FLAT_FONT_SIZE);
    expect(termFontSize(3, 3, 3)).toBe(FLAT_FONT_SIZE);
    expect(termFontSize(1, 5, 1)).toBe(14);
    expect(termFontSize(5, 5, 1)).toBe(46);
    expect(termFontSize(3, 5, 1)).toBeGreaterThan(14);
    expect(termFontSize(3, 5, 1)).toBeLessThan(46);
  });

  it('lays the words out without overlaps, the most used in the centre, the same every time', () => {
    const projects = [
      project('A', { methods: ['vented explosion', 'CFD validation'], keywords: ['P2X', 'venting'], facility: ['chamber'] }),
      project('B', { methods: ['vented explosion'], keywords: ['P2X', 'mitigation'], fuels: ['H2-air'] }),
      project('C', { methods: ['vented explosion'], keywords: ['P2X'], measured_quantities: ['pressure', 'impulse'] }),
    ];
    const { terms } = buildCapabilityCloud(projects);
    const measure = (text, size) => text.length * size * 0.55;
    const first = layoutCloud(terms, measure);
    expect(first.words).toHaveLength(terms.length);
    for (let i = 0; i < first.words.length; i += 1) {
      for (let j = i + 1; j < first.words.length; j += 1) {
        const a = first.words[i];
        const b = first.words[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
    const top = first.words[0];
    expect(top.term.count).toBe(3);
    expect(Math.abs(top.x + top.w / 2)).toBeLessThan(1);
    expect(top.vertical).toBe(false);
    expect(first.words.some((word) => word.vertical)).toBe(true);
    expect(first.words[0].fontSize).toBeGreaterThan(first.words[first.words.length - 1].fontSize);
    expect(layoutCloud(terms, measure)).toEqual(first);
  });

  it('keeps long phrases horizontal', () => {
    const terms = ['a', 'b', 'homogeneous hydrogen + air flammable mixture'].map((value) => ({ field: 'fuels', value, count: 1, projects: ['A'] }));
    const { words } = layoutCloud(terms, (text, size) => text.length * size * 0.55);
    expect(words[2].vertical).toBe(false);
  });

  it('explains a word with its projects', () => {
    expect(termTitle({ count: 2, projects: ['Wk27', 'Wk22'] }, 'Methods'))
      .toBe('Methods: used in 2 projects (Wk22, Wk27). Click to find them.');
  });
});
