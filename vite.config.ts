import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and must not clear the terminal.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    minify: process.env.CYPALS_NO_MINIFY ? false : "esbuild",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
