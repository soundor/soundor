import { soundor } from '@soundor/vitest-e2e';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [soundor({ vst3: 'Fixture.vst3' })],
  test: {
    include: ['failing.spec.ts'],
    // So that the spec can stand in for the host and the Driver.
    server: { deps: { inline: ['@soundor/vitest-e2e'] } },
  },
});
