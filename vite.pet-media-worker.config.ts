import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, 'src/renderer/pet-media-worker'),
  build: {
    outDir: resolve(projectRoot, '.vite', 'renderer', 'pet_media_worker'),
    sourcemap: true,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
  },
});
