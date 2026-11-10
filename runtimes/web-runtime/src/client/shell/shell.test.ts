// @vitest-environment happy-dom
import { fireEvent, queryByRole, within } from '@testing-library/dom';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createShell, type Presentation, type ViewGeometry } from '.';
import { WebAudioHost } from '../audio';
import { WebHost } from '../host';
import { readManifest, type WebEditor } from '../manifest';
import { storeOf } from '../testing/store';
import { viewLayout } from './resize';
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
  fit: 'contain',
  keepAspectRatio: false,
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
  fit: 'contain',
  keepAspectRatio: false,
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
  fit: 'contain',
  keepAspectRatio: true,
};

/**
 * Scales, laid out over a viewport of another shape: 800×600 is its safe
 * area. Its handle keeps its aspect ratio.
 */
const COVERING: WebEditor = { ...SCALING, fit: 'cover' };
/** Covers a viewport of any shape, its handle setting any. */
const COVERING_FREELY: WebEditor = { ...COVERING, keepAspectRatio: false };

function setup(
  presentation: Presentation = 'demo',
  editor = FIXED,
  onGeometry?: (geometry: ViewGeometry) => void,
) {
  const host = new WebHost({
    now: () => 0,
    frames: { request: () => 1, cancel: () => {} },
  });
  const audio = new WebAudioHost(host);
  const start = vi.spyOn(audio, 'start').mockResolvedValue();
  const parameters = storeOf({
    gain: {
      type: 'float32',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    },
    bypass: { type: 'boolean', label: 'Bypass', default: false },
    mode: {
      type: 'choice',
      label: 'Mode',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      default: 'a',
    },
  });
  const shell = createShell(document.body, {
    pluginName: 'Fixture',
    presentation,
    editor,
    onGeometry,
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
    expect(gain.value).toBe('500');
    expect(gain.closest('.soundor-param')?.textContent).toContain('0.500 dB');
    fireEvent.input(gain, { target: { value: '250' } });
    expect(parameters.byId['gain']!.get()).toBe(0.25);
    act(() => parameters.byId['gain']!.set(0.75));
    expect(gain.value).toBe('750');

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
    const resize = observeStage();
    const { shell } = setup('embed', RESIZABLE);
    expect(shell.element.querySelector('.soundor-resize')).toBeNull();
    expect(shell.element.querySelector('.soundor-fill')).not.toBeNull();
    // Laid out at the page's size, which owns it…
    resize(shell, 1000, 700);
    expect([shell.viewport.style.width, shell.viewport.style.height]).toEqual([
      '1000px',
      '700px',
    ]);
    // …up to its maximum (1200×900): beyond it, centred in bands.
    resize(shell, 1500, 1000);
    expect([shell.viewport.style.width, shell.viewport.style.height]).toEqual([
      '1200px',
      '900px',
    ]);
    expect([shell.viewport.style.left, shell.viewport.style.top]).toEqual([
      '150px',
      '50px',
    ]);
    expect(
      shell.element
        .querySelector('.soundor-frame')!
        .classList.contains('soundor-letterbox'),
    ).toBe(true);
  });

  it('has no handle when its limits allow no other size', () => {
    const { shell } = setup('demo', {
      ...RESIZABLE,
      minWidth: 800,
      maxWidth: 800,
      minHeight: 600,
      maxHeight: 600,
    });
    expect(shell.element.querySelector('.soundor-resize')).toBeNull();
    // One axis free is enough.
    const wide = setup('demo', {
      ...RESIZABLE,
      minHeight: 600,
      maxHeight: 600,
    });
    expect(wide.shell.element.querySelector('.soundor-resize')).not.toBeNull();
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
    // 800×600 → 1000×750: 1.25 times.
    drag(100, 75);
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
    // 50 off the height: the nearest size at its ratio to 800×550.
    expect(shown()).toEqual(['776px', '582px']);
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

describe("the editor's size and the view's safe area", () => {
  afterEach(() => vi.unstubAllGlobals());

  function geometry(presentation: Presentation, editor: WebEditor) {
    // The sizes; what the plugin may ask is checked on its own below.
    const told: Pick<ViewGeometry, 'editor' | 'safeArea'>[] = [];
    const all: ViewGeometry[] = [];
    const context = setup(presentation, editor, (next) => {
      all.push(next);
      told.push({ editor: next.editor, safeArea: next.safeArea });
    });
    const handle =
      context.shell.element.querySelector<HTMLElement>('.soundor-resize');
    const drag = (dx: number, dy: number) => {
      act(() => {
        fireEvent.pointerDown(handle!, {
          pointerId: 1,
          button: 0,
          clientX: 100,
          clientY: 100,
        });
        fireEvent.pointerMove(handle!, {
          pointerId: 1,
          clientX: 100 + dx,
          clientY: 100 + dy,
        });
        fireEvent.pointerUp(handle!, { pointerId: 1 });
      });
    };
    const viewport = () => [
      context.shell.viewport.style.width,
      context.shell.viewport.style.height,
      context.shell.viewport.style.transform,
    ];
    return { ...context, told, all, drag, viewport };
  }

  it('are the view and all of it, telling once per change', () => {
    const { told, drag } = geometry('demo', RESIZABLE);
    expect(told).toEqual([
      { editor: { width: 800, height: 600 }, safeArea: null },
    ]);
    drag(50, 25);
    expect(told.at(-1)).toEqual({
      editor: { width: 900, height: 650 },
      safeArea: null,
    });
    // Dragged to the same size again: nothing new.
    const count = told.length;
    drag(0, 0);
    expect(told).toHaveLength(count);
  });

  it('are the size the layout is drawn at, with an editor that contains it', () => {
    const { told, drag, viewport } = geometry('demo', SCALING);
    drag(100, 75);
    expect(told.at(-1)).toEqual({
      editor: { width: 1000, height: 750 },
      safeArea: null,
    });
    expect(viewport()).toEqual(['800px', '600px', 'scale(1.25)']);
  });

  it('cover: keeps the aspect ratio by default, so all of it is safe', () => {
    const { told, drag, viewport, shell } = geometry('demo', COVERING);
    // Zoomed by 1.25 as a whole, as without cover.
    drag(100, 75);
    expect(viewport()).toEqual(['800px', '600px', 'scale(1.25)']);
    // Its own shape: no bands.
    expect(
      shell.element
        .querySelector('.soundor-frame')!
        .classList.contains('soundor-letterbox'),
    ).toBe(false);
    expect(shell.viewport.style.left).toBe('');
    expect(told.at(-1)).toEqual({
      editor: { width: 1000, height: 750 },
      safeArea: { x: 0, y: 0, width: 800, height: 600 },
    });
  });

  it('contain without its aspect ratio: any shape, letterboxed', () => {
    const { told, drag, viewport, shell } = geometry('demo', {
      ...SCALING,
      keepAspectRatio: false,
    });
    drag(100, 0);
    // The layout stays 800×600, at the smaller side's zoom (1), in the
    // middle of the editor's 1000×600, bands of its own beside it.
    expect(viewport()).toEqual(['800px', '600px', '']);
    const frame = shell.element.querySelector<HTMLElement>('.soundor-frame')!;
    expect(frame.classList.contains('soundor-letterbox')).toBe(true);
    expect([shell.viewport.style.left, shell.viewport.style.top]).toEqual([
      '100px',
      '0px',
    ]);
    expect(told.at(-1)).toEqual({
      editor: { width: 1000, height: 600 },
      safeArea: null,
    });
  });

  it('cover without its aspect ratio: any shape, the layout extended around the configured size', () => {
    const { told, drag, viewport } = geometry('demo', COVERING_FREELY);
    expect(told).toEqual([
      {
        editor: { width: 800, height: 600 },
        safeArea: { x: 0, y: 0, width: 800, height: 600 },
      },
    ]);
    // Wider only: no aspect ratio kept, the zoom stays 1, the layout widens.
    drag(100, 0);
    expect(viewport()).toEqual(['1000px', '600px', '']);
    expect(told.at(-1)).toEqual({
      editor: { width: 1000, height: 600 },
      safeArea: { x: 100, y: 0, width: 800, height: 600 },
    });
    // Taller still: zoomed by the smaller side (1.5), laid out at the
    // editor's size over it, the bands above and below.
    drag(100, 300);
    expect(viewport()).toEqual(['800px', '800px', 'scale(1.5)']);
    expect(told.at(-1)).toEqual({
      editor: { width: 1200, height: 1200 },
      safeArea: { x: 0, y: 100, width: 800, height: 600 },
    });
    // Its limits still hold.
    drag(-5000, -5000);
    expect(told.at(-1)!.editor).toEqual({ width: 400, height: 300 });
  });

  it("embedded: the page's size, its own owned by the page", () => {
    const resize = observeStage();
    const { told, shell } = geometry('embed', RESIZABLE);
    expect(shell.element.querySelector('.soundor-resize')).toBeNull();
    // Not shown yet: nothing known.
    expect(told).toEqual([{ editor: { width: 0, height: 0 }, safeArea: null }]);
    resize(shell, 1023.6, 500);
    expect(told.at(-1)).toEqual({
      editor: { width: 1024, height: 500 },
      safeArea: null,
    });
  });

  it('embedded, an editor that contains its layout: the page, bands included', () => {
    const resize = observeStage();
    const { told, shell, viewport } = geometry('embed', SCALING);
    resize(shell, 1200, 600);
    expect(viewport()).toEqual(['800px', '600px', '']);
    expect(told.at(-1)).toEqual({
      editor: { width: 1200, height: 600 },
      safeArea: null,
    });
  });

  it('embedded, an editor that covers the page: laid out over all of it', () => {
    const resize = observeStage();
    const { told, shell, viewport } = geometry('embed', COVERING);
    // Before the page is measured: its configured size, nothing known.
    expect(viewport()).toEqual(['800px', '600px', '']);
    expect(told[0]!.editor).toEqual({ width: 0, height: 0 });
    resize(shell, 1200, 600);
    expect(viewport()).toEqual(['1200px', '600px', '']);
    const frame = shell.element.querySelector<HTMLElement>('.soundor-frame')!;
    expect([frame.style.width, frame.style.height]).toEqual([
      '1200px',
      '600px',
    ]);
    expect(told.at(-1)).toEqual({
      editor: { width: 1200, height: 600 },
      safeArea: { x: 200, y: 0, width: 800, height: 600 },
    });
    // A tall page: zoomed by its width, the bands above and below.
    resize(shell, 400, 600);
    expect(viewport()).toEqual(['800px', '1200px', 'scale(0.5)']);
    expect(told.at(-1)).toEqual({
      editor: { width: 400, height: 600 },
      safeArea: { x: 0, y: 300, width: 800, height: 600 },
    });
  });
});

describe("the plugin's own size requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  function requested(editor: WebEditor, presentation: Presentation = 'demo') {
    const all: ViewGeometry[] = [];
    const context = setup(presentation, editor, (next) => all.push(next));
    const request = (width: number, height: number) => {
      let asked: { width: number; height: number } | null = null;
      act(() => {
        asked = context.shell.requestEditorSize({ width, height });
      });
      return asked;
    };
    return { ...context, all, request };
  }

  it('resize the viewport as its handle does, within the limits', () => {
    const { all, request, shell } = requested(RESIZABLE);
    expect(all.at(-1)).toMatchObject({ resizable: true, fit: 1 });
    expect(request(1000, 700)).toEqual({ width: 1000, height: 700 });
    expect(all.at(-1)?.editor).toEqual({ width: 1000, height: 700 });
    expect(shell.viewport.style.width).toBe('1000px');
    // Held to 480×320 – 1200×900, each side on its own: the answer says so
    // at once.
    expect(request(5000, -100)).toEqual({ width: 1200, height: 320 });
    expect(all.at(-1)?.editor).toEqual({ width: 1200, height: 320 });
    // The size it has: nothing new.
    const count = all.length;
    expect(request(1200, 320)).toEqual({ width: 1200, height: 320 });
    expect(all).toHaveLength(count);
  });

  it('keep the aspect ratio of an editor that scales, at the nearest size', () => {
    const { all, request, shell } = requested(SCALING);
    request(1200, 900);
    expect(all.at(-1)?.editor).toEqual({ width: 1200, height: 900 });
    expect(shell.viewport.style.transform).toBe('scale(1.5)');
    // Wider only: between the two sides' zooms, nearer the wider's.
    request(1200, 600);
    expect(all.at(-1)?.editor).toEqual({ width: 1056, height: 792 });
  });

  it('answer a size the same whatever the size is, so a drag never flips', () => {
    const { all, request } = requested(SCALING);
    // A corner dragged narrower and taller, each step from 800×600: it
    // shrinks steadily, never larger and smaller in turn.
    const widths: number[] = [];
    for (let step = 1; step <= 8; step += 1) {
      request(800 - step * 5, 600 + step * 4);
      widths.push(all.at(-1)!.editor.width);
    }
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    expect(new Set(widths).size).toBe(widths.length);
  });

  it("stop at the stage's room, as the handle does", () => {
    const resize = observeStage();
    const { all, request, shell } = requested(RESIZABLE);
    // 1000×600 of room (the stage's padding taken off).
    resize(shell, 1032, 692);
    request(1200, 900);
    expect(all.at(-1)?.editor).toEqual({ width: 1000, height: 600 });
  });

  it('are refused where the page owns the size, or no other is allowed', () => {
    const embedded = requested(RESIZABLE, 'embed');
    expect(embedded.all.at(-1)?.resizable).toBe(false);
    expect(embedded.request(1000, 700)).toBeNull();
    const fixed = requested(FIXED);
    expect(fixed.all.at(-1)?.resizable).toBe(false);
    expect(fixed.request(1000, 700)).toBeNull();
    expect(fixed.shell.viewport.style.width).toBe('800px');
  });

  it('tell the view how many CSS pixels an editor pixel is, scaled to fit', () => {
    const resize = observeStage();
    const { all, shell } = requested(RESIZABLE);
    resize(shell, 432, 392);
    expect(all.at(-1)?.fit).toBe(0.5);
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

describe('viewLayout', () => {
  const at = (width: number, height: number) => ({ width, height });

  it('lays a fixed editor out at whatever size it is given', () => {
    expect(viewLayout(FIXED, at(300, 200))).toEqual({
      zoom: 1,
      layout: at(300, 200),
      safeArea: null,
    });
  });

  it('holds a layout to its maximum, per axis, unless it covers', () => {
    const editor = { ...RESIZABLE, maxWidth: 1000, maxHeight: Infinity };
    expect(viewLayout(editor, at(900, 2000))).toEqual({
      zoom: 1,
      layout: at(900, 2000),
      safeArea: null,
    });
    expect(viewLayout(editor, at(1400, 700))).toEqual({
      zoom: 1,
      layout: at(1000, 700),
      safeArea: null,
    });
    expect(viewLayout({ ...editor, fit: 'cover' }, at(1400, 700))).toEqual({
      zoom: 1,
      layout: at(1400, 700),
      safeArea: { x: 200, y: 0, width: 1000, height: 700 },
    });
    // Within its limits, a covering layout is all safe.
    expect(viewLayout({ ...editor, fit: 'cover' }, at(900, 700))).toEqual({
      zoom: 1,
      layout: at(900, 700),
      safeArea: null,
    });
  });

  it('zooms a scaling layout by the smaller side, up to its maximum', () => {
    // SCALING: 800×600, at most 1600×1200.
    expect(viewLayout(SCALING, at(1200, 600)).zoom).toBe(1);
    expect(viewLayout(SCALING, at(4000, 3000))).toEqual({
      zoom: 2,
      layout: at(800, 600),
      safeArea: null,
    });
    expect(viewLayout(COVERING, at(4000, 3000))).toEqual({
      zoom: 2,
      layout: at(2000, 1500),
      safeArea: { x: 600, y: 450, width: 800, height: 600 },
    });
    // No maximum: no limit to the zoom.
    expect(
      viewLayout(
        { ...SCALING, maxWidth: Infinity, maxHeight: Infinity },
        at(4000, 3000),
      ).zoom,
    ).toBe(5);
  });
});

describe('readManifest', () => {
  it('reads an unbounded maximum (null in JSON) as Infinity', () => {
    const manifest = readManifest({
      plugin: { id: 'a.b', name: 'A' },
      editor: {
        ...RESIZABLE,
        maxWidth: null,
        maxHeight: 900,
      } as unknown as WebEditor,
      parameters: [],
      native: { types: [], methods: [] },
    });
    expect([manifest.editor.maxWidth, manifest.editor.maxHeight]).toEqual([
      Infinity,
      900,
    ]);
  });
});
