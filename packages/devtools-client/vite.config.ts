import { thirdPartyNotices } from '@soundor/tsdown-config';
import { defineConfig } from 'vite';

import { developmentBackend } from './dev/backend.ts';

export default defineConfig({
  base: '/',
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {} },
  plugins: [
    // React ships inlined: its notices ship in dist/licenses/, which the
    // dashboard links to.
    { ...thirdPartyNotices({ title: 'Soundor DevTools' }), apply: 'build' },
    developmentBackend({
      endpoint: process.env.SOUNDOR_DEVTOOLS_BACKEND,
      scenario: process.env.SOUNDOR_DEVTOOLS_SCENARIO,
    }),
  ],
});
