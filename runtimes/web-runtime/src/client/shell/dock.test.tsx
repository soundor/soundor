// @vitest-environment happy-dom
import { fireEvent, getByRole, queryByText } from '@testing-library/dom';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebHost } from '../host';
import { fakeAudio, mount } from '../testing/preact';
import { barBeat, Dock } from './dock';

afterEach(() => document.body.replaceChildren());

function setup(status: Parameters<typeof fakeAudio>[0] = {}) {
  const host = new WebHost({
    now: () => 0,
    frames: { request: () => 1, cancel: () => {} },
  });
  const fake = fakeAudio(status);
  const onTogglePanel = vi.fn<() => void>();
  const view = (panelOpen: boolean) => (
    <Dock
      host={host}
      audio={fake.audio}
      panelId="panel"
      toggleId="toggle"
      panelOpen={panelOpen}
      onTogglePanel={onTogglePanel}
    />
  );
  const { container, rerender } = mount(view(false));
  const button = (name: string | RegExp) =>
    getByRole<HTMLButtonElement>(container, 'button', { name });
  return {
    host,
    fake,
    container,
    button,
    onTogglePanel,
    setPanelOpen: (open: boolean) => rerender(view(open)),
  };
}

describe('the audio button', () => {
  it('mutes and unmutes, before audio starts as after', () => {
    const { fake, button } = setup();
    const mute = button('Mute');
    expect(mute.textContent).toBe('');
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(mute);
    expect(fake.calls.setMuted).toEqual([true]);
    expect(fake.calls.start).toBe(0);

    fake.set({ state: 'running', muted: true });
    const unmute = button('Unmute');
    expect(unmute.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(unmute);
    expect(fake.calls.setMuted).toEqual([true, false]);
  });

  it('failed: offers a retry and says why in its tooltip', () => {
    const { fake, button } = setup();
    fake.set({ state: 'failed', error: 'The browser refused audio' });
    const retry = button('Retry audio');
    expect(retry.dataset['state']).toBe('failed');
    expect(retry.title).toBe('Audio failed: The browser refused audio');
    fireEvent.click(retry);
    expect(fake.calls.start).toBe(1);
  });
});

describe('the dock', () => {
  it('sets the output volume and follows it', () => {
    const { fake, container } = setup();
    const volume = getByRole<HTMLInputElement>(container, 'slider', {
      name: 'Output volume',
    });
    expect(volume.value).toBe('0.8');
    fireEvent.input(volume, { target: { value: '0.25' } });
    expect(fake.calls.setVolume).toEqual([0.25]);
    fake.set({ volume: 0.5 });
    expect(volume.value).toBe('0.5');
  });

  it('plays with audio started from the same click, and stops', () => {
    const { host, fake, button } = setup();
    fireEvent.click(button('Play'));
    expect(fake.calls.start).toBe(1);
    expect(host.snapshot().transport?.playing).toBe(true);
    fireEvent.click(button('Pause'));
    expect(host.snapshot().transport?.playing).toBe(false);
    expect(fake.calls.start).toBe(1);
  });

  it('shows the position, highlighted while playing', () => {
    const { host, container } = setup();
    const position = queryByText(container, '1.1')!;
    expect(position.classList.contains('soundor-playing')).toBe(false);
    act(() => host.play());
    expect(position.classList.contains('soundor-playing')).toBe(true);
  });

  it('opens and closes the panel it controls', () => {
    const { button, onTogglePanel, setPanelOpen } = setup();
    const toggle = button('Host settings');
    expect(toggle.id).toBe('toggle');
    expect(toggle.getAttribute('aria-controls')).toBe('panel');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(onTogglePanel).toHaveBeenCalledOnce();
    setPanelOpen(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('barBeat', () => {
  const at = (
    ppqPosition: number,
    barStartPpq: number,
    numerator: number,
    denominator: number,
  ) =>
    barBeat({
      playing: true,
      recording: false,
      looping: false,
      bpm: 120,
      timeSignature: { numerator, denominator },
      ppqPosition,
      barStartPpq,
      timeInSeconds: 0,
      timeInSamples: 0,
    });

  it('counts bars and beats from one', () => {
    expect(at(0, 0, 4, 4)).toBe('1.1');
    expect(at(7.5, 4, 4, 4)).toBe('2.4');
  });

  it('counts in the time signature’s beats', () => {
    // 6/8: a beat is an eighth (half a quarter), a bar three quarters.
    expect(at(3.5, 3, 6, 8)).toBe('2.2');
    expect(at(5.9, 3, 6, 8)).toBe('2.6');
  });
});
