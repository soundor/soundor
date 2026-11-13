import { watch as watchFiles } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { watchUi } from './bundle';

const { notifications } = vi.hoisted(() => ({
  notifications: { emit: (_event: string, _file: string | null): void => {} },
}));

vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  watch: vi.fn((_root, _options, listener) => {
    notifications.emit = listener;
    return { close: vi.fn() };
  }),
}));

vi.mock('tsdown', () => ({
  build: vi.fn(async (options: { cwd: string; outDir: string }) => {
    await mkdir(options.outDir, { recursive: true });
    await writeFile(
      join(options.outDir, 'bundle.mjs'),
      await readFile(join(options.cwd, 'src/main.ts'), 'utf8'),
    );
    // Every build produces the Windows notifications that sustained the loop.
    notifications.emit('rename', null);
    notifications.emit('change', '.soundor/dev/ui.log');
  }),
}));

afterEach(() => vi.useRealTimers());

it('stays idle after its own writes and rebuilds after a named source change', async () => {
  vi.useFakeTimers();
  const root = await mkdtemp(join(tmpdir(), 'soundor-watch-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/main.ts'), 'export const version = 1;');
  const onBuild = vi.fn();
  const onError = vi.fn();
  const watcher = watchUi({
    root,
    mode: 'development',
    outDir: join(root, '.soundor/ui'),
    debounce: 10,
    onBuild,
    onError,
  })!;
  try {
    await watcher.ready;
    await vi.advanceTimersByTimeAsync(100);
    expect(onBuild).toHaveBeenCalledTimes(1);

    await writeFile(join(root, 'src/main.ts'), 'export const version = 2;');
    notifications.emit('change', 'src/main.ts');
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => expect(onBuild).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(100);
    expect(onBuild).toHaveBeenCalledTimes(2);
    expect(onBuild.mock.calls[1]![0].buildId).not.toBe(
      onBuild.mock.calls[0]![0].buildId,
    );
    expect(onError).not.toHaveBeenCalled();
  } finally {
    watcher.close();
    expect(
      vi.mocked(watchFiles).mock.results[0]!.value.close,
    ).toHaveBeenCalled();
    await rm(root, { recursive: true, force: true });
  }
});
