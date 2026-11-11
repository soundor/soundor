import { soundor as integration } from '@soundor/vitest';
import { soundor as e2e } from '@soundor/vitest-e2e';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [integration()],
        test: {
          name: 'integration',
          environment: 'soundor',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        plugins: [e2e({ vst3: '.soundor/debug/juce/VST3/Orbit.vst3' })],
        test: {
          name: 'e2e',
          include: ['e2e/**/*.test.ts'],
          // Native UI reads cross the host process and can wait for GPU startup.
          // Match the five-second budget of the E2E locator assertions.
          expect: { poll: { timeout: 5000 } },
        },
      },
    ],
  },
});
