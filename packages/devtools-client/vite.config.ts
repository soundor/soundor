import { defineConfig } from 'vite';

import { developmentBackend } from './dev/backend.ts';

export default defineConfig({
  base: '/',
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {} },
  plugins: [
    developmentBackend({
      endpoint: process.env.SOUNDOR_DEVTOOLS_BACKEND,
      scenario: process.env.SOUNDOR_DEVTOOLS_SCENARIO,
    }),
  ],
});
