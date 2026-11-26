import { describe, expect, it } from 'vitest';
import { catalogSkillNames, filterCatalog, findCatalogSkill, skillsOutsideCatalog } from '../src/utils/skillsCatalog';

const catalog = {
  categories: [
    { name: 'Numerical simulation', skills: [{ name: 'CFD (OpenFOAM)' }, { name: 'CFD meshing' }] },
    { name: 'Mechanical design', skills: [{ name: '3D CAD design' }, { name: 'Technical drawings' }] },
  ],
};

describe('technical skills list', () => {
  it('lists every skill name', () => {
    expect(catalogSkillNames(catalog)).toEqual(['CFD (OpenFOAM)', 'CFD meshing', '3D CAD design', 'Technical drawings']);
    expect(catalogSkillNames(null)).toEqual([]);
  });

  it('gives the list spelling, ignoring case and spaces', () => {
    expect(findCatalogSkill(catalog, '  cfd   (openfoam) ')).toBe('CFD (OpenFOAM)');
    expect(findCatalogSkill(catalog, 'simulations')).toBe('');
  });

  it('searches skill names and categories, leaving out chosen skills', () => {
    expect(filterCatalog(catalog, 'cfd', ['CFD meshing'])).toEqual([
      { category: 'Numerical simulation', skills: ['CFD (OpenFOAM)'] },
    ]);
    expect(filterCatalog(catalog, 'mechanical')).toEqual([
      { category: 'Mechanical design', skills: ['3D CAD design', 'Technical drawings'] },
    ]);
    expect(filterCatalog(catalog, '').map((g) => g.category)).toEqual(['Numerical simulation', 'Mechanical design']);
    expect(filterCatalog(catalog, 'welding')).toEqual([]);
  });

  it('reports chosen names that are not in the list', () => {
    expect(skillsOutsideCatalog(catalog, ['CFD meshing', 'Simulations'])).toEqual(['Simulations']);
    expect(skillsOutsideCatalog(null, ['Simulations'])).toEqual([]);
  });
});
