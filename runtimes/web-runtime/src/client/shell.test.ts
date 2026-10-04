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

  it('sets the output volume and mute', () => {
    const { audio, control } = setup();
    const volume = control<HTMLInputElement>('volume');
    volume.value = '0.3';
    volume.dispatchEvent(new Event('input'));
    expect(audio.status.volume).toBe(0.3);
    control<HTMLButtonElement>('mute').click();
    expect(audio.status.muted).toBe(true);
    expect(control('mute').textContent).toBe('🔇');
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

describe('presentations', () => {
  it('demo: toolbar, plugin and status, no inspector', () => {
    const { shell } = setup('demo');
    expect(shell.element.dataset['presentation']).toBe('demo');
    expect(shell.element.querySelector('.soundor-inspector')).toBeNull();
  });

  it('dev: an inspector of the host state and the live parameters', () => {
    const { shell, parameters, host } = setup('dev');
    const inspector = shell.element.querySelector('.soundor-inspector')!;
    expect(inspector.textContent).toContain('"hostName": "Soundor Web"');
    expect(inspector.textContent).toContain('gain0.5float');
    parameters.byId['gain']!.set(0.25);
    expect(inspector.textContent).toContain('gain0.25float');
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
