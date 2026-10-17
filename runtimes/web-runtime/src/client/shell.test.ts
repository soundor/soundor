// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebAudioHost } from './audio';
import { WebHost } from './host';
import { createParameterStore } from './parameters';
import { createShell, type Presentation } from './shell';

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

function setup(presentation: Presentation = 'demo') {
  let frame: (() => void) | undefined;
  const host = new WebHost({
    now: () => 0,
    frames: {
      request: (callback) => {
        frame = callback;
        return 1;
      },
      cancel: () => {
        frame = undefined;
      },
    },
  });
  const audio = new WebAudioHost(host);
  const start = vi.spyOn(audio, 'start').mockResolvedValue();
  const parameters = createParameterStore([
    { id: 'gain', label: 'Gain', type: 'float', min: 0, max: 1, default: 0.5 },
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
  const control = <T extends HTMLElement>(name: string): T =>
    shell.element.querySelector(`[data-control="${name}"]`) as T;
  return {
    host,
    audio,
    start,
    parameters,
    shell,
    control,
    frame: () => frame?.(),
  };
}

describe('the host UI', () => {
  it('plays, pauses and stops the one transport, starting audio from the click', () => {
    const { host, start, control } = setup();
    const play = control<HTMLButtonElement>('play');
    play.click();
    expect(start).toHaveBeenCalledOnce();
    expect(host.snapshot().transport?.playing).toBe(true);
    expect(play.getAttribute('aria-pressed')).toBe('true');
    play.click();
    expect(host.snapshot().transport?.playing).toBe(false);
    play.click();
    control<HTMLButtonElement>('stop').click();
    expect(host.snapshot().transport).toMatchObject({
      playing: false,
      ppqPosition: 0,
    });
  });

  it('sets loop, tempo and time signature on the host', () => {
    const { host, control } = setup();
    control<HTMLButtonElement>('loop').click();
    expect(host.snapshot().transport?.looping).toBe(true);
    expect(control('loop').getAttribute('aria-pressed')).toBe('true');

    const bpm = control<HTMLInputElement>('bpm');
    expect(bpm.value).toBe('120');
    bpm.value = '90';
    bpm.dispatchEvent(new Event('change'));
    expect(host.snapshot().transport?.bpm).toBe(90);

    const signature = control<HTMLSelectElement>('signature');
    expect(signature.value).toBe('4/4');
    signature.value = '6/8';
    signature.dispatchEvent(new Event('change'));
    expect(host.snapshot().transport?.timeSignature).toEqual({
      numerator: 6,
      denominator: 8,
    });
  });

  it('follows changes made elsewhere', () => {
    const { host, control } = setup();
    host.setBpm(140);
    host.setLooping(true);
    expect(control<HTMLInputElement>('bpm').value).toBe('140');
    expect(control('loop').getAttribute('aria-pressed')).toBe('true');
  });

  it('starts audio from the dock, then mutes and sets the volume', () => {
    const { audio, start, control } = setup();
    const button = control<HTMLButtonElement>('mute');
    expect(button.dataset['state']).toBe('off');
    expect(button.textContent).toBe('Start audio');
    button.click();
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
    button.click();
    expect(start).toHaveBeenCalledOnce();
    expect(audio.status.muted).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    const volume = control<HTMLInputElement>('volume');
    volume.value = '0.3';
    volume.dispatchEvent(new Event('input'));
    expect(audio.status.volume).toBe(0.3);
  });

  it('shows the sample rate and block size', () => {
    const { host, shell } = setup();
    host.setAudioFormat({ sampleRate: 44100, blockSize: 128 });
    expect(
      shell.element.querySelector('.soundor-status')?.textContent,
    ).toContain('44.1 kHz · 128 samples');
  });

  it('shows the plugin viewport at the JUCE editor size', () => {
    const { shell } = setup();
    expect(shell.viewport.style.width).toBe('800px');
    expect(shell.viewport.style.height).toBe('600px');
  });
});

describe('the panel', () => {
  it('starts closed and opens from the dock', () => {
    const { shell, control } = setup();
    const panel = shell.element.querySelector<HTMLElement>('.soundor-panel')!;
    expect(panel.hidden).toBe(true);
    control<HTMLButtonElement>('panel').click();
    expect(panel.hidden).toBe(false);
    expect(control('panel').getAttribute('aria-expanded')).toBe('true');
    control<HTMLButtonElement>('close-panel').click();
    expect(panel.hidden).toBe(true);
  });

  it('controls the parameters and follows changes made elsewhere', () => {
    const { shell, parameters } = setup();
    const gain = shell.element.querySelector<HTMLInputElement>(
      '#soundor-parameter-gain',
    )!;
    expect(gain.value).toBe('0.5');
    gain.value = '0.2';
    gain.dispatchEvent(new Event('input'));
    expect(parameters.byId['gain']!.get()).toBe(0.2);

    const mode = shell.element.querySelector<HTMLSelectElement>(
      '#soundor-parameter-mode',
    )!;
    parameters.byId['mode']!.set('b');
    expect(mode.value).toBe('b');
    mode.value = 'a';
    mode.dispatchEvent(new Event('change'));
    expect(parameters.byId['mode']!.get()).toBe('a');
  });
});

describe('presentations', () => {
  it('demo: no host state, and the panel is not remembered', () => {
    const { shell, control } = setup('demo');
    expect(shell.element.dataset['presentation']).toBe('demo');
    expect(shell.element.querySelector('.soundor-inspector')).toBeNull();
    control<HTMLButtonElement>('panel').click();
    expect(localStorage.getItem('soundor:web-host:panel')).toBeNull();
  });

  it('dev: remembers whether the panel was open', () => {
    const first = setup('dev');
    first.control<HTMLButtonElement>('panel').click();
    first.shell.remove();
    const { shell } = setup('dev');
    expect(
      shell.element.querySelector<HTMLElement>('.soundor-panel')!.hidden,
    ).toBe(false);
    localStorage.clear();
  });

  it('dev: the host state in the panel', () => {
    const { shell, host } = setup('dev');
    const inspector = shell.element.querySelector('.soundor-inspector')!;
    expect(inspector.textContent).toContain('"hostName": "Soundor Web"');
    host.setBpm(100);
    expect(inspector.textContent).toContain('"bpm": 100');
  });

  it('stops listening when removed', () => {
    const { shell, parameters, host } = setup('dev');
    shell.remove();
    expect(document.body.children).toHaveLength(0);
    expect(() => {
      parameters.byId['gain']!.set(0.9);
      host.setBpm(80);
    }).not.toThrow();
  });
});
