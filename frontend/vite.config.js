import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  server: {
    proxy: {
      "/playlist": "http://localhost:8000",
      "/progress": "http://localhost:8000",
      "/video-progress": "http://localhost:8000",
      "/videos": "http://localhost:8000"
    }
  }
})
