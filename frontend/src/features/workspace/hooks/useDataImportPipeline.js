import { useCallback } from 'react';
import {
  buildServerAuxCandidates,
  countFilesInFolder,
  countSimulationCases,
  findBrowserAuxFiles,
} from '../dataImportRules';

const readBrowserFile = (fileObj) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.readAsText(fileObj);
  });

export const useDataImportPipeline = ({
  apiBaseUrl,
  projectPath,
  sessionFiles,
  expFiles,
  simulationData,
  experimentalData,
  settings,
  processFile,
  notify,
  setSessionFiles,
  setExpFiles,
  setSelectedExpFolder,
  setSimulationData,
  setSelectedCases,
  setExperimentalData,
}) => {
  const readProjectFile = useCallback(
    async (filePath) => {
      const res = await fetch(
        `${apiBaseUrl}/read_project_file?path=${encodeURIComponent(filePath)}&projectPath=${encodeURIComponent(projectPath || '')}`
      );
      const data = await res.json();
      return data.success ? data.content : null;
    },
    [apiBaseUrl, projectPath]
  );

  const onSimFolder = useCallback(
    async (event) => {
      const manualPath = event.target.manualPath;
      const browserFiles = event.target.files ? Array.from(event.target.files) : null;

      if (manualPath) {
        try {
          const res = await fetch(
            `${apiBaseUrl}/get_project_state?projectPath=${encodeURIComponent(projectPath)}&sync=true`
          );
          const state = await res.json();
          if (state.success && state.sim_files) {
            setSessionFiles(state.sim_files);
            const count = countSimulationCases(state.sim_files, manualPath);
            notify('success', 'Simulation Data Found', `${count} valid cases indexed in selected folder.`);
          } else {
            throw new Error('No simulation files found in the directory.');
          }
        } catch (err) {
          notify('error', 'Sync Failed', err.message || 'Could not scan simulation directory.');
        }
      } else if (browserFiles) {
        setSessionFiles(browserFiles.sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath)));
      }
    },
    [apiBaseUrl, notify, projectPath, setSessionFiles]
  );

  const onExpFolder = useCallback(
    async (event) => {
      const manualPath = event.target.manualPath;
      if (!manualPath) return;

      setSelectedExpFolder(manualPath);
      const res = await fetch(
        `${apiBaseUrl}/get_project_state?projectPath=${encodeURIComponent(projectPath)}&folderPath=${encodeURIComponent(manualPath)}`
      );
      const state = await res.json();
      if (state.success) {
        setExpFiles(state.data_files);
        const count = countFilesInFolder(state.data_files, manualPath);
        notify('success', 'Folder Synced', `${count} files detected in selected directory.`);
      }
    },
    [apiBaseUrl, notify, projectPath, setExpFiles, setSelectedExpFolder]
  );

  const onFileSelect = useCallback(
    async (event, type) => {
      const filePath = event.target.value;
      if (!filePath) return;

      if (type === 'simulation') {
        const main = sessionFiles.find((fileObj) => fileObj.webkitRelativePath === filePath || fileObj.path === filePath);
        if (main) {
          let content;
          let toaContent;
          let ventContent;

          if (main.path) {
            content = await readProjectFile(main.path);
            const getFirstExisting = async (paths) => {
              for (const candidate of paths) {
                const fileContent = await readProjectFile(candidate);
                if (fileContent) return fileContent;
              }
              return null;
            };
            const { toaCandidates, ventCandidates } = buildServerAuxCandidates(main.path);
            toaContent = await getFirstExisting(toaCandidates);
            ventContent = await getFirstExisting(ventCandidates);
          } else {
            content = await readBrowserFile(main);
            const { toaFile, ventFile } = findBrowserAuxFiles(sessionFiles, main.webkitRelativePath || '');
            toaContent = toaFile ? await readBrowserFile(toaFile) : null;
            ventContent = ventFile ? await readBrowserFile(ventFile) : null;
          }

          const nextCase = {
            name: main.name,
            path: main.path || main.webkitRelativePath,
            content,
            toaContent,
            ventContent,
          };

          setSimulationData((prev) => [...prev.filter((item) => item.path !== nextCase.path), nextCase]);
          setSelectedCases((prev) => [...prev.filter((item) => item.path !== nextCase.path), nextCase]);
        }
      } else if (type === 'exp_pressure' || type === 'exp_flame') {
        const selectedFile = expFiles.find((fileObj) => fileObj.webkitRelativePath === filePath || fileObj.path === filePath);
        if (selectedFile) {
          const content = selectedFile.path
            ? await readProjectFile(selectedFile.path)
            : await readBrowserFile(selectedFile);

          const expCase = {
            name: selectedFile.name,
            path: selectedFile.path || selectedFile.webkitRelativePath,
            content,
            type: type === 'exp_pressure' ? 'pressure' : 'flame',
          };

          setSelectedCases((prev) => {
            if (prev.some((item) => (item.path || item.name) === (expCase.path || expCase.name))) return prev;
            return [...prev, expCase];
          });

          if (type === 'exp_pressure') {
            const experimentalCutoff = Number.isFinite(Number(settings.experimentalCutoff))
              ? Number(settings.experimentalCutoff)
              : settings.cutoff;
            const experimentalOrder = Number.isFinite(Number(settings.experimentalOrder))
              ? Number(settings.experimentalOrder)
              : settings.order;
            processFile({ name: selectedFile.name, content }, 'pressure', {
              useRaw: Boolean(settings.experimentalUseRaw),
              cutoff: experimentalCutoff,
              order: experimentalOrder,
            }).then((result) => {
              if (result) {
                setExperimentalData((prev) => [
                  ...prev.filter((item) => item.name !== result.name || item.type !== 'pressure'),
                  { ...result, type: 'pressure', path: selectedFile.path || selectedFile.webkitRelativePath },
                ]);
              }
            });
          } else {
            processFile({ name: selectedFile.name, content }, 'flame_speed').then((result) => {
              if (result) {
                setExperimentalData((prev) => [
                  ...prev.filter((item) => item.name !== result.name || item.type !== 'flame'),
                  { ...result, type: 'flame', path: selectedFile.path || selectedFile.webkitRelativePath },
                ]);
              }
            });
          }
        }
      }

      event.target.value = '';
    },
    [
      expFiles,
      processFile,
      readProjectFile,
      sessionFiles,
      setExperimentalData,
      setSelectedCases,
      setSimulationData,
      settings,
    ]
  );

  const onRemoveCase = useCallback(
    (path) => {
      setSelectedCases((prev) => prev.filter((item) => item.path !== path));
      setSimulationData((prev) => prev.filter((item) => item.path !== path));
      setExperimentalData((prev) => prev.filter((item) => (item.path || item.name) !== path));
    },
    [setExperimentalData, setSelectedCases, setSimulationData]
  );

  const onToggleCase = useCallback(
    (path) => {
      setSelectedCases((prev) => {
        if (prev.find((item) => item.path === path || item.name === path)) {
          return prev.filter((item) => !(item.path === path || item.name === path));
        }
        const simCase = simulationData.find((item) => item.path === path);
        if (simCase) return [...prev, simCase];
        const expCase = experimentalData.find((item) => item.path === path || item.name === path);
        if (expCase) return [...prev, expCase];
        return prev;
      });
    },
    [experimentalData, setSelectedCases, simulationData]
  );

  return {
    onSimFolder,
    onExpFolder,
    onFileSelect,
    onRemoveCase,
    onToggleCase,
  };
};
