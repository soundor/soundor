import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConsoleLogger } from './logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createConsoleLogger', () => {
  it('forwards each level to the matching console method', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createConsoleLogger();

    logger.info('hello', 1);
    logger.error('bad');

    expect(info).toHaveBeenCalledWith('hello', 1);
    expect(error).toHaveBeenCalledWith('bad');
  });

  it('prefixes the scope and nests child scopes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createConsoleLogger('juce').warn('a');
    createConsoleLogger('juce').child('build').warn('b');

    expect(warn).toHaveBeenNthCalledWith(1, '[juce] a');
    expect(warn).toHaveBeenNthCalledWith(2, '[juce:build] b');
  });
});
