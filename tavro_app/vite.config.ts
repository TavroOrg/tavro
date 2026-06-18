import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Read env vars from the Node.js process without requiring @types/node.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _penv: Record<string, string | undefined> = (globalThis as any).process?.env ?? {}

const copilotApiUrl = _penv.VITE_COPILOT_API_URL ?? 'http://localhost:4001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9000,
    proxy: {
      '/runtime': {
        target: 'http://localhost:9000',
        changeOrigin: true,
        bypass: (req) => {
          const host = req.headers.host || '';
          if (host.startsWith('localhost:9000') || host.startsWith('127.0.0.1:9000')) {
            return false;
          }
        }
      },
      '/api/github': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/github/, '')
      },
      '/copilot-api': {
        target: copilotApiUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/copilot-api/, '')
      }
    }
  }
})