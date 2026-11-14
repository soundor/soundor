import { resolveConfig } from '@soundor/runtime-sdk';
import { expect, it } from 'vitest';

import { webManifest } from './codegen';

const config = (audio: object) =>
  resolveConfig({
    plugin: { id: 'com.acme.audio', name: 'Audio' },
    runtimes: [],
    audio,
  });
const audio = {
  buses: {
    input: { direction: 'input', name: 'Input' },
    output: { direction: 'output', name: 'Output' },
  },
  layouts: {
    mono: { input: 'mono', output: 'mono' },
    stereo: { input: 'stereo', output: 'stereo' },
  },
  defaultLayout: 'mono',
};
it('uses the declared initial channel layout in the browser', () => {
  expect(webManifest(config(audio)).audio).toEqual({
    inputChannels: 1,
    outputChannels: 1,
  });
  expect(
    webManifest(config({ ...audio, defaultLayout: 'stereo' })).audio,
  ).toEqual({ inputChannels: 2, outputChannels: 2 });
});
it('rejects bus contracts that browser routing cannot implement', () => {
  expect(() =>
    webManifest(
      config({
        ...audio,
        buses: {
          ...audio.buses,
          sidechain: { direction: 'input', name: 'Sidechain', optional: true },
        },
        layouts: {
          stereo: { input: 'stereo', output: 'stereo', sidechain: 'disabled' },
        },
        defaultLayout: 'stereo',
      }),
    ),
  ).toThrow('Web audio currently supports');
  expect(() =>
    webManifest(
      config({
        ...audio,
        layouts: { surround: { input: '5.1', output: '5.1' } },
        defaultLayout: 'surround',
      }),
    ),
  ).toThrow('mono and stereo');
});
