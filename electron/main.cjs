const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
let backendProcess = null;
let backendPort = 5000;

const DEMO_PROJECT_NAME = 'VH2D-Project';
const DEMO_PARENT_DIR = 'Demo Projects';
const PROJECTS_ROOT_DIR = 'EXDA Projects';

const resolveDemoSource = () => {
  if (isDev) {
    return path.join(app.getAppPath(), 'Demo Projects', DEMO_PROJECT_NAME);
  }
  return path.join(process.resourcesPath, 'Demo Projects', DEMO_PROJECT_NAME);
};

const ensureDemoProject = () => {
  const demoSource = resolveDemoSource();
  if (!fs.existsSync(demoSource)) {
    return null;
  }
  const baseRoot = path.join(app.getPath('documents'), PROJECTS_ROOT_DIR, DEMO_PARENT_DIR);
  const demoTarget = path.join(baseRoot, DEMO_PROJECT_NAME);
  if (!fs.existsSync(demoTarget)) {
    fs.mkdirSync(baseRoot, { recursive: true });
    fs.cpSync(demoSource, demoTarget, { recursive: true, dereference: true });
  }
  return baseRoot;
};

const resolveBackendCommand = () => {
  if (process.env.EXDA_BACKEND_PATH) {
    return { cmd: process.env.EXDA_BACKEND_PATH, args: [] };
  }
  if (isDev) {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    return { cmd: pythonCmd, args: ['backend/app.py'] };
  }
  const exeName = process.platform === 'win32' ? 'exda-backend.exe' : 'exda-backend';
  const candidates = [
    path.join(process.resourcesPath, 'backend', exeName),
    path.join(process.resourcesPath, 'backend', 'dist', exeName),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'dist', exeName),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  return {
    cmd: resolved || candidates[0],
    args: [],
  };
};

const findFreePort = (preferredPort = 5000) => new Promise((resolve) => {
  const tryServer = net.createServer();
  tryServer.unref();
  tryServer.on('error', () => {
    const fallback = net.createServer();
    fallback.unref();
    fallback.listen(0, () => {
      const { port } = fallback.address();
      fallback.close(() => resolve(port));
    });
  });
  tryServer.listen(preferredPort, () => {
    const { port } = tryServer.address();
    tryServer.close(() => resolve(port));
  });
});

const startBackend = (port) => {
  if (backendProcess) return;
  const demoRoot = ensureDemoProject();
  const { cmd, args } = resolveBackendCommand();
  const env = {
    ...process.env,
    EXDA_PROJECTS_ROOT: demoRoot || process.env.EXDA_PROJECTS_ROOT || '',
    EXDA_BACKEND_PORT: String(port),
  };
  const backendCwd = isDev ? app.getAppPath() : process.resourcesPath;
  backendProcess = spawn(cmd, args, {
    cwd: backendCwd,
    env,
    stdio: 'pipe',
  });

  backendProcess.stdout.on('data', (data) => {
    process.stdout.write(`[backend] ${data}`);
  });
  backendProcess.stderr.on('data', (data) => {
    process.stderr.write(`[backend] ${data}`);
  });
  backendProcess.on('exit', () => {
    backendProcess = null;
  });
};

const stopBackend = () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
};

const createWindow = (port) => {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0b0f14',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  setTimeout(() => {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 2000);

  const query = `?backendPort=${encodeURIComponent(port)}`;
  if (isDev) {
    mainWindow.loadURL(`http://localhost:5173${query}`);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'frontend', 'dist', 'index.html'), { query: { backendPort: String(port) } });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Window failed to load:', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
};

app.whenReady().then(async () => {
  backendPort = await findFreePort(5000);
  startBackend(backendPort);
  createWindow(backendPort);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBackend();
    app.quit();
  }
});

app.on('quit', () => {
  stopBackend();
});
