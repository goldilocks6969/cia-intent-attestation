import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@cia/shared/core": path.resolve(__dirname, "../packages/shared/src/core.ts"),
      "@cia/shared": path.resolve(__dirname, "../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: true, // origin must stay stable: it is the WebAuthn expectedOrigin
    proxy: { "/api": { target: process.env.VITE_BACKEND_URL ?? "http://localhost:4000", changeOrigin: true } },
  },
});
