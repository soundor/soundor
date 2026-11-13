import { describe, expect, it } from 'vitest';

import {
  environmentIssues,
  renderEnvironmentDts,
  renderEnvironmentModule,
  resolveEnvironment,
} from './env';

describe('explicit build environment', () => {
  it('provides modes without inheriting process environment', () => {
    expect(resolveEnvironment()).toEqual({
      DEV: true,
      PROD: false,
      MODE: 'development',
    });
    expect(
      resolveEnvironment({ COUNT: 3, ENABLED: false }, 'production'),
    ).toEqual({
      DEV: false,
      PROD: true,
      MODE: 'production',
      COUNT: 3,
      ENABLED: false,
    });
    expect(Object.isFrozen(resolveEnvironment())).toBe(true);
  });
  it('serializes strings and special property names as inert own data', async () => {
    const values = JSON.parse(
      '{"__proto__":"own value","TEXT":"quotes \\" and newline\\n"}',
    );
    const source = renderEnvironmentModule(values, 'production');
    const { env } = await import(
      `data:text/javascript,${encodeURIComponent(source)}`
    );
    expect(env.TEXT).toBe(values.TEXT);
    expect(Object.hasOwn(env, '__proto__')).toBe(true);
    expect(env.__proto__).toBe('own value');
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(Object.isFrozen(env)).toBe(true);
  });
  it('rejects reserved names and nonpublic value types', () => {
    for (const values of [
      { DEV: 'no' },
      { MODE: 'custom' },
      { 'bad-key': true },
      { VALUE: Infinity },
      { VALUE: {} },
      { VALUE: undefined },
    ]) {
      expect(environmentIssues(values as never)).not.toEqual([]);
      expect(() => resolveEnvironment(values as never)).toThrow(
        'Invalid build environment',
      );
    }
  });
  it('emits deterministic primitive declarations without configuration values', () => {
    const source = renderEnvironmentDts({
      URL: 'https://example.test',
      COUNT: 3,
      FLAG: true,
    });
    expect(source).toContain('readonly "URL": string');
    expect(source).toContain('readonly "COUNT": number');
    expect(source).toContain('readonly "FLAG": boolean');
    expect(source).not.toContain('example.test');
    expect(renderEnvironmentModule({ B: 2, A: 1 })).toBe(
      renderEnvironmentModule({ A: 1, B: 2 }),
    );
  });
});
