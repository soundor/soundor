import { soundor } from '@soundor/vitest-e2e';
import { defineConfig } from 'vitest/config';

// `pnpm test:e2e` builds the Debug VST3 first; vitest uses it as it is.
export default defineConfig({
  plugins: [soundor({ vst3: '.soundor/debug/vst3/Soundor E2E.vst3' })],
  test: { include: ['e2e/vst3/**/*.test.ts'] },
});
