import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  // R3 default plan (plan.md § Iteration 24): resolve `@cerefox/schemas` to
  // the shared zod source-of-truth at `_shared/schemas/`. Vite handles the
  // .js → .ts extension rewrite via its bundler-style moduleResolution.
  resolve: {
    alias: {
      '@cerefox/schemas': path.resolve(here, '..', '_shared', 'schemas'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
