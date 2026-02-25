import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  build: {
    outDir: 'dist-widget',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        widget: path.resolve(__dirname, 'widget.html'),
      },
      output: {
        entryFileNames: 'assets/widget/[name]-[hash].js',
        chunkFileNames: 'assets/widget/[name]-[hash].js',
        assetFileNames: 'assets/widget/[name]-[hash][extname]',
      },
    },
  },
});
