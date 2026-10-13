import { soundor } from '@soundor/vitest';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [soundor({ config: false })],
  test: { environment: 'soundor', include: ['src/**/*.test.{ts,tsx}'] },
});
