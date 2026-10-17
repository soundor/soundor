import { soundor } from '@soundor/vitest';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [soundor()],
  test: { environment: 'soundor', include: ['src/**/*.test.{ts,tsx}'] },
});
