import { defineConfig } from 'vitest/config';

// Tauri expects a fixed dev port and a static build in dist/.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // Two pages: the main window, and the notification windows (notify.html#toast / #marquee).
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { main: 'index.html', notify: 'notify.html', panel: 'panel.html' } } },
  test: { include: ['tests/**/*.test.ts'] },
});
