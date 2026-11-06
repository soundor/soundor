// Exercise OS resize notifications, including corrections and queued events.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import type { EditorInfo } from '../../src/index.ts';
import { EDITOR_SIZE, closeAll, hasDisplay, launch } from './fixtures.ts';

afterEach(closeAll);

function settings(panelOpen = false): string {
  const path = join(
    mkdtempSync(join(tmpdir(), 'vst3-window-')),
    'settings.json',
  );
  writeFileSync(path, JSON.stringify({ panelOpen }));
  return path;
}

function windowAction(
  action: string,
  x: number,
  y: number,
  ...delta: number[]
): void {
  execFileSync(
    join(
      dirname(process.env.SOUNDOR_VST3_HOST_EXECUTABLE!),
      'soundor_vst3_host_window_test',
    ),
    [action, String(x), String(y), ...delta.map(String)],
  );
}

describe.runIf(process.platform === 'linux' && hasDisplay)(
  'native window resizing',
  () => {
    test('audio controls start explicitly and stay stopped after other clicks', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: {
          SDL_AUDIO_DRIVER: 'dummy',
          SOUNDOR_VST3_HOST_SETTINGS: settings(true),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      windowAction('click', 10, 10);
      expect((await host.getAudio()).running).toBe(false);
      // The panel's Start/Stop control must work on the first click.
      windowAction('click', 510, 295);
      await expect.poll(() => host.getAudio()).toMatchObject({ running: true });
      windowAction('click', 510, 295);
      await expect
        .poll(() => host.getAudio())
        .toMatchObject({ running: false });
      windowAction('click', 10, 10);
      expect((await host.getAudio()).running).toBe(false);
      // Starting through the dock must not also mute on the same click.
      windowAction('click', 77, 522);
      await expect
        .poll(() => host.getAudio())
        .toMatchObject({ running: true, muted: false });
      windowAction('click', 510, 295);
      await expect
        .poll(() => host.getAudio())
        .toMatchObject({ running: false });
    });

    test('the visible grip resizes the plugin through a captured drag', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      // The grip sits outside the editor's bottom-right corner (16px padding).
      // As in the web host, there is no more room: the window stays.
      const before = await host.getEditor();
      windowAction('drag', 423, 323, 100, 80);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await host.getEditor()).toMatchObject({
        width: 400,
        height: 300,
        window: before.window,
      });
      // The editor is centred and its corner follows the pointer, so it
      // shrinks twice as far as the pointer moves.
      windowAction('drag', 423, 323, -50, -40);
      await expect
        .poll(() => host.getEditor())
        .toMatchObject({ width: 300, height: 220, window: before.window });
      // Dragged past the stage's edge, it stops there.
      windowAction('drag', 373, 283, 200, 200);
      await expect
        .poll(() => host.getEditor())
        .toMatchObject({ width: 400, height: 300, window: before.window });
    });

    test('a press on the grip without a move leaves the editor as it is', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      for (let press = 0; press < 3; press += 1) {
        expect(() => windowAction('press-keeps-view', 423, 323)).not.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await host.getEditor()).toMatchObject({ width: 400, height: 300 });
    });

    test('the editor stays within the window when it asks for a size itself', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      const before = await host.getEditor();
      const held = new Promise<EditorInfo>((resolve) =>
        host.once('editorResized', resolve),
      );
      await host.setParameter(EDITOR_SIZE, 1);
      expect(await held).toMatchObject({ width: 400, height: 300 });
      expect((await host.getEditor()).window).toEqual(before.window);
      await new Promise((resolve) => setTimeout(resolve, 300));
      windowAction('maximize', 1000, 800);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: 1000, height: 800 });
      await host.setParameter(EDITOR_SIZE, 0);
      const given = new Promise<EditorInfo>((resolve) =>
        host.once('editorResized', resolve),
      );
      await host.setParameter(EDITOR_SIZE, 1);
      expect(await given).toMatchObject({
        width: 600,
        height: 450,
        window: { width: 1000, height: 800 },
      });
    });

    test('a maximized stage stays fixed while the grip resizes the centered editor', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      windowAction('maximize', 1000, 800);
      await expect
        .poll(() => host.getEditor())
        .toMatchObject({ window: { width: 1000, height: 800 } });
      await new Promise((resolve) => setTimeout(resolve, 300));
      // The centered editor spans (300,220) to (700,520), and its corner
      // follows the pointer.
      windowAction('drag', 707, 527, 10, 10);
      await expect
        .poll(() => host.getEditor())
        .toMatchObject({
          width: 420,
          height: 320,
          window: { width: 1000, height: 800 },
        });
    });

    test('the editor stays in the window throughout a grip drag, and returns to its place', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      windowAction('maximize', 1000, 800);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: 1000, height: 800 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      windowAction('drag-probe', 707, 527, 100, 80);
      await expect
        .poll(() => host.getEditor())
        .toMatchObject({ width: 600, height: 460 });
    });

    test('a grip drag ends where the pointer does, when the release comes with the last move', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      windowAction('maximize', 1000, 800);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: 1000, height: 800 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      windowAction('drag-release', 707, 527, 100, 80);
      await expect
        .poll(() => host.getEditor())
        .toMatchObject({ width: 600, height: 460 });
    });

    for (const presentation of ['editor', 'host'] as const) {
      test(`${presentation} keeps the editor visible during repeated native resizes`, async () => {
        const host = await launch('Fixture Gain', {
          editor: true,
          presentation,
          env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        const editor = await host.getEditor();
        expect(() =>
          windowAction(
            'probe',
            editor.window!.width + 100,
            editor.window!.height + 80,
          ),
        ).not.toThrow();
      });
    }

    test('the bare editor cannot be maximized or minimized', async () => {
      await launch('Fixture Gain', {
        editor: true,
        presentation: 'editor',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      expect(() => windowAction('only-move-resize-close', 0, 0)).not.toThrow();
    });

    test('the bare editor follows OS resizes and settles at the plugin limits', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'editor',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      for (const [width, height] of [
        [720, 480],
        [100, 100],
        [450, 320],
        [800, 500],
        [1200, 900],
      ]) {
        windowAction('resize', width!, height!);
        const expected = {
          width: Math.min(1000, Math.max(200, width!)),
          height: Math.min(750, Math.max(150, height!)),
        };
        await expect.poll(() => host.getEditor()).toMatchObject(expected);
        // The window takes the editor's size once the drag has stopped.
        await expect
          .poll(() => host.getEditor())
          .toMatchObject({ ...expected, window: expected });
      }
    });

    test('a bare editor that keeps its shape follows one edge, and the window follows it', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'editor',
        env: {
          SOUNDOR_VST3_HOST_SETTINGS: settings(),
          SOUNDOR_FIXTURE_EDITOR_KEEPS_SHAPE: '1',
        },
      });
      await host.resizeEditor(400, 300);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: 400, height: 300 });
      // Only one side changes, as a window edge does: the other follows.
      for (const [width, height, expected] of [
        [800, 300, { width: 800, height: 600 }],
        [800, 720, { width: 960, height: 720 }],
        [480, 720, { width: 480, height: 360 }],
      ] as const) {
        windowAction('resize', width, height);
        await expect
          .poll(() => host.getEditor())
          .toMatchObject({ ...expected, window: expected });
      }
    });

    test('resizing the window leaves the editor its size', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const editor = { width: 400, height: 300 };
      expect(await host.getEditor()).toMatchObject(editor);
      for (const [width, height] of [
        [382, 342],
        [800, 600],
      ] as const) {
        windowAction('resize', width, height);
        await expect
          .poll(async () => (await host.getEditor()).window)
          .toEqual({ width, height });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await host.getEditor()).toMatchObject(editor);
      }
    });

    test("a fixed editor's host window can be resized, around the same editor", async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: {
          SOUNDOR_VST3_HOST_SETTINGS: settings(),
          SOUNDOR_FIXTURE_EDITOR_FIXED: '1',
        },
      });
      const editor = { width: 400, height: 300 };
      expect(await host.getEditor()).toMatchObject(editor);
      expect(() => windowAction('user-resizable', 0, 0)).not.toThrow();
      windowAction('resize', 900, 700);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: 900, height: 700 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await host.getEditor()).toMatchObject(editor);
    });

    test("a fixed editor's bare window keeps the editor's size", async () => {
      await launch('Fixture Gain', {
        editor: true,
        presentation: 'editor',
        env: {
          SOUNDOR_VST3_HOST_SETTINGS: settings(),
          SOUNDOR_FIXTURE_EDITOR_FIXED: '1',
        },
      });
      expect(() => windowAction('user-resizable', 0, 0)).toThrow(
        'Command failed',
      );
    });

    test('maximizing and restoring leave the editor its size', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      windowAction('drag', 423, 323, -50, -40);
      const editor = { width: 300, height: 220 };
      await expect.poll(() => host.getEditor()).toMatchObject(editor);
      const small = (await host.getEditor()).window!;
      await new Promise((resolve) => setTimeout(resolve, 300));
      windowAction('maximize', 1000, 800);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: 1000, height: 800 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await host.getEditor()).toMatchObject(editor);
      windowAction('unmaximize', small.width, small.height);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual(small);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await host.getEditor()).toMatchObject(editor);
    });

    test('the panel opens and closes beside the stage the user made', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings(true) },
      });
      const opened = (await host.getEditor()).window!;
      expect(opened.width).toBeGreaterThan(700);
      await new Promise((resolve) => setTimeout(resolve, 200));
      windowAction('resize', opened.width + 200, opened.height + 100);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: opened.width + 200, height: opened.height + 100 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      // The dock's panel button: the stage is the same either way, so it stays.
      const stage = opened.width + 200 - 300;
      const button: [number, number] = [
        stage / 2 + 135,
        opened.height + 100 - 38,
      ];
      windowAction('click', ...button);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: stage, height: opened.height + 100 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      windowAction('click', ...button);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: stage + 300, height: opened.height + 100 });
    });

    test('resizing the host window changes the stage, and the grip uses it', async () => {
      const host = await launch('Fixture Gain', {
        editor: true,
        presentation: 'host',
        env: { SOUNDOR_VST3_HOST_SETTINGS: settings() },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      windowAction('resize', 800, 600);
      await expect
        .poll(async () => (await host.getEditor()).window)
        .toEqual({ width: 800, height: 600 });
      expect(await host.getEditor()).toMatchObject({ width: 400, height: 300 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Centred on the stage: (200,120) to (600,420). Its corner follows the
      // pointer, and stops at the stage's room.
      windowAction('drag', 607, 427, 40, 30);
      await expect
        .poll(() => host.getEditor())
        .toMatchObject({
          width: 480,
          height: 360,
          window: { width: 800, height: 600 },
        });
      windowAction('drag', 647, 457, 400, 400);
      await expect
        .poll(() => host.getEditor())
        .toMatchObject({
          width: 768,
          height: 508,
          window: { width: 800, height: 600 },
        });
    });
  },
);
