import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export const rendererPublicDirectory = resolve(projectRoot, 'resources/icons');

export default defineConfig((environment) => {
  const forgeEnvironment = environment as typeof environment & {
    forgeConfigSelf?: { name?: string };
  };
  const rendererName = forgeEnvironment.forgeConfigSelf?.name ?? 'main_window';
  return {
    root: resolve(projectRoot, 'src/renderer'),
    publicDir: rendererPublicDirectory,
    build: {
      outDir: resolve(projectRoot, '.vite', 'renderer', rendererName),
      sourcemap: true,
    },
  };
});
