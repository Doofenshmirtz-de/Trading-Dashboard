import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitest.dev/config/
// envDir + root = Ordner dieser Datei, damit .env / .env.local immer aus
// `trading-bot-arena/frontend` geladen werden – auch wenn z. B. `vite`
// vom Repo-Root mit `--config` gestartet wird.
const appRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: appRoot,
  envDir: appRoot,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
