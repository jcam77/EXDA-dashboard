import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = process.cwd();
const requestedPython = process.env.EXDA_PYTHON;

// Each operating system keeps its own Python environment, so one EXDA folder
// (for example on a shared or external drive) can be used from macOS, Windows
// and Linux: .venv-mac on macOS, .venv-win on Windows, .venv-linux on Linux.
// A plain .venv (older Linux installs, hand-made venvs) is the fallback.
const OS_VENV = { darwin: '.venv-mac', win32: '.venv-win', linux: '.venv-linux' };
const venvPython = (dir) => (process.platform === 'win32'
  ? path.join(repoRoot, dir, 'Scripts', 'python.exe')
  : path.join(repoRoot, dir, 'bin', 'python'));

const candidates = [
  requestedPython,
  OS_VENV[process.platform] && venvPython(OS_VENV[process.platform]),
  venvPython('.venv'),
  process.platform === 'win32' ? 'python' : 'python3',
  'python',
].filter(Boolean);

const resolvePython = () => {
  for (const candidate of candidates) {
    if (!candidate.includes(path.sep) || existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
};

const pythonCmd = resolvePython();
const child = spawn(pythonCmd, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`Failed to start Python command "${pythonCmd}":`, error.message);
  process.exit(1);
});
