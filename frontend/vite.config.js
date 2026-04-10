import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

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

const appVersion = process.env.EXDA_APP_VERSION || gitVersion || pkg.version || '0.0.0'
const lastUpdated = process.env.EXDA_LAST_UPDATED || gitUpdated || pkg.lastUpdated || new Date().toISOString()

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  root: __dirname,
  // Use relative asset paths for packaged Electron builds (file://).
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __LAST_UPDATED__: JSON.stringify(lastUpdated),
  },
}))
