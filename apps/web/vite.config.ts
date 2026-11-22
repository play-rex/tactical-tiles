import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 2767);

export default defineConfig({
  server: {
    port: 5373,
    host: '0.0.0.0',
    // The game client connects to the server's port directly in dev (see src/net/useOnline.ts)
    proxy: { '/api': `http://localhost:${SERVER_PORT}` },
  },
  plugins: [react({ include: /\.[jt]sx?$/ })],
  resolve: {
    // One copy of Pixi and React for every package that imports them.
    dedupe: ['pixi.js', 'react', 'react-dom', '@pixi/react'],
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  optimizeDeps: {
    include: ['pixi.js', '@pixi/react'],
  },
});
