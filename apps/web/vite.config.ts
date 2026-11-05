import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import mathNumberInputBabelPlugin from './mathNumberInputBabelPlugin'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: __dirname,
  plugins: [react({ babel: { plugins: [mathNumberInputBabelPlugin] } })],
  resolve: {
    alias: {
      '@web': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5000,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/__mockup': {
        target: 'http://localhost:23636',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
