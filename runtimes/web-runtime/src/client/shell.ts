/**
 * The host page around the plugin. The plugin is the page: its viewport
 * fills the stage (scaled down when the stage is smaller, as in a docs
 * iframe), and the host stays out of its way:
 *
 * - a dock floating under the plugin: audio on/off and volume, play/stop
 *   and the position, and the button that opens the panel;
 * - a side panel, closed by default: the transport's tempo, loop and time
 *   signature, the audio source and format, and the parameters.
 *
 * Plain DOM; the plugin UI renders inside the viewport only. It controls the
 * page's one WebHost and WebAudioHost; there is no second transport here.
 *
 * Two presentations: `demo` (for static builds and docs) and `dev` (what
 * `soundor dev` shows: the panel also inspects the host state, and remembers
 * whether it was open).
 */

import type { AudioSource, AudioStatus, WebAudioHost } from './audio';
import type { HostSnapshot, WebHost } from './host';
import type { ParameterStore, WebParameter } from './parameters';

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

/** Where `dev` remembers whether the panel was open. */
const PANEL_KEY = 'soundor:web-host:panel';

const ICONS = {
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
  stop: '<path d="M6.5 6.5h11v11h-11z"/>',
  loop: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/>',
  speaker:
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  muted:
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/>',
  panel:
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="2"/>',
  close:
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/>',
} as const;

const STYLE = `
body { margin: 0; background: var(--sd-bg); }
.soundor-host {
  --sd-bg: #0b0c0f; --sd-surface: #15161a; --sd-raised: #1d1f24;
  --sd-line: #2a2c33; --sd-text: #e6e7ea; --sd-muted: #8b8f98;
  --sd-accent: #3a7bfd; --sd-ok: #34c77b; --sd-warn: #f2b13a; --sd-bad: #ff6b5e;
  position: relative; display: flex; height: 100vh; overflow: hidden;
  background: var(--sd-bg); color: var(--sd-text);
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: dark;
}
.soundor-host button, .soundor-host select, .soundor-host input { font: inherit; color: inherit; }
.soundor-host svg { width: 18px; height: 18px; fill: currentColor; flex: none; }

/* Stage: the plugin, centred, with room under it for the dock. */
.soundor-stage {
  position: relative; flex: 1; min-width: 0; display: flex;
  align-items: center; justify-content: center;
  padding: 16px 16px 76px; box-sizing: border-box;
  background-image: radial-gradient(circle, #ffffff0d 1px, transparent 1px);
  background-size: 20px 20px;
}
.soundor-frame { position: relative; flex: none; }
.soundor-viewport {
  position: absolute; left: 0; top: 0; overflow: hidden; background: #17181c;
  transform-origin: 0 0; border-radius: 6px;
  box-shadow: 0 0 0 1px var(--sd-line), 0 20px 60px rgb(0 0 0 / 0.5);
}
.soundor-message {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; padding: 24px;
  text-align: center; color: var(--sd-muted);
}
.soundor-message strong { color: var(--sd-text); font-size: 14px; }
.soundor-message pre {
  max-width: 100%; overflow: auto; margin: 0; text-align: left;
  white-space: pre-wrap; font-size: 12px; color: var(--sd-bad);
}

/* Dock: floats under the plugin. */
.soundor-dock {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 4px; padding: 4px;
  max-width: calc(100% - 32px); box-sizing: border-box;
  background: rgb(29 31 36 / 0.88); backdrop-filter: blur(12px);
  border: 1px solid var(--sd-line); border-radius: 12px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.4); white-space: nowrap;
}
.soundor-divider { width: 1px; height: 20px; background: var(--sd-line); margin: 0 4px; flex: none; }
.soundor-icon {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 32px; min-width: 32px; padding: 0 7px; box-sizing: border-box;
  border: 0; border-radius: 8px; background: transparent; cursor: pointer;
}
.soundor-icon:hover { background: #ffffff14; }
.soundor-icon:focus-visible { outline: 2px solid var(--sd-accent); outline-offset: 1px; }
.soundor-icon[aria-pressed="true"] { background: #3a7bfd33; color: #8fb3ff; }
.soundor-audio { position: relative; }
.soundor-audio[data-state="off"] { background: var(--sd-accent); color: #fff; padding: 0 12px 0 9px; }
.soundor-audio[data-state="off"]:hover { background: #4f8bff; }
.soundor-audio[data-state="starting"] .soundor-audio-label,
.soundor-audio[data-state="failed"] .soundor-audio-label { color: var(--sd-muted); }
.soundor-audio[data-state="failed"] { color: var(--sd-bad); }
.soundor-audio-label:empty { display: none; }
.soundor-volume { width: 84px; accent-color: var(--sd-accent); margin: 0 6px 0 2px; }
.soundor-position {
  font-variant-numeric: tabular-nums; min-width: 40px; padding: 0 6px;
  color: var(--sd-muted); text-align: center;
}
.soundor-host[data-playing="true"] .soundor-position { color: var(--sd-text); }
@media (max-width: 480px) { .soundor-volume { display: none; } }

/* Panel: host settings, closed by default. */
.soundor-panel {
  flex: none; width: 300px; display: flex; flex-direction: column;
  background: var(--sd-surface); border-left: 1px solid var(--sd-line);
  overflow: hidden;
}
.soundor-panel[hidden] { display: none; }
@media (max-width: 720px) {
  .soundor-panel {
    position: absolute; inset: 0 0 0 auto; width: min(300px, 100%); z-index: 1;
    box-shadow: -12px 0 32px rgb(0 0 0 / 0.5);
  }
}
.soundor-panel-header {
  display: flex; align-items: center; gap: 8px; padding: 10px 8px 10px 16px;
  border-bottom: 1px solid var(--sd-line); flex: none;
}
.soundor-heading { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.soundor-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.soundor-subtitle { font-size: 11px; color: var(--sd-muted); }
.soundor-panel-body { overflow: auto; flex: 1; }
.soundor-section { padding: 14px 16px; border-bottom: 1px solid var(--sd-line); }
.soundor-section h2 {
  margin: 0 0 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--sd-muted);
}
.soundor-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.soundor-row + .soundor-row { margin-top: 6px; }
.soundor-row > label, .soundor-row > .soundor-label { flex: 1; min-width: 0; color: var(--sd-muted); }
.soundor-field {
  height: 28px; box-sizing: border-box; padding: 0 8px; min-width: 0;
  background: var(--sd-raised); border: 1px solid var(--sd-line); border-radius: 6px;
}
.soundor-field:focus-visible { outline: 2px solid var(--sd-accent); outline-offset: -1px; }
select.soundor-field { width: 132px; }
input.soundor-field[type="number"] { width: 72px; }
.soundor-status { color: var(--sd-muted); font-size: 12px; margin-top: 8px; }
.soundor-status > span { display: block; }
.soundor-audio-error { color: var(--sd-bad); }
.soundor-audio-error:empty { display: none; }
.soundor-param { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; }
.soundor-param + .soundor-param { margin-top: 10px; }
.soundor-param label { color: var(--sd-text); }
.soundor-param output { color: var(--sd-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.soundor-param input[type="range"] { grid-column: 1 / -1; width: 100%; margin: 0; accent-color: var(--sd-accent); }
.soundor-param select { grid-column: 1 / -1; width: 100%; }
.soundor-empty { color: var(--sd-muted); }
.soundor-inspector summary { cursor: pointer; color: var(--sd-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.soundor-inspector pre {
  margin: 10px 0 0; font: 11px/1.5 ui-monospace, 'SF Mono', Menlo, monospace;
  color: var(--sd-text); white-space: pre-wrap;
}
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
  const icon = (name: keyof typeof ICONS): SVGSVGElement => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name];
    return svg;
  };
  const iconButton = (
    control: string,
    title: string,
    name: keyof typeof ICONS,
  ): HTMLButtonElement => {
    const button = h('button', {
      type: 'button',
      className: 'soundor-icon',
      title,
    });
    button.setAttribute('aria-label', title);
    button.dataset['control'] = control;
    button.append(icon(name));
    return button;
  };
  const setIcon = (button: HTMLElement, name: keyof typeof ICONS): void => {
    button.querySelector('svg')?.replaceWith(icon(name));
  };
  const section = (title: string, ...children: Node[]): HTMLElement =>
    h(
      'section',
      { className: 'soundor-section' },
      h('h2', { textContent: title }),
      ...children,
    );
  const row = (label: string, control: HTMLElement): HTMLElement => {
    control.id ||= `soundor-${control.dataset['control'] ?? label}`;
    return h(
      'div',
      { className: 'soundor-row' },
      h('label', { htmlFor: control.id, textContent: label }),
      control,
    );
  };

  const style = h('style', { textContent: STYLE });
  document.head.append(style);
  const { host, audio, parameters } = options;

  // ── Dock ───────────────────────────────────────────────────────────────────

  const audioLabel = h('span', { className: 'soundor-audio-label' });
  const audioButton = iconButton('mute', 'Turn audio on', 'speaker');
  audioButton.classList.add('soundor-audio');
  audioButton.append(audioLabel);
  const volume = h('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    title: 'Output volume',
    className: 'soundor-volume',
  });
  volume.setAttribute('aria-label', 'Output volume');
  volume.dataset['control'] = 'volume';
  const play = iconButton('play', 'Play', 'play');
  const stop = iconButton('stop', 'Stop', 'stop');
  const position = h('span', {
    className: 'soundor-position',
    title: 'Position (bar.beat)',
  });
  const panelToggle = iconButton('panel', 'Host settings', 'panel');
  panelToggle.setAttribute('aria-expanded', 'false');

  const dock = h(
    'div',
    { className: 'soundor-dock' },
    audioButton,
    volume,
    h('span', { className: 'soundor-divider' }),
    play,
    stop,
    position,
    h('span', { className: 'soundor-divider' }),
    panelToggle,
  );
  dock.setAttribute('role', 'toolbar');
  dock.setAttribute('aria-label', 'Host');

  /** Starts audio from the gesture that is running now; playing goes on without it. */
  const startAudio = (): void => {
    void audio.start();
  };

  audioButton.addEventListener(
    'click',
    () => {
      const { state, muted } = audio.status;
      if (state === 'running') audio.setMuted(!muted);
      else startAudio();
    },
    { signal },
  );
  volume.addEventListener(
    'input',
    () => audio.setVolume(Number(volume.value)),
    { signal },
  );
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

  // ── Stage ──────────────────────────────────────────────────────────────────

  const viewport = h('div', { className: 'soundor-viewport' });
  viewport.style.width = `${VIEW_SIZE.width}px`;
  viewport.style.height = `${VIEW_SIZE.height}px`;
  const frame = h('div', { className: 'soundor-frame' }, viewport);
  const stage = h('main', { className: 'soundor-stage' }, frame, dock);

  // The plugin keeps its size; a stage too small for it (an iframe in docs,
  // the panel open) shows it scaled down to fit.
  const fit = (): void => {
    const styles = getComputedStyle(stage);
    const width =
      stage.clientWidth -
      parseFloat(styles.paddingLeft) -
      parseFloat(styles.paddingRight);
    const height =
      stage.clientHeight -
      parseFloat(styles.paddingTop) -
      parseFloat(styles.paddingBottom);
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

  // ── Panel ──────────────────────────────────────────────────────────────────

  const loop = iconButton('loop', 'Loop', 'loop');
  const bpm = h('input', {
    type: 'number',
    min: '20',
    max: '999',
    step: '1',
    className: 'soundor-field',
  });
  bpm.dataset['control'] = 'bpm';
  const signature = h(
    'select',
    { className: 'soundor-field' },
    ...TIME_SIGNATURES.map((value) =>
      h('option', { value, textContent: value }),
    ),
  );
  signature.dataset['control'] = 'signature';
  const source = h(
    'select',
    { className: 'soundor-field' },
    h('option', { value: 'oscillator', textContent: 'Oscillator' }),
    h('option', { value: 'file', textContent: 'Audio file…' }),
    h('option', { value: 'none', textContent: 'No input' }),
  );
  source.dataset['control'] = 'source';
  const file = h('input', { type: 'file', accept: 'audio/*', hidden: true });

  const format = h('span');
  const audioState = h('span');
  const audioError = h('span', { className: 'soundor-audio-error' });
  const status = h(
    'div',
    { className: 'soundor-status' },
    format,
    audioState,
    audioError,
  );
  const showAudioError = (error: unknown): void => {
    audioError.textContent =
      error instanceof Error ? error.message : String(error);
  };

  const closePanel = iconButton('close-panel', 'Close', 'close');
  const panelBody = h(
    'div',
    { className: 'soundor-panel-body' },
    section(
      'Transport',
      row('Tempo (BPM)', bpm),
      row('Time signature', signature),
      h(
        'div',
        { className: 'soundor-row' },
        h('span', { className: 'soundor-label', textContent: 'Loop' }),
        loop,
      ),
    ),
    section('Audio', row('Input', source), file, status),
    section(
      'Parameters',
      ...(parameters.list.length === 0
        ? [
            h('div', {
              className: 'soundor-empty',
              textContent: 'None declared',
            }),
          ]
        : parameters.list.map((parameter) =>
            parameterControl(parameter, h, signal, unsubscribes),
          )),
    ),
  );
  const panel = h(
    'aside',
    { className: 'soundor-panel', hidden: true },
    h(
      'div',
      { className: 'soundor-panel-header' },
      h(
        'div',
        { className: 'soundor-heading' },
        h('span', {
          className: 'soundor-title',
          textContent: options.pluginName,
        }),
        h('span', {
          className: 'soundor-subtitle',
          textContent: 'Soundor Web host',
        }),
      ),
      closePanel,
    ),
    panelBody,
  );
  panel.id = 'soundor-panel';
  panel.setAttribute('aria-label', 'Host settings');
  panelToggle.setAttribute('aria-controls', panel.id);

  const remember = options.presentation === 'dev';
  let panelOpen = false;
  const setPanelOpen = (open: boolean): void => {
    panelOpen = open;
    panel.hidden = !open;
    panelToggle.setAttribute('aria-pressed', String(open));
    panelToggle.setAttribute('aria-expanded', String(open));
    if (remember) {
      try {
        localStorage.setItem(PANEL_KEY, open ? 'open' : 'closed');
      } catch {
        // Storage may be unavailable; the panel just starts closed.
      }
    }
    fit();
  };
  panelToggle.addEventListener('click', () => setPanelOpen(!panelOpen), {
    signal,
  });
  closePanel.addEventListener(
    'click',
    () => {
      setPanelOpen(false);
      panelToggle.focus();
    },
    { signal },
  );
  panel.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') closePanel.click();
    },
    { signal },
  );

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

  const element = h('div', { className: 'soundor-host' }, stage, panel);
  element.dataset['presentation'] = options.presentation;

  // ── Inspector (dev) ────────────────────────────────────────────────────────

  let inspect: ((snapshot: HostSnapshot) => void) | undefined;
  if (options.presentation === 'dev') {
    const snapshotView = h('pre');
    const inspector = h(
      'details',
      { className: 'soundor-section soundor-inspector' },
      h('summary', { textContent: 'Host state' }),
      snapshotView,
    );
    panelBody.append(inspector);
    inspect = (snapshot) => {
      snapshotView.textContent = JSON.stringify(snapshot, round, 2);
    };
  }

  // ── State → controls ───────────────────────────────────────────────────────

  const render = (snapshot: HostSnapshot): void => {
    const transport = snapshot.transport;
    if (transport !== null) {
      const playing = transport.playing;
      if (play.title !== (playing ? 'Pause' : 'Play')) {
        setIcon(play, playing ? 'pause' : 'play');
        play.title = playing ? 'Pause' : 'Play';
        play.setAttribute('aria-label', play.title);
      }
      play.setAttribute('aria-pressed', String(playing));
      element.dataset['playing'] = String(playing);
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
    audioButton.dataset['state'] = state.state;
    const silent = state.state === 'running' && state.muted;
    setIcon(audioButton, silent ? 'muted' : 'speaker');
    audioButton.setAttribute('aria-pressed', String(state.muted));
    audioButton.title =
      state.state === 'running'
        ? state.muted
          ? 'Unmute'
          : 'Mute'
        : state.state === 'failed'
          ? `Audio failed${state.error === null ? '' : `: ${state.error}`}`
          : 'Turn audio on';
    audioButton.setAttribute('aria-label', audioButton.title);
    audioLabel.textContent =
      state.state === 'off'
        ? 'Start audio'
        : state.state === 'starting'
          ? 'Starting…'
          : state.state === 'failed'
            ? 'Retry'
            : '';
    audioState.textContent =
      state.state === 'running'
        ? `Audio on${state.fileName !== null && state.source === 'file' ? ` · ${state.fileName}` : ''}`
        : state.state === 'starting'
          ? 'Starting audio…'
          : state.state === 'failed'
            ? 'Audio failed'
            : 'Audio off';
    audioError.textContent = state.error ?? '';
  };
  unsubscribes.push(host.subscribe(render), audio.subscribe(renderAudio));
  render(host.snapshot());
  renderAudio(audio.status);

  container.append(element);
  let open = false;
  if (remember) {
    try {
      open = localStorage.getItem(PANEL_KEY) === 'open';
    } catch {
      // Storage may be unavailable; start closed.
    }
  }
  setPanelOpen(open);
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

type Create = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]> & { className?: string },
  ...children: (Node | string)[]
) => HTMLElementTagNameMap[K];

/**
 * One parameter's control in the panel, kept in step with its value: a
 * slider for numbers (a gesture while dragging), a checkbox, or a menu.
 */
function parameterControl(
  parameter: WebParameter,
  h: Create,
  signal: AbortSignal,
  unsubscribes: (() => void)[],
): HTMLElement {
  const info = parameter.info;
  const id = `soundor-parameter-${info.id}`;
  const label = h('label', { htmlFor: id, textContent: info.label });
  const container = h('div', { className: 'soundor-param' }, label);
  container.dataset['parameter'] = info.id;

  switch (info.type) {
    case 'float':
    case 'int': {
      const output = h('output');
      output.setAttribute('for', id);
      const input = h('input', {
        id,
        type: 'range',
        min: String(info.min),
        max: String(info.max),
        step: info.type === 'int' ? '1' : String((info.max - info.min) / 1000),
      });
      const show = (value: unknown): void => {
        const number = value as number;
        input.value = String(number);
        output.textContent = `${formatNumber(number)}${info.unit === undefined ? '' : ` ${info.unit}`}`;
      };
      input.addEventListener(
        'input',
        () => parameter.set(Number(input.value)),
        { signal },
      );
      input.addEventListener('pointerdown', () => parameter.beginGesture(), {
        signal,
      });
      input.addEventListener('pointerup', () => parameter.endGesture(), {
        signal,
      });
      input.addEventListener(
        'lostpointercapture',
        () => parameter.endGesture(),
        {
          signal,
        },
      );
      show(parameter.get());
      unsubscribes.push(parameter.subscribe(show));
      container.append(output, input);
      break;
    }
    case 'bool': {
      const input = h('input', { id, type: 'checkbox' });
      const show = (value: unknown): void => {
        input.checked = value as boolean;
      };
      input.addEventListener('change', () => parameter.set(input.checked), {
        signal,
      });
      show(parameter.get());
      unsubscribes.push(parameter.subscribe(show));
      container.append(input);
      break;
    }
    case 'enum': {
      const select = h(
        'select',
        { id, className: 'soundor-field' },
        ...info.values.map((value) =>
          h('option', { value, textContent: value }),
        ),
      );
      const show = (value: unknown): void => {
        select.value = value as string;
      };
      select.addEventListener('change', () => parameter.set(select.value), {
        signal,
      });
      show(parameter.get());
      unsubscribes.push(parameter.subscribe(show));
      container.append(select);
      break;
    }
  }
  return container;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
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
