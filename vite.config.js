import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    // Выходная папка (относительно корня проекта)
    outDir: 'static/js/dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'static/js/src/main.js'),
      },
      output: {
        // Имя выходного файла
        entryFileNames: 'main.js',
      },
    },
    // Минификация включена по умолчанию
    minify: true,
    // Генерировать source maps для отладки (опционально)
    sourcemap: true,
  },
});