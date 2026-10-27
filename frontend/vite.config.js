import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dashboard and the API share one origin: in development Vite forwards /api to
// the FastAPI server, so session cookies stay SameSite=Strict and no CORS is needed.
// In production, either serve dist/ from FastAPI (AIRNEST_STATIC_DIR=../frontend/dist)
// or put both behind the same reverse proxy (nginx/Caddy) with HTTPS.
const API = process.env.AFYANEST_API || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: API, changeOrigin: false }, '/health': API },
  },
  build: { sourcemap: false },
})
