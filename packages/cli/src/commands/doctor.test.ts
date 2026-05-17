import type { CommandMeta } from 'citty';
import { describe, expect, it, vi } from 'vitest';

import { doctorCommand } from './doctor';

vi.mock('@clack/prompts', () => ({
  outro: vi.fn<() => void>(),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('doctor command', () => {
  it('is defined', () => {
    expect(doctorCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((doctorCommand.meta as CommandMeta)?.name).toBe('doctor');
  });
});
