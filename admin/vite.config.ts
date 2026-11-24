import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".");
  const server = {
    port: 5173, strictPort: true,
    proxy: { "/api": env.VITE_APP_API_TARGET_URL || "http://127.0.0.1:8793" },
  };
  return { plugins: [react()], server, preview: server, resolve: { alias: { "@": resolve(__dirname, "src") }, dedupe: ["react", "react-dom"] } };
});
