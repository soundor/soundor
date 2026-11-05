// The `host` presentation: the editor with the host interface around it.
// Needs a display (Xvfb on Linux CI).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import type { EditorInfo } from '../../src/index.ts';
import { EDITOR_SIZE, closeAll, hasDisplay, launch } from './fixtures.ts';

afterEach(closeAll);

/** A settings file of its own, so the user's never matter. */
function settings(values: object = {}): Record<string, string> {
  const path = join(
    mkdtempSync(join(tmpdir(), 'vst3-host-settings-')),
    'vst3-host.json',
  );
  writeFileSync(path, JSON.stringify(values));
  return { SOUNDOR_VST3_HOST_SETTINGS: path, SDL_AUDIO_DRIVER: 'dummy' };
}

function chrome(editor: EditorInfo): { width: number; height: number } {
  return {
    width: editor.window!.width - editor.width!,
    height: editor.window!.height - editor.height!,
  };
}

describe.runIf(hasDisplay || process.env.SOUNDOR_VST3_HOST_REQUIRE_UI === '1')(
  'the host interface',
  () => {
    test('shows the editor at its own size, with the interface around it', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: settings(),
      });
      const editor = await host.getEditor();
      expect(editor).toMatchObject({
        open: true,
        presentation: 'host',
        width: 400,
        height: 300,
      });
      const around = chrome(editor);
      expect(around.width).toBeGreaterThan(0);
      expect(around.height).toBeGreaterThan(0);

      // The editor's own resizing works as without the interface.
      const resized = new Promise<EditorInfo>((resolve) =>
        host.once('editorResized', resolve),
      );
      await host.setParameter(EDITOR_SIZE, 1);
      // Within the window's room, as in the web host: it has none to spare.
      expect(await resized).toMatchObject({ width: 400, height: 300 });
      const larger = await host.resizeEditor(800, 500);
      expect(larger).toMatchObject({ width: 800, height: 500 });
      // The editor accepts the size immediately; the native window manager
      // acknowledges its geometry asynchronously, without blocking the UI.
      await expect
        .poll(async () => chrome(await host.getEditor()))
        .toEqual(around);
    });

    test('switches presentations without changing the editor', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        env: settings(),
      });
      expect(await host.getEditor()).toMatchObject({
        presentation: 'editor',
        width: 400,
        height: 300,
        window: { width: 400, height: 300 },
      });
      await host.resizeEditor(500, 350);
      const hosted = await host.openEditor({ presentation: 'host' });
      expect(hosted).toMatchObject({
        presentation: 'host',
        width: 500,
        height: 350,
      });
      await expect
        .poll(async () => (await host.getEditor()).window!.width)
        .toBeGreaterThan(500);
      expect(await host.openEditor({ presentation: 'editor' })).toMatchObject({
        presentation: 'editor',
        width: 500,
        height: 350,
      });
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: 500, height: 350 });
    });

    test('draws only when something changes', async () => {
      // The panel stays closed: it would show the fixture's editor ticking.
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: settings(),
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const before = (await host.getEditor()).interfaceFrames!;
      expect(before).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((await host.getEditor()).interfaceFrames).toBe(before);
      // A value the dock shows changes: it draws again.
      await host.setTransport({ musicalPosition: 8 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect((await host.getEditor()).interfaceFrames).toBeGreaterThan(before);
    });

    test("follows the user's setting unless the launch asks", async () => {
      const bare = settings({ presentation: 'editor' });
      const fromSettings = await launch('Fixture Gain', {
        editor: true,
        presentation: null,
        env: bare,
      });
      expect(await fromSettings.getEditor()).toMatchObject({
        presentation: 'editor',
      });
      const asked = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: bare,
      });
      expect(await asked.getEditor()).toMatchObject({ presentation: 'host' });
      const byDefault = await launch('Fixture Gain', {
        editor: true,
        presentation: null,
        env: settings(),
      });
      expect(await byDefault.getEditor()).toMatchObject({
        presentation: 'host',
      });
    });
  },
);
