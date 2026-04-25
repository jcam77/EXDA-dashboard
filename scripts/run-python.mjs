import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = process.cwd();
const requestedPython = process.env.EXDA_PYTHON;
const candidates = [
  requestedPython,
  path.join(repoRoot, '.venv', 'bin', 'python'),
  path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
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
