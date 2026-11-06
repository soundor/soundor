import { appendFileSync, mkdirSync } from 'node:fs';

import { launch } from '@soundor/driver/vst3';
import { launchHost, launchPlugin } from '@soundor/vitest-e2e';
import { launchHost as startHost } from '@soundor/vst3-host';
import { expect, test, vi } from 'vitest';

vi.mock('@soundor/driver/vst3', () => ({ launch: vi.fn() }));
vi.mock('@soundor/vst3-host', () => ({ launchHost: vi.fn() }));

const close = async () => {
  mkdirSync('.soundor', { recursive: true });
  appendFileSync('.soundor/closed.txt', 'closed\n');
};

test('saves what the plugin showed', async () => {
  vi.mocked(launch).mockImplementation(async (options) => {
    options.onLog?.('plugin said hello');
    return {
      close,
      screenshot: async () => ({ data: new Uint8Array([1, 2, 3]) }),
      driver: { getTree: async () => ({ nodes: [{ type: 'View' }] }) },
    } as never;
  });
  await launchPlugin();
  expect(1).toBe(2);
});

test('survives a plugin that cannot answer', async () => {
  const gone = async () => {
    throw new Error('gone');
  };
  vi.mocked(launch).mockResolvedValue({
    close,
    screenshot: gone,
    driver: { getTree: gone },
  } as never);
  await launchPlugin();
  expect(1).toBe(2);
});

test('saves the log of a host', async () => {
  vi.mocked(startHost).mockImplementation(async (options) => {
    options.onLog?.('host line');
    return { close } as never;
  });
  await launchHost();
  expect(1).toBe(2);
});

test('a test that passes saves nothing', async () => {
  vi.mocked(launch).mockResolvedValue({ close } as never);
  await launchPlugin();
});

test('audio that differs is kept to listen to', () => {
  expect(Float32Array.of(0.5, 0.5)).toBeCloseToAudio(Float32Array.of(0, 0));
});
