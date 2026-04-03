import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const devPort = process.env.DEV_PORT ? Number.parseInt(process.env.DEV_PORT, 10) : 3847;
const backendPort = devPort + 1;
const host = process.env.HOST ?? "127.0.0.1";

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
    host,
    allowedHosts: ["localhost", "127.0.0.1", ".ts.net"],
    port: devPort,
    proxy: {
      "/api/": {
        target: `http://${host}:${backendPort}`,
        changeOrigin: true,
      },
      "/favicon.ico": {
        target: `http://${host}:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
