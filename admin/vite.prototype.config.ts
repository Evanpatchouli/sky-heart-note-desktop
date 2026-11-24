import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Only the review build routes the existing admin pages to local fixture data.
export default defineConfig({
  root: resolve(__dirname, "prototype"),
  base: "./",
  publicDir: false,
  plugins: [react()],
  define: { __CLUB_ADMIN_PREVIEW__: "true" },
  resolve: {
    alias: [
      { find: /^@\/api\/(login-log|role|user-manage)\.api$/, replacement: resolve(__dirname, "prototype/system-api.ts") },
      { find: "@", replacement: resolve(__dirname, "src") },
    ],
    dedupe: ["react", "react-dom"],
  },
  server: { host: "127.0.0.1", port: 5191, strictPort: true },
  build: { outDir: resolve(__dirname, "../docs/design/admin/dist"), emptyOutDir: true },
});
