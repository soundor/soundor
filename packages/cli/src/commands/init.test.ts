import type { CommandMeta } from 'citty';
import { describe, expect, it, vi } from 'vitest';

import { initCommand } from './init';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn<() => void>(),
  outro: vi.fn<() => void>(),
  text: vi.fn<() => Promise<string>>().mockResolvedValue('my-plugin'),
  isCancel: vi.fn<(value: unknown) => boolean>().mockReturnValue(false),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('init command', () => {
  it('is defined', () => {
    expect(initCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((initCommand.meta as CommandMeta)?.name).toBe('init');
  });
});
