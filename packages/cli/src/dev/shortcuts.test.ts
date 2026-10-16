import { PassThrough } from 'node:stream';

import type { DevShortcut } from '@soundor/config';
import { expect, it, vi } from 'vitest';

import { bindShortcuts } from './shortcuts';

it('runs a shortcut on its key and enter, and lists them on h', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const action = vi.fn<() => void>();
  const failing: DevShortcut = {
    key: 'x',
    description: 'fail',
    action: () => {
      throw new Error('nope');
    },
  };
  const printed: string[] = [];
  const errors: unknown[] = [];
  const unbind = bindShortcuts({
    shortcuts: () => [
      { key: 'o', description: 'open DevTools', action },
      failing,
    ],
    print: (text) => printed.push(text),
    onError: (error) => errors.push(error),
    input,
    output: output as never,
  });

  input.write(' o \nunknown\n');
  await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
  input.write('x\n');
  await vi.waitFor(() => expect(errors).toEqual([new Error('nope')]));
  input.write('h\n');
  await vi.waitFor(() => expect(printed).toHaveLength(1));
  unbind();

  expect(action).toHaveBeenCalledOnce();
  expect(printed[0]).toBe(
    [
      '',
      '  Shortcuts',
      '  press o + enter to open DevTools',
      '  press x + enter to fail',
      '  press h + enter to show this help',
      '',
    ].join('\n'),
  );
});
