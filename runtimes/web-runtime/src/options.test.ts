import { describe, expect, it } from 'vitest';

import { resolveWebOptions } from './options';

describe('resolveWebOptions', () => {
  it('defaults the dev server port', () => {
    expect(resolveWebOptions({})).toEqual({ port: 5173 });
    expect(resolveWebOptions({ port: 0 })).toEqual({ port: 0 });
  });

  it.each([-1, 65536, 1.5, Number.NaN])('rejects port %s', (port) => {
    expect(() => resolveWebOptions({ port })).toThrow(
      expect.objectContaining({
        code: 'CONFIG',
        issues: [expect.objectContaining({ path: 'runtimes.web.port' })],
      }),
    );
  });
});
