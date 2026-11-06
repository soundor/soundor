import { launch } from '@soundor/driver/vst3';
import { launchHost as startHost } from '@soundor/vst3-host';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { launchHost, launchPlugin } from './launch';

vi.mock('@soundor/driver/vst3', () => ({ launch: vi.fn() }));
vi.mock('@soundor/vst3-host', () => ({ launchHost: vi.fn() }));

/** How often each was closed, across tests: cleanup happens after each has
    ended, and Vitest clears a mock's calls between tests. */
const closes: Record<string, number> = {};

function starts(name: string, mock: typeof launch | typeof startHost) {
  closes[name] = 0;
  vi.mocked(mock as typeof launch).mockResolvedValue({
    close: async () => void ++closes[name]!,
  } as never);
}

beforeEach(() => {
  vi.mocked(launch).mockReset();
  vi.mocked(startHost).mockReset();
});

describe('launchPlugin', () => {
  test('loads the configured plugin, from the project root', async () => {
    starts('configured', launch);
    await launchPlugin();
    expect(launch).toHaveBeenCalledWith({
      plugin: '/project/My Plugin.vst3',
      cwd: '/project',
      onLog: expect.any(Function),
    });
  });

  test('takes another plugin and options', async () => {
    starts('options', launch);
    await launchPlugin({ plugin: 'Other.vst3', sampleRate: 44_100 });
    expect(launch).toHaveBeenCalledWith({
      plugin: '/project/Other.vst3',
      cwd: '/project',
      sampleRate: 44_100,
      onLog: expect.any(Function),
    });
  });

  test('stays open during the test', async () => {
    starts('during', launch);
    await launchPlugin();
    expect(closes['during']).toBe(0);
  });

  test('closes when the test passed', () => {
    expect(closes['during']).toBe(1);
  });

  test.fails('runs a test that fails', async () => {
    starts('failed', launch);
    await launchPlugin();
    expect(1).toBe(2);
  });

  test('closes when the test failed', () => {
    expect(closes['failed']).toBe(1);
  });

  test('passes on a launch that fails, with nothing to close', async () => {
    vi.mocked(launch).mockRejectedValue(new Error('no editor'));
    await expect(launchPlugin()).rejects.toThrow('no editor');
  });

  test('closes each plugin of a test', async () => {
    starts('first', launch);
    await launchPlugin();
    starts('second', launch);
    await launchPlugin();
  });

  test('so both closed', () => {
    expect(closes['first']).toBe(1);
    expect(closes['second']).toBe(1);
  });

  test('closes even if the test stopped waiting for the launch', async () => {
    closes['late'] = 0;
    const close = async () => void ++closes['late']!;
    let finish!: (plugin: never) => void;
    vi.mocked(launch).mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    void launchPlugin();
    setTimeout(() => finish({ close } as never), 10);
  });

  test('so the late one closed', () => {
    expect(closes['late']).toBe(1);
  });
});

describe('launchHost', () => {
  test('loads the configured plugin without an editor', async () => {
    starts('host', startHost);
    await launchHost({ blockSize: 256 });
    expect(startHost).toHaveBeenCalledWith({
      plugin: '/project/My Plugin.vst3',
      cwd: '/project',
      blockSize: 256,
      onLog: expect.any(Function),
    });
    expect(closes['host']).toBe(0);
  });

  test('closes when the test ended', () => {
    expect(closes['host']).toBe(1);
  });
});
