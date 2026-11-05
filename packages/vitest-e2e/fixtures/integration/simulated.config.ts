import { soundor } from '@soundor/vitest-e2e';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [soundor({ vst3: 'Fixture.vst3' })],
  test: { environment: 'soundor', include: ['e2e.spec.ts'] },
});
