/**
 * The host page around the plugin: a toolbar that drives the transport and
 * the audio, the plugin's viewport, and a status bar. Plain DOM; the plugin
 * UI renders inside the viewport only. It controls the page's one WebHost
 * and WebAudioHost; there is no second transport here.
 *
 * Two presentations: `demo` (toolbar, plugin, status: for static builds and
 * docs) and `dev` (the same, with an inspector of the host state and the
 * parameters: what `soundor dev` shows).
 */

import type { AudioSource, AudioStatus, WebAudioHost } from './audio';
import type { HostSnapshot, WebHost } from './host';
import type { ParameterStore } from './parameters';

/** The plugin view's size in logical pixels, as the JUCE editor opens it. */
export const VIEW_SIZE = { width: 800, height: 600 } as const;

export type Presentation = 'demo' | 'dev';

export interface ShellOptions {
  readonly pluginName: string;
  readonly presentation: Presentation;
  readonly host: WebHost;
  readonly parameters: ParameterStore;
  readonly audio: WebAudioHost;
}

export interface HostShell {
  readonly element: HTMLElement;
  /** Where the plugin UI renders. */
  readonly viewport: HTMLElement;
  /** Shows a notice over the viewport (no UI, a UI that failed). */
  showMessage(title: string, detail?: string): void;
  remove(): void;
}

const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'];

const STYLE = `
body { margin: 0; background: #0e0f12; }
.soundor-host {
  display: flex; flex-direction: column; height: 100vh; margin: 0;
  background: #0e0f12; color: #c9ccd3;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.soundor-toolbar, .soundor-status {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px;
  background: #16171b; flex: none; flex-wrap: wrap;
}
.soundor-toolbar { border-bottom: 1px solid #24262c; }
.soundor-status { border-top: 1px solid #24262c; color: #8b8f98; font-size: 12px; gap: 12px; }
.soundor-title { font-weight: 600; color: #f2f3f5; margin-right: 8px; }
.soundor-spacer { flex: 1; }
.soundor-toolbar button, .soundor-toolbar select, .soundor-toolbar input {
  font: inherit; color: inherit; background: #24262c; border: 1px solid #33363e;
  border-radius: 6px; padding: 3px 8px; height: 28px; box-sizing: border-box;
}
.soundor-toolbar button { min-width: 32px; cursor: pointer; }
.soundor-toolbar button:hover { background: #2c2f36; }
.soundor-toolbar button[aria-pressed="true"] { background: #3a7bfd; border-color: #3a7bfd; color: #fff; }
.soundor-toolbar input[type="number"] { width: 64px; }
.soundor-toolbar input[type="range"] { width: 90px; padding: 0; background: none; border: 0; }
.soundor-position { font-variant-numeric: tabular-nums; min-width: 56px; color: #f2f3f5; }
.soundor-stage {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 12px; overflow: hidden; min-height: 0;
}
.soundor-frame { position: relative; flex: none; }
.soundor-viewport {
  position: absolute; left: 0; top: 0; overflow: hidden; background: #17181c;
  transform-origin: 0 0; box-shadow: 0 0 0 1px #24262c, 0 8px 32px rgb(0 0 0 / 0.4);
}
.soundor-message {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; padding: 24px;
  text-align: center; color: #8b8f98;
}
.soundor-message strong { color: #f2f3f5; font-size: 14px; }
.soundor-message pre {
  max-width: 100%; overflow: auto; margin: 0; text-align: left;
  white-space: pre-wrap; font-size: 12px; color: #ff8a80;
}
.soundor-audio-error { color: #ff8a80; }
.soundor-inspector {
  flex: none; max-height: 40vh; overflow: auto; border-top: 1px solid #24262c;
  background: #121317; font-size: 12px;
}
.soundor-inspector summary { padding: 6px 12px; cursor: pointer; color: #8b8f98; }
.soundor-inspector .soundor-panels { display: flex; gap: 24px; padding: 0 12px 12px; flex-wrap: wrap; }
.soundor-inspector pre { margin: 0; font-size: 12px; color: #c9ccd3; }
.soundor-inspector table { border-collapse: collapse; }
.soundor-inspector td, .soundor-inspector th { padding: 2px 12px 2px 0; text-align: left; }
.soundor-inspector th { color: #8b8f98; font-weight: normal; }
`;

/** Renders the host page into `container` and connects its controls. */
export function createShell(
  container: HTMLElement,
  options: ShellOptions,
): HostShell {
  const document = container.ownerDocument;
  const controller = new AbortController();
  const { signal } = controller;
  const unsubscribes: (() => void)[] = [];
  const h = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
    ...children: (Node | string)[]
  ): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag);
    Object.assign(element, props);
    element.append(...children);
    return element;
  };

  const style = h('style', { textContent: STYLE });
  document.head.append(style);
  const { host, audio, parameters } = options;

  // ── Toolbar ────────────────────────────────────────────────────────────────

  const play = h('button', { type: 'button', title: 'Play', textContent: '▶' });
  play.dataset['control'] = 'play';
  const stop = h('button', { type: 'button', title: 'Stop', textContent: '■' });
  stop.dataset['control'] = 'stop';
  const loop = h('button', { type: 'button', title: 'Loop', textContent: '↻' });
  loop.dataset['control'] = 'loop';
  const position = h('span', { className: 'soundor-position' });
  const bpm = h('input', {
    type: 'number',
    min: '20',
    max: '999',
    step: '1',
    title: 'Tempo (BPM)',
  });
  bpm.dataset['control'] = 'bpm';
  const signature = h(
    'select',
    { title: 'Time signature' },
    ...TIME_SIGNATURES.map((value) =>
      h('option', { value, textContent: value }),
    ),
  );
  signature.dataset['control'] = 'signature';
  const source = h(
    'select',
    { title: 'Audio source' },
    h('option', { value: 'oscillator', textContent: 'Oscillator' }),
    h('option', { value: 'file', textContent: 'Audio file…' }),
    h('option', { value: 'none', textContent: 'No input' }),
  );
  source.dataset['control'] = 'source';
  const file = h('input', { type: 'file', accept: 'audio/*', hidden: true });
  const volume = h('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    title: 'Output volume',
  });
  volume.dataset['control'] = 'volume';
  const mute = h('button', {
    type: 'button',
    title: 'Mute',
    textContent: '🔊',
  });
  mute.dataset['control'] = 'mute';

  const toolbar = h(
    'header',
    { className: 'soundor-toolbar' },
    h('span', { className: 'soundor-title', textContent: options.pluginName }),
    play,
    stop,
    loop,
    position,
    bpm,
    h('span', { textContent: 'BPM' }),
    signature,
    h('span', { className: 'soundor-spacer' }),
    source,
    file,
    volume,
    mute,
  );

  /** Starts audio from the gesture that is running now; playing goes on without it. */
  const startAudio = (): void => {
    void audio.start();
  };

  play.addEventListener(
    'click',
    () => {
      if (host.snapshot().transport?.playing) {
        host.pause();
        return;
      }
      startAudio();
      host.play();
    },
    { signal },
  );
  stop.addEventListener('click', () => host.stop(), { signal });
  loop.addEventListener(
    'click',
    () => host.setLooping(!host.snapshot().transport?.looping),
    { signal },
  );
  bpm.addEventListener(
    'change',
    () => {
      const value = Number(bpm.value);
      if (Number.isFinite(value) && bpm.value !== '') host.setBpm(value);
      render(host.snapshot());
    },
    { signal },
  );
  signature.addEventListener(
    'change',
    () => {
      const [numerator, denominator] = signature.value.split('/').map(Number);
      host.setTimeSignature(numerator!, denominator!);
    },
    { signal },
  );
  source.addEventListener(
    'change',
    () => {
      startAudio();
      if (source.value === 'file') file.click();
      else
        void audio.setSource(source.value as AudioSource).catch(showAudioError);
    },
    { signal },
  );
  file.addEventListener(
    'change',
    () => {
      const chosen = file.files?.[0];
      if (chosen === undefined) {
        source.value = audio.status.source;
        return;
      }
      void audio
        .start()
        .then(() => audio.setSource('file', chosen))
        .catch(showAudioError);
    },
    { signal },
  );
  volume.addEventListener(
    'input',
    () => audio.setVolume(Number(volume.value)),
    {
      signal,
    },
  );
  mute.addEventListener('click', () => audio.setMuted(!audio.status.muted), {
    signal,
  });

  // ── Stage ──────────────────────────────────────────────────────────────────

  const viewport = h('div', { className: 'soundor-viewport' });
  viewport.style.width = `${VIEW_SIZE.width}px`;
  viewport.style.height = `${VIEW_SIZE.height}px`;
  const frame = h('div', { className: 'soundor-frame' }, viewport);
  const stage = h('main', { className: 'soundor-stage' }, frame);

  // The plugin keeps its size; a stage too small for it (an iframe in docs)
  // shows it scaled down to fit.
  const fit = (): void => {
    const width = stage.clientWidth - 24;
    const height = stage.clientHeight - 24;
    const scale =
      width > 0 && height > 0
        ? Math.min(1, width / VIEW_SIZE.width, height / VIEW_SIZE.height)
        : 1;
    frame.style.width = `${VIEW_SIZE.width * scale}px`;
    frame.style.height = `${VIEW_SIZE.height * scale}px`;
    viewport.style.transform = scale === 1 ? '' : `scale(${scale})`;
  };
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    unsubscribes.push(() => observer.disconnect());
  }
  fit();

  // ── Status ─────────────────────────────────────────────────────────────────

  const format = h('span');
  const audioState = h('span');
  const audioError = h('span', { className: 'soundor-audio-error' });
  const status = h(
    'footer',
    { className: 'soundor-status' },
    h('span', { textContent: 'Soundor Web' }),
    format,
    audioState,
    audioError,
  );
  const showAudioError = (error: unknown): void => {
    audioError.textContent =
      error instanceof Error ? error.message : String(error);
  };

  const element = h(
    'div',
    { className: 'soundor-host' },
    toolbar,
    stage,
    status,
  );
  element.dataset['presentation'] = options.presentation;

  // ── Inspector (dev) ────────────────────────────────────────────────────────

  let inspect: ((snapshot: HostSnapshot) => void) | undefined;
  if (options.presentation === 'dev') {
    const snapshotView = h('pre');
    const rows = parameters.list.map((parameter) => {
      const value = h('td');
      const show = (current: unknown): void => {
        value.textContent = String(
          typeof current === 'number'
            ? Math.round(current * 1000) / 1000
            : current,
        );
      };
      show(parameter.get());
      unsubscribes.push(parameter.subscribe(show));
      return h(
        'tr',
        {},
        h('td', { textContent: parameter.id }),
        value,
        h('td', { textContent: parameter.info.type }),
      );
    });
    const table = h(
      'table',
      {},
      h(
        'tr',
        {},
        h('th', { textContent: 'Parameter' }),
        h('th', { textContent: 'Value' }),
        h('th', { textContent: 'Type' }),
      ),
      ...rows,
    );
    const inspector = h(
      'details',
      { className: 'soundor-inspector', open: true },
      h('summary', { textContent: 'Inspector' }),
      h(
        'div',
        { className: 'soundor-panels' },
        h('div', {}, h('strong', { textContent: 'Host' }), snapshotView),
        h('div', {}, h('strong', { textContent: 'Parameters' }), table),
      ),
    );
    element.append(inspector);
    inspect = (snapshot) => {
      snapshotView.textContent = JSON.stringify(snapshot, round, 2);
    };
  }

  // ── State → controls ───────────────────────────────────────────────────────

  const render = (snapshot: HostSnapshot): void => {
    const transport = snapshot.transport;
    if (transport !== null) {
      play.textContent = transport.playing ? '❚❚' : '▶';
      play.title = transport.playing ? 'Pause' : 'Play';
      play.setAttribute('aria-pressed', String(transport.playing));
      loop.setAttribute('aria-pressed', String(transport.looping));
      if (document.activeElement !== bpm)
        bpm.value = String(Math.round(transport.bpm));
      const { numerator, denominator } = transport.timeSignature;
      signature.value = `${numerator}/${denominator}`;
      position.textContent = barBeat(transport);
    }
    format.textContent = `${snapshot.sampleRate / 1000} kHz · ${snapshot.blockSize} samples`;
    inspect?.(snapshot);
  };
  const renderAudio = (state: AudioStatus): void => {
    source.value = state.source;
    volume.value = String(state.volume);
    mute.textContent = state.muted ? '🔇' : '🔊';
    mute.setAttribute('aria-pressed', String(state.muted));
    audioState.textContent =
      state.state === 'running'
        ? `Audio on${state.fileName !== null && state.source === 'file' ? ` · ${state.fileName}` : ''}`
        : state.state === 'starting'
          ? 'Starting audio…'
          : state.state === 'failed'
            ? 'Audio failed'
            : 'Audio off: press ▶ to start';
    audioError.textContent = state.error ?? '';
  };
  unsubscribes.push(host.subscribe(render), audio.subscribe(renderAudio));
  render(host.snapshot());
  renderAudio(audio.status);

  container.append(element);
  return {
    element,
    viewport,
    showMessage(title, detail) {
      const message = h(
        'div',
        { className: 'soundor-message' },
        h('strong', { textContent: title }),
      );
      if (detail !== undefined)
        message.append(h('pre', { textContent: detail }));
      viewport.append(message);
    },
    remove() {
      controller.abort();
      for (const unsubscribe of unsubscribes) unsubscribe();
      element.remove();
      style.remove();
    },
  };
}

/** The position as bar.beat (1-based), in the time signature's beats. */
function barBeat(transport: NonNullable<HostSnapshot['transport']>): string {
  const { numerator, denominator } = transport.timeSignature;
  const beatLength = 4 / denominator;
  const barLength = numerator * beatLength;
  const bar = Math.floor(transport.barStartPpq / barLength) + 1;
  const beat =
    Math.floor((transport.ppqPosition - transport.barStartPpq) / beatLength) +
    1;
  return `${bar}.${beat}`;
}

function round(_key: string, value: unknown): unknown {
  return typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
}
