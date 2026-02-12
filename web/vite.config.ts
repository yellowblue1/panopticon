import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: resolve(__dirname, "src/client/routes"),
      generatedRouteTree: resolve(__dirname, "src/client/routeTree.gen.ts"),
    }),
    react(),
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
    host: true,
    allowedHosts: ["localhost", "127.0.0.1", ".ts.net"],
    port: 3847,
    proxy: {
      "/api/": {
        target: "http://localhost:3848",
        changeOrigin: true,
      },
      "/favicon.ico": {
        target: "http://localhost:3848",
        changeOrigin: true,
      },
    },
  },
});
