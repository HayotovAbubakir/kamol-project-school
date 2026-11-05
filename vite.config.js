import { env } from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: env.GITHUB_ACTIONS ? '/kamol-project-school/' : '/',
  plugins: [react(), tailwindcss()],
})
