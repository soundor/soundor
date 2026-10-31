// @vitest-environment happy-dom
import { fireEvent, queryByRole, within } from '@testing-library/dom';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createShell, type Presentation } from '.';
import { WebAudioHost } from '../audio';
import { WebHost } from '../host';
import type { WebEditor } from '../manifest';
import { createParameterStore } from '../parameters';
import '../testing/preact';

const shells: { remove(): void }[] = [];

afterEach(() => {
  for (const shell of shells.splice(0)) shell.remove();
  document.body.replaceChildren();
  document.head.replaceChildren();
  localStorage.clear();
});

/** The default editor: a fixed 800×600 view. */
const FIXED: WebEditor = {
  width: 800,
  height: 600,
  minWidth: 800,
  minHeight: 600,
  maxWidth: 800,
  maxHeight: 600,
  resizable: false,
  resize: 'layout',
};

const RESIZABLE: WebEditor = {
  width: 800,
  height: 600,
  minWidth: 480,
  minHeight: 320,
  maxWidth: 1200,
  maxHeight: 900,
  resizable: true,
  resize: 'layout',
};

/** Scales: its layout stays 800×600, drawn at half to twice that. */
const SCALING: WebEditor = {
  width: 800,
  height: 600,
  minWidth: 400,
  minHeight: 300,
  maxWidth: 1600,
  maxHeight: 1200,
  resizable: true,
  resize: 'scale',
};

function setup(presentation: Presentation = 'demo', editor = FIXED) {
  const host = new WebHost({
    now: () => 0,
    frames: { request: () => 1, cancel: () => {} },
  });
  const audio = new WebAudioHost(host);
  const start = vi.spyOn(audio, 'start').mockResolvedValue();
  const parameters = createParameterStore([
    {
      id: 'gain',
      label: 'Gain',
      type: 'float',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    },
    { id: 'bypass', label: 'Bypass', type: 'bool', default: false },
    {
      id: 'mode',
      label: 'Mode',
      type: 'enum',
      values: ['a', 'b'],
      default: 'a',
    },
  ]);
  const shell = createShell(document.body, {
    pluginName: 'Fixture',
    presentation,
    editor,
    host,
    parameters,
    audio,
  });
  shells.push(shell);
  // `embed` has no dock: queries in it then find nothing.
  const dock = within(
    queryByRole(shell.element, 'toolbar', { name: 'Host' }) ?? shell.viewport,
  );
  // The panel is hidden until opened: queries look into it regardless.
  const panel = within(
    shell.element.querySelector<HTMLElement>('#soundor-panel') ??
      shell.viewport,
  );
  return { host, audio, start, parameters, shell, dock, panel };
}

describe('the dock', () => {
  it('plays, pauses and stops the one transport, starting audio from the click', () => {
    const { host, start, dock } = setup();
    fireEvent.click(dock.getByRole('button', { name: 'Play' }));
    expect(start).toHaveBeenCalledOnce();
    expect(host.snapshot().transport?.playing).toBe(true);
    const pause = dock.getByRole('button', { name: 'Pause' });
    expect(pause.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(pause);
    expect(host.snapshot().transport?.playing).toBe(false);
    fireEvent.click(dock.getByRole('button', { name: 'Play' }));
    fireEvent.click(dock.getByRole('button', { name: 'Stop' }));
    expect(host.snapshot().transport).toMatchObject({
      playing: false,
      ppqPosition: 0,
    });
  });

  it('shows the position as bar.beat', () => {
    const { host, shell } = setup();
    expect(shell.element.querySelector('.soundor-position')?.textContent).toBe(
      '1.1',
    );
    act(() => host.setBpm(140));
    expect(shell.element.querySelector('.soundor-position')?.textContent).toBe(
      '1.1',
    );
  });

  it('starts audio on the first gesture, even on the plugin, once', () => {
    const { start, shell } = setup();
    fireEvent.pointerDown(shell.viewport);
    expect(start).toHaveBeenCalledOnce();
    fireEvent.pointerDown(shell.viewport);
    expect(start).toHaveBeenCalledOnce();
  });

  it('mutes and unmutes, and sets the volume', () => {
    const { audio, start, dock } = setup();
    fireEvent.click(dock.getByRole('button', { name: 'Mute' }));
    expect(start).not.toHaveBeenCalled();
    expect(audio.status.muted).toBe(true);
    expect(
      dock.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.input(dock.getByRole('slider', { name: 'Output volume' }), {
      target: { value: '0.3' },
    });
    expect(audio.status.volume).toBe(0.3);
  });

  it('shows the plugin viewport at the JUCE editor size', () => {
    const { shell } = setup();
    expect(shell.viewport.style.width).toBe('800px');
    expect(shell.viewport.style.height).toBe('600px');
    expect(shell.element.querySelector('.soundor-resize')).toBeNull();
  });

  it("opens the viewport at the config's editor size", () => {
    const { shell } = setup('demo', {
      ...FIXED,
      width: 640,
      height: 400,
    });
    expect([shell.viewport.style.width, shell.viewport.style.height]).toEqual([
      '640px',
      '400px',
    ]);
    expect(shell.element.querySelector('.soundor-resize')).toBeNull();
  });

  it('leaves what the plugin renders in the viewport alone', () => {
    const { host, shell } = setup();
    const plugin = document.createElement('div');
    shell.viewport.append(plugin);
    act(() => {
      host.play();
      host.setBpm(90);
    });
    expect(shell.viewport.contains(plugin)).toBe(true);
  });
});

describe('the panel', () => {
  it('starts closed, opens from the dock and closes again', () => {
    const { shell, dock, panel } = setup();
    const aside = shell.element.querySelector<HTMLElement>('#soundor-panel')!;
    const toggle = dock.getByRole('button', { name: 'Host settings' });
    expect(aside.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(aside.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(panel.getByRole('button', { name: 'Close' }));
    expect(aside.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);

    fireEvent.click(toggle);
    fireEvent.keyDown(panel.getByLabelText('Tempo (BPM)'), { key: 'Escape' });
    expect(aside.hidden).toBe(true);
  });

  it('sets loop, tempo and time signature on the host', () => {
    const { host, panel } = setup();
    fireEvent.click(panel.getByRole('button', { name: 'Loop', hidden: true }));
    expect(host.snapshot().transport?.looping).toBe(true);

    const bpm = panel.getByLabelText<HTMLInputElement>('Tempo (BPM)');
    expect(bpm.value).toBe('120');
    fireEvent.input(bpm, { target: { value: '90' } });
    fireEvent.change(bpm);
    expect(host.snapshot().transport?.bpm).toBe(90);

    const signature = panel.getByLabelText<HTMLSelectElement>('Time signature');
    expect(signature.value).toBe('4/4');
    fireEvent.change(signature, { target: { value: '6/8' } });
    expect(host.snapshot().transport?.timeSignature).toEqual({
      numerator: 6,
      denominator: 8,
    });
  });

  it('keeps a tempo being typed while the transport changes', () => {
    const { host, panel } = setup();
    const bpm = panel.getByLabelText<HTMLInputElement>('Tempo (BPM)');
    fireEvent.input(bpm, { target: { value: '9' } });
    act(() => host.play());
    expect(bpm.value).toBe('9');
  });

  it('follows changes made elsewhere', () => {
    const { host, panel } = setup();
    act(() => {
      host.setBpm(140);
      host.setLooping(true);
    });
    expect(panel.getByLabelText<HTMLInputElement>('Tempo (BPM)').value).toBe(
      '140',
    );
    expect(
      panel
        .getByRole('button', { name: 'Loop', hidden: true })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('shows the source in use again when no file is chosen', () => {
    const { shell, panel, start } = setup();
    const source = panel.getByLabelText<HTMLSelectElement>('Input');
    const file =
      shell.element.querySelector<HTMLInputElement>('input[type="file"]')!;
    const choose = vi.spyOn(file, 'click').mockImplementation(() => {});
    fireEvent.change(source, { target: { value: 'file' } });
    expect(start).toHaveBeenCalledOnce();
    expect(choose).toHaveBeenCalledOnce();
    fireEvent(file, new Event('cancel'));
    expect(source.value).toBe('oscillator');
  });

  it('shows the sample rate and block size', () => {
    const { host, shell } = setup();
    act(() => host.setAudioFormat({ sampleRate: 44100, blockSize: 128 }));
    expect(
      shell.element.querySelector('.soundor-status')?.textContent,
    ).toContain('44.1 kHz · 128 samples');
  });

  it('controls every kind of parameter and follows changes made elsewhere', () => {
    const { panel, parameters } = setup();
    const gain = panel.getByLabelText<HTMLInputElement>('Gain');
    expect(gain.value).toBe('0.5');
    expect(gain.closest('.soundor-param')?.textContent).toContain('0.5 dB');
    fireEvent.input(gain, { target: { value: '0.2' } });
    expect(parameters.byId['gain']!.get()).toBe(0.2);
    act(() => parameters.byId['gain']!.set(0.75));
    expect(gain.value).toBe('0.75');

    const bypass = panel.getByLabelText<HTMLInputElement>('Bypass');
    fireEvent.click(bypass);
    expect(parameters.byId['bypass']!.get()).toBe(true);

    const mode = panel.getByLabelText<HTMLSelectElement>('Mode');
    act(() => parameters.byId['mode']!.set('b'));
    expect(mode.value).toBe('b');
    fireEvent.change(mode, { target: { value: 'a' } });
    expect(parameters.byId['mode']!.get()).toBe('a');
  });

  it('makes a gesture of dragging a slider', () => {
    const { panel, parameters } = setup();
    const gain = panel.getByLabelText('Gain');
    fireEvent.pointerDown(gain);
    expect(parameters.byId['gain']!.inGesture).toBe(true);
    fireEvent.pointerUp(gain);
    expect(parameters.byId['gain']!.inGesture).toBe(false);
  });
});

describe('the stage', () => {
  it('scales the plugin down to fit, never up', () => {
    let resized: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { shell } = setup();
    const stage = shell.element.querySelector<HTMLElement>('.soundor-stage')!;
    const frame = shell.element.querySelector<HTMLElement>('.soundor-frame')!;
    const resize = (width: number, height: number) => {
      Object.defineProperty(stage, 'clientWidth', {
        value: width,
        configurable: true,
      });
      Object.defineProperty(stage, 'clientHeight', {
        value: height,
        configurable: true,
      });
      act(() => resized!());
    };
    // The stage's padding: 16px around, 76px under it for the dock.
    resize(432, 392);
    expect(shell.viewport.style.transform).toBe('scale(0.5)');
    expect([frame.style.width, frame.style.height]).toEqual(['400px', '300px']);
    expect(shell.viewport.style.width).toBe('800px');

    resize(3000, 2000);
    expect(shell.viewport.style.transform).toBe('');
    expect(frame.style.width).toBe('800px');
    vi.unstubAllGlobals();
  });
});

/** Stubs ResizeObserver; `resize` then gives the stage a size. */
function observeStage() {
  let resized: (() => void) | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  return (shell: { element: HTMLElement }, width: number, height: number) => {
    const stage = shell.element.querySelector<HTMLElement>('.soundor-stage')!;
    Object.defineProperty(stage, 'clientWidth', {
      value: width,
      configurable: true,
    });
    Object.defineProperty(stage, 'clientHeight', {
      value: height,
      configurable: true,
    });
    act(() => resized!());
  };
}

describe('a resizable view', () => {
  afterEach(() => vi.unstubAllGlobals());

  function resizable(editor = RESIZABLE, presentation: Presentation = 'demo') {
    const context = setup(presentation, editor);
    const handle =
      context.shell.element.querySelector<HTMLElement>('.soundor-resize')!;
    const frame =
      context.shell.element.querySelector<HTMLElement>('.soundor-frame')!;
    const size = () => [
      context.shell.viewport.style.width,
      context.shell.viewport.style.height,
    ];
    const drag = (
      dx: number,
      dy: number,
      { end = 'up', pointerId = 1 }: { end?: string; pointerId?: number } = {},
    ) => {
      act(() => {
        fireEvent.pointerDown(handle, {
          pointerId,
          button: 0,
          clientX: 100,
          clientY: 100,
        });
        fireEvent.pointerMove(handle, {
          pointerId,
          clientX: 100 + dx / 2,
          clientY: 100 + dy / 2,
        });
        fireEvent.pointerMove(handle, {
          pointerId,
          clientX: 100 + dx,
          clientY: 100 + dy,
        });
        if (end === 'up') fireEvent.pointerUp(handle, { pointerId });
        if (end === 'cancel') fireEvent.pointerCancel(handle, { pointerId });
      });
    };
    return { ...context, handle, frame, size, drag };
  }

  it('opens at the editor size, with a handle outside the view', () => {
    const { handle, size, shell } = resizable({
      ...RESIZABLE,
      width: 900,
      height: 500,
    });
    expect(size()).toEqual(['900px', '500px']);
    expect(handle.getAttribute('aria-label')).toBe('Resize the plugin view');
    // In the frame, beside the viewport: never over the plugin's own controls.
    expect(shell.viewport.contains(handle)).toBe(false);
  });

  it('changes the logical size, not the scale, as the corner is dragged', () => {
    const { size, drag, frame, shell } = resizable();
    // The view stays centred: its size changes by twice the pointer's move.
    drag(50, 25);
    expect(size()).toEqual(['900px', '650px']);
    expect(shell.viewport.style.transform).toBe('');
    expect(frame.style.width).toBe('900px');
    drag(-100, -150);
    expect(size()).toEqual(['700px', '350px']);
  });

  it('keeps to the editor limits', () => {
    const { size, drag } = resizable();
    drag(-1000, -1000);
    expect(size()).toEqual(['480px', '320px']);
    drag(5000, 5000);
    expect(size()).toEqual(['1200px', '900px']);
  });

  it('stops at the edge of the stage rather than scaling down', () => {
    const resize = observeStage();
    const { size, drag, shell } = resizable();
    // Room for 1000×700 (the stage's padding: 16 around, 76 under it).
    resize(shell, 1032, 792);
    drag(1000, 1000);
    expect(size()).toEqual(['1000px', '700px']);
    expect(shell.viewport.style.transform).toBe('');
  });

  it('moves the size in logical pixels when the stage scales it down', () => {
    const resize = observeStage();
    const { size, drag, shell } = resizable();
    // Half the room it needs: shown at half its size.
    resize(shell, 432, 392);
    expect(shell.viewport.style.transform).toBe('scale(0.5)');
    drag(-25, -25);
    expect(size()).toEqual(['700px', '500px']);
  });

  it('puts the size back when the browser cancels the drag', () => {
    const { size, drag } = resizable();
    drag(50, 50, { end: 'cancel' });
    expect(size()).toEqual(['800px', '600px']);
    drag(50, 50, { end: 'none' });
    expect(size()).toEqual(['900px', '700px']);
  });

  it('follows only the pointer that pressed it', () => {
    const { size, drag, handle } = resizable();
    drag(50, 50, { end: 'none' });
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 2, clientX: 0, clientY: 0 });
    });
    expect(size()).toEqual(['900px', '700px']);
    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 0 });
    });
    expect(size()).toEqual(['900px', '700px']);
  });

  it('resizes with the arrow keys', () => {
    const { size, handle } = resizable();
    act(() => {
      fireEvent.keyDown(handle, { key: 'ArrowRight' });
    });
    act(() => {
      fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    });
    expect(size()).toEqual(['810px', '550px']);
  });

  it('is not resizable embedded, where it fills the page', () => {
    const { shell } = setup('embed', RESIZABLE);
    expect(shell.element.querySelector('.soundor-resize')).toBeNull();
    expect(shell.viewport.style.width).toBe('');
    expect(shell.element.querySelector('.soundor-fill')).not.toBeNull();
  });

  it('has the view measured again when it scales it', () => {
    const resize = observeStage();
    const onScale = vi.fn<() => void>();
    const context = setup('demo', RESIZABLE);
    context.shell.remove();
    const shell = createShell(document.body, {
      pluginName: 'Fixture',
      presentation: 'demo',
      editor: RESIZABLE,
      onScale,
      host: context.host,
      parameters: context.parameters,
      audio: context.audio,
    });
    shells.push(shell);
    onScale.mockClear();
    resize(shell, 432, 392);
    expect(onScale).toHaveBeenCalledOnce();
    resize(shell, 433, 392);
    expect(onScale).toHaveBeenCalledOnce();
    resize(shell, 3000, 2000);
    expect(onScale).toHaveBeenCalledTimes(2);
  });

  it('is resizable in dev as in demo', () => {
    const { handle, drag, size } = resizable(RESIZABLE, 'dev');
    expect(handle).not.toBeNull();
    drag(20, 20);
    expect(size()).toEqual(['840px', '640px']);
  });
});

describe('a view that scales', () => {
  afterEach(() => vi.unstubAllGlobals());

  function scaling() {
    const context = setup('demo', SCALING);
    const handle =
      context.shell.element.querySelector<HTMLElement>('.soundor-resize')!;
    const frame =
      context.shell.element.querySelector<HTMLElement>('.soundor-frame')!;
    const drag = (dx: number, dy: number) => {
      act(() => {
        fireEvent.pointerDown(handle, {
          pointerId: 1,
          button: 0,
          clientX: 100,
          clientY: 100,
        });
        fireEvent.pointerMove(handle, {
          pointerId: 1,
          clientX: 100 + dx,
          clientY: 100 + dy,
        });
        fireEvent.pointerUp(handle, { pointerId: 1 });
      });
    };
    const shown = () => [frame.style.width, frame.style.height];
    return { ...context, handle, frame, drag, shown };
  }

  it('keeps its layout and draws it larger, keeping the aspect ratio', () => {
    const { drag, shown, shell } = scaling();
    // Mostly sideways: 800 → 1000 wide, so 1.25 times, 750 tall.
    drag(100, 10);
    expect(shown()).toEqual(['1000px', '750px']);
    expect(shell.viewport.style.width).toBe('800px');
    expect(shell.viewport.style.height).toBe('600px');
    expect(shell.viewport.style.transform).toBe('scale(1.25)');
  });

  it('keeps to its limits, as a zoom', () => {
    const { drag, shown, shell } = scaling();
    drag(-1000, 0);
    expect(shown()).toEqual(['400px', '300px']);
    expect(shell.viewport.style.transform).toBe('scale(0.5)');
    drag(5000, 5000);
    expect(shown()).toEqual(['1600px', '1200px']);
  });

  it('shrinks with the arrow keys too', () => {
    const { handle, shown } = scaling();
    act(() => {
      fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    });
    // 50 off the height: 550 of 600, the width following.
    expect(shown()).toEqual(['733px', '550px']);
  });

  it('is scaled down to fit on top of its zoom', () => {
    const resize = observeStage();
    const { drag, shell, shown } = scaling();
    drag(200, 150);
    expect(shown()).toEqual(['1200px', '900px']);
    // Room for 800×600 only (the stage's padding: 16 around, 76 under it):
    // drawn at 1.5, fitted at 2/3, so shown at its own size.
    resize(shell, 832, 692);
    expect(shown()).toEqual(['800px', '600px']);
    expect(shell.viewport.style.width).toBe('800px');
    expect(shell.viewport.style.transform).toBe('');
    // A drag goes no further than the room it has.
    drag(200, 150);
    expect(shown()).toEqual(['800px', '600px']);
  });
});

describe('a view that scales, embedded', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps its layout and fills the page as far as its shape lets it', () => {
    const resize = observeStage();
    const { shell } = setup('embed', SCALING);
    expect(shell.element.querySelector('.soundor-resize')).toBeNull();
    resize(shell, 1200, 600);
    expect(shell.viewport.style.width).toBe('800px');
    expect(shell.viewport.style.height).toBe('600px');
    // 600 tall: its own size, 1200 wide or not.
    expect(shell.viewport.style.transform).toBe('');
    resize(shell, 400, 600);
    expect(shell.viewport.style.transform).toBe('scale(0.5)');
  });
});

describe('notices', () => {
  it('shows a message over the viewport', () => {
    const { shell } = setup();
    shell.showMessage('The plugin UI failed', 'Error: boom');
    expect(shell.viewport.textContent).toBe('The plugin UI failedError: boom');
  });

  it("clears its messages, never the plugin's own nodes", () => {
    const { shell } = setup();
    const plugin = document.createElement('div');
    plugin.textContent = 'plugin';
    shell.viewport.append(plugin);
    shell.showMessage('First');
    shell.showMessage('Second', 'detail');
    shell.clearMessages();
    expect(shell.viewport.textContent).toBe('plugin');
  });
});

describe('presentations', () => {
  it('demo: no host state, and the panel is not remembered', () => {
    const { shell, dock } = setup('demo');
    expect(shell.element.dataset['presentation']).toBe('demo');
    expect(shell.element.querySelector('.soundor-inspector')).toBeNull();
    fireEvent.click(dock.getByRole('button', { name: 'Host settings' }));
    expect(localStorage.getItem('soundor:web-host:panel')).toBeNull();
  });

  it('dev: the host state in the panel', () => {
    const { shell, host } = setup('dev');
    const inspector = shell.element.querySelector('.soundor-inspector')!;
    expect(inspector.textContent).toContain('"hostName": "Soundor Web"');
    act(() => host.setBpm(100));
    expect(inspector.textContent).toContain('"bpm": 100');
  });

  it('dev: remembers whether the panel was open', () => {
    const first = setup('dev');
    fireEvent.click(first.dock.getByRole('button', { name: 'Host settings' }));
    act(() => first.shell.remove());
    const { shell } = setup('dev');
    expect(
      shell.element.querySelector<HTMLElement>('#soundor-panel')!.hidden,
    ).toBe(false);
  });

  it('embed: the plugin view alone, filling the page', () => {
    const { shell, start } = setup('embed');
    expect(shell.element.dataset['presentation']).toBe('embed');
    expect(queryByRole(shell.element, 'toolbar')).toBeNull();
    expect(shell.element.querySelector('#soundor-panel')).toBeNull();
    expect(shell.viewport.closest('.soundor-fill')).not.toBeNull();
    // No size of its own: the page's.
    expect(shell.viewport.style.width).toBe('');
    // Audio still starts with a gesture on the plugin.
    fireEvent.pointerDown(shell.viewport);
    expect(start).toHaveBeenCalledOnce();
  });

  it('stops listening when removed', () => {
    const { shell, parameters, host } = setup('dev');
    act(() => shell.remove());
    expect(document.body.children).toHaveLength(0);
    expect(queryByRole(document.body, 'toolbar')).toBeNull();
    expect(() => {
      parameters.byId['gain']!.set(0.9);
      host.setBpm(80);
    }).not.toThrow();
  });
});
