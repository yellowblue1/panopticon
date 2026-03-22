import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Copy ghostty-web WASM binary to the public directory so it can be loaded
 * at runtime via `/ghostty-vt.wasm`. Runs once at server start / build start.
 */
function ghosttyWasmPlugin(): Plugin {
  const src = resolve(__dirname, "node_modules/ghostty-web/ghostty-vt.wasm");
  const dest = resolve(__dirname, "public/ghostty-vt.wasm");
  function copy() {
    if (existsSync(src) && !existsSync(dest)) {
      copyFileSync(src, dest);
    }
  }
  return {
    name: "ghostty-wasm-copy",
    buildStart: copy,
    configureServer: () => copy(),
  };
}

const devPort = process.env.DEV_PORT ? Number.parseInt(process.env.DEV_PORT, 10) : 3847;
const backendPort = devPort + 1;

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: resolve(__dirname, "src/client/routes"),
      generatedRouteTree: resolve(__dirname, "src/client/routeTree.gen.ts"),
    }),
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
    ghosttyWasmPlugin(),
  ],
  root: "src",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src/client"),
      "@shared": resolve(__dirname, "../src/shared"),
    },
  },
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    allowedHosts: ["localhost", "127.0.0.1", ".ts.net"],
    port: devPort,
    proxy: {
      "/api/": {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
      "/favicon.ico": {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
