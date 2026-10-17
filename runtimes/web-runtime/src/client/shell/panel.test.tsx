// @vitest-environment happy-dom
import {
  findByRole,
  fireEvent,
  getByLabelText,
  getByRole,
  getByText,
  queryByRole,
  queryByText,
} from '@testing-library/dom';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebHost } from '../host';
import { createParameterStore } from '../parameters';
import { fakeAudio, mount } from '../testing/preact';
import { Panel, type PanelProps } from './panel';

afterEach(() => document.body.replaceChildren());

function setup(
  props: Partial<Pick<PanelProps, 'open' | 'inspect' | 'parameters'>> & {
    inputs?: readonly { id: string; label: string }[];
  } = {},
) {
  const host = new WebHost({
    now: () => 0,
    frames: { request: () => 1, cancel: () => {} },
  });
  const fake = fakeAudio({}, props.inputs);
  const onClose = vi.fn<() => void>();
  const { container } = mount(
    <Panel
      id="panel"
      open={props.open ?? true}
      onClose={onClose}
      pluginName="Fixture"
      host={host}
      audio={fake.audio}
      parameters={props.parameters ?? createParameterStore([])}
      inspect={props.inspect ?? false}
    />,
  );
  const panel = container.querySelector<HTMLElement>('#panel')!;
  expect(panel.getAttribute('aria-label')).toBe('Host settings');
  return { host, fake, onClose, container, panel };
}

describe('the panel', () => {
  it('names the plugin, and is hidden while closed', () => {
    const { panel } = setup({ open: false });
    expect(panel.hidden).toBe(true);
    expect(getByText(panel, 'Fixture')).toBeDefined();
    expect(getByText(panel, 'Soundor Web host')).toBeDefined();
  });

  it('closes from its button and on Escape', () => {
    const { panel, onClose } = setup();
    fireEvent.click(getByRole(panel, 'button', { name: 'Close' }));
    fireEvent.keyDown(getByLabelText(panel, 'Input'), { key: 'Escape' });
    fireEvent.keyDown(getByLabelText(panel, 'Input'), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('says when a plugin declares no parameters', () => {
    const { panel } = setup();
    expect(getByText(panel, 'None declared')).toBeDefined();
  });

  it('lists every parameter in declaration order', () => {
    const { panel } = setup({
      parameters: createParameterStore([
        { id: 'b', label: 'Second', type: 'bool', default: false },
        { id: 'a', label: 'First', type: 'bool', default: true },
      ]),
    });
    expect(
      getByRole(panel, 'heading', { name: 'Parameters' }).closest('section')!
        .textContent,
    ).toBe('ParametersSecondFirst');
  });

  it('shows the host state only to inspect it', () => {
    expect(queryByText(setup().panel, 'Host state')).toBeNull();
    document.body.replaceChildren();
    const { panel, host } = setup({ inspect: true });
    const state = panel.querySelector('.soundor-inspector pre')!;
    expect(JSON.parse(state.textContent!)).toMatchObject({
      sampleRate: 48000,
      transport: { bpm: 120 },
    });
    act(() => host.setBpm(98.7654));
    expect(JSON.parse(state.textContent!).transport.bpm).toBe(98.765);
  });
});

describe('the audio section', () => {
  it('says what audio is doing, and which file plays', () => {
    const { fake, panel } = setup();
    const status = panel.querySelector('.soundor-status')!;
    expect(status.textContent).toContain('Audio off');
    fake.set({ state: 'starting' });
    expect(status.textContent).toContain('Starting audio…');
    fake.set({ state: 'running', source: 'file', fileName: 'loop.wav' });
    expect(status.textContent).toContain('Audio on · loop.wav');
    fake.set({ source: 'oscillator' });
    expect(status.textContent).not.toContain('loop.wav');
    fake.set({ state: 'failed', error: 'No output device' });
    expect(status.textContent).toContain('Audio failed');
    expect(getByRole(panel, 'alert').textContent).toBe('No output device');
  });

  it('switches to a source that needs no file', () => {
    const { fake, panel } = setup();
    fireEvent.change(getByLabelText(panel, 'Input'), {
      target: { value: 'none' },
    });
    expect(fake.calls.start).toBe(1);
    expect(fake.calls.setSource).toEqual([['none']]);
  });

  it('plays a chosen file', async () => {
    const { fake, panel } = setup();
    const file = panel.querySelector<HTMLInputElement>('input[type="file"]')!;
    const choose = vi.spyOn(file, 'click').mockImplementation(() => {});
    fireEvent.change(getByLabelText(panel, 'Input'), {
      target: { value: 'file' },
    });
    expect(choose).toHaveBeenCalledOnce();
    expect(fake.calls.setSource).toEqual([]);

    const chosen = new File(['RIFF'], 'loop.wav', { type: 'audio/wav' });
    Object.defineProperty(file, 'files', { value: [chosen] });
    await act(async () => {
      fireEvent.change(file);
    });
    expect(fake.calls.setSource).toEqual([['file', chosen]]);
  });

  it('says why a source could not be used, until another is chosen', async () => {
    const { fake, panel } = setup();
    fake.failSetSource(new Error('Unable to decode audio data'));
    fireEvent.change(getByLabelText(panel, 'Input'), {
      target: { value: 'none' },
    });
    expect((await findByRole(panel, 'alert')).textContent).toBe(
      'Unable to decode audio data',
    );
    fireEvent.change(getByLabelText(panel, 'Input'), {
      target: { value: 'oscillator' },
    });
    expect(queryByRole(panel, 'alert')).toBeNull();
  });
});

it('lists registered inputs and selects them through the audio host', () => {
  const { fake, panel } = setup({
    inputs: [
      { id: 'demo', label: 'Original demo' },
      { id: 'microphone', label: 'Microphone' },
    ],
  });
  expect(getByRole(panel, 'option', { name: 'Original demo' })).toBeDefined();
  fireEvent.change(getByLabelText(panel, 'Input'), {
    target: { value: 'demo' },
  });
  expect(fake.calls.setSource).toEqual([['demo']]);
});

it('shows microphone startup, capture and failure state, with a retry', () => {
  const { fake, panel } = setup();
  fake.set({ source: 'microphone', inputState: 'idle' });
  expect(getByText(panel, 'Press Play to use the microphone')).toBeDefined();
  fake.set({ inputState: 'starting' });
  expect(getByRole(panel, 'status').textContent).toBe(
    'Waiting for microphone…',
  );
  fake.set({ inputState: 'running' });
  expect(getByRole(panel, 'status').textContent).toBe('Microphone active');
  fake.set({
    inputState: 'failed',
    inputError: 'Microphone permission denied',
  });
  expect(getByRole(panel, 'alert').textContent).toBe(
    'Microphone permission denied',
  );
  fireEvent.click(getByRole(panel, 'button', { name: 'Retry input' }));
  expect(fake.calls.setSource).toEqual([['microphone']]);
});
