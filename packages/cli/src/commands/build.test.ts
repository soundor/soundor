import type { ArgsDef, CommandMeta } from 'citty';
import { describe, expect, it, vi } from 'vitest';

import { buildCommand } from './build';

vi.mock('@clack/prompts', () => ({
  outro: vi.fn<() => void>(),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('build command', () => {
  it('is defined', () => {
    expect(buildCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((buildCommand.meta as CommandMeta)?.name).toBe('build');
  });

  it('declares runtime as an optional positional arg', () => {
    const args = buildCommand.args as ArgsDef;
    expect(args['runtime']).toMatchObject({
      type: 'positional',
      required: false,
    });
  });
});
