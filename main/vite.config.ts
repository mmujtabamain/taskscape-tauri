import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Shared frontend library, compiled from source and imported as
// `@taskscape/common-ui/*`.
const uiSrc = fileURLToPath(new URL("../common-ui/src", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Two HTML entries: the main task-manager window (`index.html`) and the shared
  // auxiliary panels (`panels.html` — modal / overlay / settings). Splitting them
  // keeps a panel's bundle free of the whole main app.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        panels: fileURLToPath(new URL("./panels.html", import.meta.url)),
      },
    },
  },

  resolve: {
    // Shared widgets in ../common-ui/src, resolved from source
    // via `@taskscape/common-ui/*`.
    alias: { "@taskscape/common-ui": uiSrc },
    // The shared sources sit outside this app's node_modules; force their
    // bare deps to resolve here (also keeps React a single instance).
    dedupe: ["react", "react-dom", "@tauri-apps/api", "tailwind-merge"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Serve the shared common-ui sources that live above the app root.
    fs: { allow: [repoRoot] },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
