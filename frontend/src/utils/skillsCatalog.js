// The team's standard list of technical skills (backend: modules/skills_catalog.py).
// catalog = { categories: [{ name, skills: [{ name, addedBy?, addedAt? }] }] }

const norm = (text) => String(text || '').trim().replace(/\s+/g, ' ');

export const catalogSkillNames = (catalog) => (catalog?.categories || [])
  .flatMap((category) => (category.skills || []).map((skill) => skill.name));

// The list's spelling of a name (ignoring case), or '' if it is not in the list.
export const findCatalogSkill = (catalog, name) => {
  const key = norm(name).toLowerCase();
  if (!key) return '';
  return catalogSkillNames(catalog).find((skill) => skill.toLowerCase() === key) || '';
};

// Skills matching the query (in the skill name or its category), not chosen
// yet, grouped by category in list order. An empty query lists everything.
export const filterCatalog = (catalog, query = '', chosen = []) => {
  const q = norm(query).toLowerCase();
  const taken = new Set(chosen.map((name) => norm(name).toLowerCase()));
  return (catalog?.categories || [])
    .map((category) => {
      const categoryMatches = q && category.name.toLowerCase().includes(q);
      const skills = (category.skills || [])
        .map((skill) => skill.name)
        .filter((name) => !taken.has(name.toLowerCase()))
        .filter((name) => !q || categoryMatches || name.toLowerCase().includes(q));
      return { category: category.name, skills };
    })
    .filter((group) => group.skills.length > 0);
};

// Chosen names that are not in the list (e.g. a project shared from another team).
export const skillsOutsideCatalog = (catalog, chosen = []) => (
  catalog ? chosen.filter((name) => !findCatalogSkill(catalog, name)) : []
);
