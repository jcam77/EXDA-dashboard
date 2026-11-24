// Version of each project file as this window last loaded or saved it.
// Saves send it back as `baseVersion`; the backend refuses (409) when the file
// changed elsewhere in between, instead of overwriting that change.
// Shared by all pages in this window, so a save on one page updates the
// version another page will send.

const versions = new Map();

const keyFor = (projectPath, kind) => `${String(projectPath || '')}::${kind}`;

export const rememberVersion = (projectPath, kind, version) => {
  if (!projectPath || !kind || version === undefined || version === null) return;
  versions.set(keyFor(projectPath, kind), String(version));
};

// undefined = this window never loaded the file: no check is requested.
export const baseVersionFor = (projectPath, kind) => {
  const key = keyFor(projectPath, kind);
  return versions.has(key) ? versions.get(key) : undefined;
};

export const forgetVersions = (projectPath) => {
  const prefix = `${String(projectPath || '')}::`;
  Array.from(versions.keys()).forEach((key) => {
    if (key.startsWith(prefix)) versions.delete(key);
  });
};

// 409 = changed elsewhere, 423 = project open for editing in another app.
export const isStoreConflict = (response, payload) =>
  Boolean(response && (response.status === 409 || response.status === 423) && (payload?.conflict || payload?.locked));

export const FILE_KINDS = {
  checklist: 'checklist',
  checklistDefinition: 'checklist-definition',
  projectDescription: 'project-description',
  daq: 'daq',
  gas: 'gas',
  sensors: 'sensors',
  cameras: 'cameras',
  plan: (filename) => `plan:${String(filename || '').toLowerCase()}`,
};
