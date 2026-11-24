import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const proxy = { '/api': env.VITE_APP_API_TARGET_URL || 'http://127.0.0.1:8793' };
  return {
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '#': fileURLToPath(new URL('./src', import.meta.url)),
        '#assets': fileURLToPath(new URL('./src/assets', import.meta.url)),
      },
    },
    server: { port: 5174, strictPort: true, proxy },
    preview: { port: 5174, strictPort: true, proxy },
  };
});
