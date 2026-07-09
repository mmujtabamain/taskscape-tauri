import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Shared frontend library, compiled from source and imported as `@ui/*`.
const uiSrc = fileURLToPath(new URL("../common-ui/src", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    // Shared widgets in ../common-ui/src, resolved from source via `@ui/*`.
    alias: { "@ui": uiSrc },
    // The shared sources sit outside this app's node_modules; force their
    // bare deps to resolve here (also keeps React a single instance).
    dedupe: ["react", "react-dom", "@tauri-apps/api"],
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
    // Serve the shared ../common-ui sources that live above the app root.
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
