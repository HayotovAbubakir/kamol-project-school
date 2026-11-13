import { resolve } from 'node:path'
import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.DEV_API_TARGET || 'https://kamol-project-school.hayotovabubakir.workers.dev',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        miniapp: resolve(import.meta.dirname, 'miniapp.html'),
      },
    },
  },
  test: {
    // Workers resolve grammY's web build (global fetch); tests must match it.
    alias: [{ find: /^grammy$/, replacement: 'grammy/web' }],
    testTimeout: 20000,
  },
})
