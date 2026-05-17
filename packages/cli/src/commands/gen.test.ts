import type { CommandMeta } from 'citty';
import { describe, expect, it, vi } from 'vitest';

import { genCommand } from './gen';

vi.mock('@clack/prompts', () => ({
  outro: vi.fn<() => void>(),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('gen command', () => {
  it('is defined', () => {
    expect(genCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((genCommand.meta as CommandMeta)?.name).toBe('gen');
  });
});
