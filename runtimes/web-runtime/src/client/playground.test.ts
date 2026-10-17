// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as ui from './modules/ui';
import {
  type PlaygroundHost,
  playgroundScript,
  startPlayground,
} from './playground';

afterEach(() => {
  globalThis.__soundorModules = undefined;
  globalThis.soundorPlayground = undefined;
});

describe('playgroundScript', () => {
  const page = 'https://soundor.dev/examples/basic/index.html';

  it('is null outside playground mode', () => {
    expect(playgroundScript(new URL(page))).toBeNull();
  });

  it("resolves the script against the page, on the page's origin", () => {
    expect(
      playgroundScript(new URL(`${page}?playground=/playground/kit.js`))?.href,
    ).toBe('https://soundor.dev/playground/kit.js');
    expect(
      playgroundScript(new URL(`${page}?playground=../../playground/kit.js`))
        ?.href,
    ).toBe('https://soundor.dev/playground/kit.js');
  });

  it('refuses a script from another origin', () => {
    for (const script of [
      'https://elsewhere.example/kit.js',
      '//elsewhere.example/kit.js',
      'data:text/javascript,alert(1)',
    ]) {
      expect(() =>
        playgroundScript(
          new URL(`${page}?playground=${encodeURIComponent(script)}`),
        ),
      ).toThrow("must come from this page's origin");
    }
  });
});

describe('startPlayground', () => {
  const shell = () => ({
    showMessage: vi.fn<(title: string, detail?: string) => void>(),
    clearMessages: vi.fn<() => void>(),
  });
  const script = new URL('https://soundor.dev/playground/kit.js');

  it("gives the script the host's modules, before and when it starts", async () => {
    let started: PlaygroundHost | undefined;
    const load = vi.fn<(url: URL) => Promise<void>>(async () => {
      // A bundle of @soundor/react reads soundor:ui here as it loads.
      expect(globalThis.__soundorModules?.['soundor:ui']).toBe(ui);
      globalThis.soundorPlayground = { start: (host) => (started = host) };
    });
    const host = shell();
    await startPlayground(script, host, load);

    expect(load).toHaveBeenCalledWith(script);
    expect(Object.keys(started!.modules).sort()).toEqual([
      'soundor:fs',
      'soundor:host',
      'soundor:native',
      'soundor:parameters',
      'soundor:storage',
      'soundor:ui',
    ]);
    started!.showMessage('Failed', 'detail');
    started!.clearMessages();
    expect(host.showMessage).toHaveBeenCalledWith('Failed', 'detail');
    expect(host.clearMessages).toHaveBeenCalledOnce();
  });

  it('fails when the script is not a playground script', async () => {
    await expect(
      startPlayground(script, shell(), async () => {}),
    ).rejects.toThrow('did not set soundorPlayground');
  });

  it('fails when the script does not load', async () => {
    await expect(
      startPlayground(script, shell(), () => Promise.reject(new Error('404'))),
    ).rejects.toThrow('404');
  });
});
