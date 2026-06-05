import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 9001,
    proxy: {
      '/api/': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
      '/runtime/': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
    },
  },
})
