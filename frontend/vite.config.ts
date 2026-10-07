import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const backend = process.env.BACKEND_URL ?? 'http://localhost:8765'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': backend },
  },
  test: {
    environment: 'node',
  },
})
