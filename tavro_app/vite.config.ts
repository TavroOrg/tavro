import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9000,
    proxy: {
      '/api/github': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/github/, '')
      },
      '/api/tavro-mcp': {
        target: 'https://agent-cloud-dev.tavro.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tavro-mcp/, ''),
        // selfHandleResponse lets us pipe the stream directly, bypassing http-proxy's
        // internal buffering which was causing SSE/chunked responses to hang in the browser.
        selfHandleResponse: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res: any) => {
            // Forward all response headers from upstream to the browser
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            // Pipe the raw upstream stream directly to the browser socket — no buffering
            proxyRes.pipe(res);
          });
        }
      }
    }
  }
})
