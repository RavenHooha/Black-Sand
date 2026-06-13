import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite + Tauri: a fixed dev port the desktop shell can point at, and quieter
// output so Tauri's own logs aren't cleared.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
})
