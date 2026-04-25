import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
const defaultsPath = path.resolve(__dirname, '..', 'config', 'exda-defaults.env')

function readDefaults() {
  try {
    const raw = fs.readFileSync(defaultsPath, 'utf-8')
    return raw.split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return acc
      const [key, ...rest] = trimmed.split('=')
      acc[key.trim()] = rest.join('=').trim()
      return acc
    }, {})
  } catch {
    return {}
  }
}

function readGitMetadata(command) {
  try {
    return execSync(command, {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).toString().trim()
  } catch {
    return ''
  }
}

let gitVersion = ''
let gitUpdated = ''
gitVersion = readGitMetadata('git describe --tags --always --dirty')
gitUpdated = readGitMetadata('git log -1 --format=%cI')
const defaults = readDefaults()

const appVersion = process.env.EXDA_APP_VERSION || gitVersion || pkg.version || '0.0.0'
const lastUpdated = process.env.EXDA_LAST_UPDATED || gitUpdated || pkg.lastUpdated || new Date().toISOString()
const defaultBackendHost = process.env.EXDA_BACKEND_HOST || defaults.EXDA_DEFAULT_BACKEND_HOST
const defaultBackendPort = process.env.EXDA_BACKEND_PORT || defaults.EXDA_DEFAULT_BACKEND_PORT

if (!defaultBackendHost || !defaultBackendPort) {
  throw new Error('Missing EXDA backend defaults. Define them in config/exda-defaults.env or env vars.')
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  root: __dirname,
  // Use relative asset paths for packaged Electron builds (file://).
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/node_modules/recharts/')) return 'recharts'
          if (id.includes('/node_modules/uplot/')) return 'uplot'
          if (id.includes('/node_modules/marked/')) return 'markdown'
          return undefined
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __LAST_UPDATED__: JSON.stringify(lastUpdated),
    __EXDA_DEFAULT_BACKEND_HOST__: JSON.stringify(defaultBackendHost),
    __EXDA_DEFAULT_BACKEND_PORT__: JSON.stringify(defaultBackendPort),
  },
}))
