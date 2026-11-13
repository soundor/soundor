import { describe, expect, it } from 'vitest';

import { browserEnvironment } from './environment';

describe('browser environment', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0, 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0, 'macos'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, 'ios'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5, 'ios'],
    ['Mozilla/5.0 (Linux; Android 14)', 5, 'android'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 0, 'linux'],
    ['', 0, 'unknown'],
  ])(
    'detects %s without guessing native architecture',
    (userAgent, maxTouchPoints, platform) => {
      const result = browserEnvironment('1.2.3', { userAgent, maxTouchPoints });
      expect(result).toEqual({
        runtime: 'web',
        runtimeVersion: '1.2.3',
        platform,
        arch: 'unknown',
        format: 'web',
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );
});
