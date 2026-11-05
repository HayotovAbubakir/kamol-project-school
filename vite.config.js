import { env } from 'node:process'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: env.GITHUB_ACTIONS ? '/kamol-project-school/' : '/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        miniapp: resolve(import.meta.dirname, 'miniapp.html'),
      },
    },
  },
})
