import type { ArgsDef, CommandMeta } from 'citty';
import { describe, expect, it, vi } from 'vitest';

import { devCommand } from './dev';

vi.mock('@clack/prompts', () => ({
  outro: vi.fn<() => void>(),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('dev command', () => {
  it('is defined', () => {
    expect(devCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((devCommand.meta as CommandMeta)?.name).toBe('dev');
  });

  it('declares runtime as a required positional arg', () => {
    const args = devCommand.args as ArgsDef;
    expect(args['runtime']).toMatchObject({
      type: 'positional',
      required: true,
    });
  });
});
