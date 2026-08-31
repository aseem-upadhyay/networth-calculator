import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Project-page deploy: the app is served from
// https://aseem-upadhyay.github.io/networth-calculator/
// so every asset URL must carry that prefix. Getting this wrong ships a white
// page with 404s on every asset — see PLAN.md §2.
//
// Overridable via BASE_PATH so a fork, a custom domain, or a local
// `vite preview` at the root can build without editing this file.
const base = process.env.BASE_PATH ?? '/networth-calculator/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The Firebase SDK is ~200 kB gzipped and is not meaningfully splittable
    // for an app that needs auth and firestore on first paint. Raising the
    // warning rather than pretending the default 500 kB is achievable.
    chunkSizeWarningLimit: 800,
  },
})
