import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import process from 'node:process'

// https://vite.dev/config/
export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || 'C:/tmp/edit-pdf-vite-cache-active',
  plugins: [
    tailwindcss(),
    react(),
  ],
})
