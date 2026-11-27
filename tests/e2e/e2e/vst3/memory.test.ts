// What an editor costs, and that closing it gives it back: an editor opened
// and closed again and again (as a user does, all session long) leaves no
// memory and no threads behind. Linux only: it reads the host's /proc.
import { readdir, readFile } from 'node:fs/promises';

import { launchPlugin, type Vst3Plugin } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

/**
 * The host's anonymous memory (its heaps, arenas and stacks, in MB: what a
 * leak grows, and unlike PSS or private memory not moved by the other
 * processes that share the host's libraries, such as the suite's other
 * hosts), its PSS, and its thread count.
 */
async function footprint(pid: number) {
  const rollup = await readFile(`/proc/${pid}/smaps_rollup`, 'utf8');
  const megabytes = (field: string) =>
    Number(new RegExp(`^${field}:\\s+(\\d+) kB`, 'm').exec(rollup)?.[1]) / 1024;
  return {
    anonymous: megabytes('Anonymous'),
    pss: megabytes('Pss'),
    threads: (await readdir(`/proc/${pid}/task`)).length,
  };
}

/** The host's threads, by id and name: a thread started again has a new id. */
async function threads(pid: number) {
  const ids = await readdir(`/proc/${pid}/task`);
  const named = await Promise.all(
    ids.map(async (id) => {
      const name = await readFile(`/proc/${pid}/task/${id}/comm`, 'utf8').catch(
        () => '',
      );
      return [id, name.trim()] as const;
    }),
  );
  return new Map(named);
}

/**
 * What the engine keeps between editors (#404): the GPU device's threads
 * (ANGLE's; the driver's are named by each driver) and the engine's own.
 * Hermes's start with each editor's runtime, and Mesa's swapchain threads
 * with each window.
 */
const kept = /^(ANGLE-|soundor-a11y$|soundor-files$)/;

async function reopen(plugin: Vst3Plugin) {
  await plugin.host.closeEditor();
  await plugin.openEditor();
  // Drawn and running: its UI answers.
  await expect(plugin.getByDebugId('note')).toHaveText('Note: none');
}

// Each open makes a runtime, a GPU context, fonts and canvases (one of them
// WebGL's), and starts the runtime's threads; each close must end them.
// Before the fixes for #376 and #377, PSS grew by about 1 MB (fonts, glyphs)
// plus up to 14 MB (a dozen ANGLE workers' glibc arenas) per open. Before
// #404's, every open started the GPU device's threads (ANGLE's, the
// driver's) and the engine's again, and glibc kept what each opening's
// threads had freed in arenas the next ones did not use.
test.skipIf(process.platform !== 'linux')(
  'an editor opened and closed again and again leaves no memory or threads behind',
  async () => {
    const plugin = await launchPlugin();
    const pid = plugin.host.pid;
    expect(pid).toBeDefined();
    await expect(plugin.getByDebugId('note')).toHaveText('Note: none');
    // What the first opens make once (caches, the driver's pools, the
    // allocator's arenas settling): a CI runner's took more than 3 opens,
    // and what settled during the measured ones counted as growth.
    for (let round = 0; round < 10; round += 1) await reopen(plugin);

    await plugin.host.closeEditor();
    const before = await footprint(pid!);
    const closed = await threads(pid!);
    await plugin.openEditor();
    await expect(plugin.getByDebugId('note')).toHaveText('Note: none');
    const open = await footprint(pid!);
    // Warm, an open starts none of what the engine keeps: the same threads.
    const restarted = [...(await threads(pid!))]
      .filter(([id, name]) => kept.test(name) && !closed.has(id))
      .map(([, name]) => name);
    expect(restarted, 'threads started again by a warm open').toEqual([]);
    const rounds = 30;
    for (let round = 0; round < rounds; round += 1) await reopen(plugin);
    await plugin.host.closeEditor();
    const after = await footprint(pid!);

    const megabytes = (value: number) => `${value.toFixed(1)} MB`;
    console.info(
      `editor closed: anonymous ${megabytes(before.anonymous)} (PSS ${megabytes(before.pss)}), ` +
        `${before.threads} threads; open: anonymous ${megabytes(open.anonymous)}, ` +
        `${open.threads} threads; closed after ${rounds} more opens: ` +
        `anonymous ${megabytes(after.anonymous)} (PSS ${megabytes(after.pss)}), ` +
        `${after.threads} threads`,
    );
    expect(after.threads).toBe(before.threads);
    // Allocator and driver noise, not a leak per open. Measured on Linux
    // (Vulkan, 4 CPUs): 10 opens grew it by 7.5 MB before the fixes for #376
    // and #377; 15 opens grew it by 2 to 3 MB after them.
    expect(
      after.anonymous - before.anonymous,
      `anonymous memory grew from ${megabytes(before.anonymous)} to ${megabytes(after.anonymous)}`,
    ).toBeLessThan(5);
  },
  180_000,
);
