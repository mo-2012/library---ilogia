import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// GitHub Pages + custom domain (library.ilogia-eg.com) → served from the root, so base is '/'.
export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), admin: resolve(import.meta.dirname, 'admin/index.html') },
    },
  },
});
