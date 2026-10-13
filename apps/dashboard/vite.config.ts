import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("apps/dashboard"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4310",
      "/auth": "http://127.0.0.1:4310",
      "/artifacts": "http://127.0.0.1:4310",
    },
  },
  build: { outDir: resolve("dist/dashboard"), emptyOutDir: true },
});
