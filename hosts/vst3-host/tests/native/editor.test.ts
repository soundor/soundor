// The editor in UI mode: attach, run loop, scale, resizing from both sides,
// closing and reopening. Needs a display (Xvfb on Linux CI).
import { afterEach, describe, expect, test } from 'vitest';

import type { EditorInfo } from '../../src/index.ts';
import {
  EDITOR_SCALE,
  EDITOR_SIZE,
  EDITOR_TICKS,
  closeAll,
  constant,
  hasDisplay,
  launch,
} from './fixtures.ts';

afterEach(closeAll);

test('a headless host has no editor', async () => {
  const host = await launch('Fixture Gain');
  expect(
    await host.openEditor().catch((e: unknown) => (e as { code: string }).code),
  ).toBe('headless');
  expect(await host.getEditor()).toEqual({ open: false });
});

describe.runIf(hasDisplay || process.env.SOUNDOR_VST3_HOST_REQUIRE_UI === '1')(
  'UI mode',
  () => {
    test('opens the editor, runs its timers and keeps processing', async () => {
      const host = await launch('Fixture Gain', { editor: true, scale: 2 });
      expect(host.identity.mode).toBe('ui');
      const editor = await host.getEditor();
      expect(editor).toMatchObject({
        open: true,
        width: 400,
        height: 300,
        resizable: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      // The editor's timer runs on the host's loop (IRunLoop on Linux).
      expect(
        (await host.getParameter(EDITOR_TICKS)).normalized,
      ).toBeGreaterThan(0);
      // Windows and Linux views get the content scale; macOS views use points.
      expect((await host.getParameter(EDITOR_SCALE)).normalized).toBe(
        process.platform === 'darwin' ? 0 : 0.5,
      );
      const { outputs } = await host.process({
        inputs: [[constant(64, 1), constant(64, 1)]],
      });
      expect(outputs[0]![0]![63]).toBe(1);
    });

    test('follows the plugin resizing itself, and resizes it within its limits', async () => {
      const host = await launch('Fixture Gain', { editor: true });
      const resized = new Promise<EditorInfo>((resolve) =>
        host.once('editorResized', resolve),
      );
      await host.setParameter(EDITOR_SIZE, 1);
      expect(await resized).toMatchObject({ width: 600, height: 450 });
      expect(await host.getEditor()).toMatchObject({ width: 600, height: 450 });
      expect(await host.resizeEditor(100, 100)).toMatchObject({
        width: 200,
        height: 150,
      });
      expect(await host.resizeEditor(800, 500)).toMatchObject({
        width: 800,
        height: 500,
      });
    });

    test('closes and reopens', async () => {
      const host = await launch('Fixture Gain', { editor: true });
      expect(await host.closeEditor()).toEqual({ open: false });
      expect(await host.closeEditor()).toEqual({ open: false });
      expect(await host.openEditor()).toMatchObject({ open: true, width: 400 });
      expect(await host.openEditor()).toMatchObject({ open: true });
    });

    test('a plugin without an editor says so', async () => {
      const error = await launch('Fixture Synth', { editor: true }).catch(
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ code: 'no-editor' });
    });
  },
);
