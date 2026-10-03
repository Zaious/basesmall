import { defineConfig } from 'vitest/config';

// Tauri expects a fixed dev port and a static build in dist/.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: { include: ['tests/**/*.test.ts'] },
});
