import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { libraryPlugin } from './server/library.mjs';
import { dictionaryPlugin } from './server/dictionary.mjs';

export default defineConfig({
  plugins: [vue(), { ...dictionaryPlugin(), enforce: 'pre' }, libraryPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/library.local.json'] },
  },
});
