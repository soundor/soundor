import { expect, it } from 'vitest';

import { parseBackendEndpoint } from '../dev/backend';

it('accepts credential-free exact loopback backend origins', () => {
  expect(parseBackendEndpoint('http://127.0.0.1:9229')).toBe(
    'http://127.0.0.1:9229',
  );
  expect(parseBackendEndpoint('http://localhost:9229/')).toBe(
    'http://localhost:9229',
  );
});
it.each([
  'https://127.0.0.1:9229',
  'http://remote.test:9229',
  'http://127.0.0.1.evil.test:9229',
  'http://0.0.0.0:9229',
  'http://secret@localhost:9229',
  'http://localhost:9229/#connect=secret',
  'http://localhost:9229/?key=secret',
  'http://localhost:9229/browser',
  'invalid',
])(
  'rejects an unsafe backend endpoint without revealing credentials (%#)',
  (endpoint) => {
    expect(() => parseBackendEndpoint(endpoint)).toThrow(
      'HTTP loopback origin',
    );
    let message = '';
    try {
      parseBackendEndpoint(endpoint);
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain('secret');
  },
);
