import { soundor as integration } from '@soundor/vitest';
import { soundor as e2e } from '@soundor/vitest-e2e';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [integration({ config: false })],
        test: {
          name: 'integration',
          environment: 'soundor',
          include: ['integration.spec.ts'],
        },
      },
      {
        plugins: [e2e({ vst3: 'Missing.vst3' })],
        test: { name: 'e2e', include: ['e2e.spec.ts'] },
      },
    ],
  },
});
