// @vitest-environment happy-dom
import {
  configure,
  fireEvent,
  getByRole,
  queryByRole,
  within,
} from '@testing-library/dom';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createShell, type Presentation } from '.';
import { WebAudioHost } from '../audio';
import { WebHost } from '../host';
import { createParameterStore } from '../parameters';

beforeAll(() => {
  // Events apply Preact's updates before the test looks.
  configure({
    eventWrapper: (callback) => {
      let result: unknown;
      act(() => {
        result = callback();
      });
      return result;
    },
  });
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  localStorage.clear();
});

function setup(presentation: Presentation = 'demo') {
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
    host,
    parameters,
    audio,
  });
  const dock = within(getByRole(shell.element, 'toolbar', { name: 'Host' }));
  // The panel is hidden until opened: queries look into it regardless.
  const panel = within(
    shell.element.querySelector<HTMLElement>('#soundor-panel')!,
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

  it('starts audio, then mutes it, and sets the volume', () => {
    const { audio, start, dock } = setup();
    fireEvent.click(dock.getByRole('button', { name: 'Start audio' }));
    expect(start).toHaveBeenCalledOnce();
    expect(audio.status.muted).toBe(false);

    // Running, as if the browser had allowed it.
    const real = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(audio),
      'status',
    )!.get!;
    vi.spyOn(audio, 'status', 'get').mockImplementation(function (
      this: typeof audio,
    ) {
      return { ...real.call(this), state: 'running' };
    });
    act(() => audio.setVolume(0.8));
    fireEvent.click(dock.getByRole('button', { name: 'Mute' }));
    expect(start).toHaveBeenCalledOnce();
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

describe('notices', () => {
  it('shows a message over the viewport', () => {
    const { shell } = setup();
    shell.showMessage('The plugin UI failed', 'Error: boom');
    expect(shell.viewport.textContent).toBe('The plugin UI failedError: boom');
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
