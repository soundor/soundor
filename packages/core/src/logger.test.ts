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

    createConsoleLogger('vst3').warn('a');
    createConsoleLogger('vst3').child('build').warn('b');

    expect(warn).toHaveBeenNthCalledWith(1, '[vst3] a');
    expect(warn).toHaveBeenNthCalledWith(2, '[vst3:build] b');
  });

  it('pipes process output without scope prefixes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createConsoleLogger('vst3');

    logger.pipe('-- Configuring done', 'stdout');
    logger.pipe('CMake Warning', 'stderr');

    expect(log).toHaveBeenCalledWith('-- Configuring done');
    expect(error).toHaveBeenCalledWith('CMake Warning');
  });
});
