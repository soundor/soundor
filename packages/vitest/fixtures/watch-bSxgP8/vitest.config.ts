import { soundor } from '@soundor/vitest';
export default {
  plugins: [soundor()],
  test: { environment: 'soundor', include: ['watched.test.ts'] },
};
