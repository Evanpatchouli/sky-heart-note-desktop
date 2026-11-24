import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".");
  const server = {
    port: 5176,
    strictPort: true,
    proxy: { "/api": env.VITE_APP_API_TARGET_URL || "http://127.0.0.1:8793" },
  };
  return { plugins: [react()], resolve: { dedupe: ["react", "react-dom"] }, server, preview: server };
});
