import { resolveConfig } from '@soundor/runtime-sdk';
import { expect, it } from 'vitest';

import { generateJuceSources } from './codegen';
import { resolveJuceOptions } from './options';

it('generates stereo-only layout negotiation, metadata and host groups from config', () => {
  const config = resolveConfig({
    plugin: {
      id: 'com.acme.echo',
      name: 'Echo',
      kind: 'effect',
      categories: ['delay'],
      vendor: { name: 'Acme' },
    },
    runtimes: [],
    audio: {
      buses: {
        input: { direction: 'input', name: 'Input' },
        output: { direction: 'output', name: 'Output' },
      },
      layouts: { stereo: { input: 'stereo', output: 'stereo' } },
      defaultLayout: 'stereo',
      latency: { mode: 'fixed', samples: 128 },
      tail: { mode: 'dynamic' },
    },
    parameterGroups: { output: { label: 'Output' } },
    parameters: {
      bypass: {
        type: 'boolean',
        default: false,
        role: 'bypass',
        group: 'output',
      },
    },
  });
  const options = resolveJuceOptions({}, config.plugin);
  const files = new Map(
    generateJuceSources(config, { options, nativeDir: '/native' }).map((f) => [
      f.path,
      f.contents,
    ]),
  );
  expect(options.companyName).toBe('Acme');
  expect(files.get('setup.cmake')).toContain('VST3_CATEGORIES Fx Delay');
  const source = files.get('soundor/SoundorProcessor.cpp')!;
  expect(source).toContain('setLatencySamples(128)');
  expect(source).toContain('juce::AudioChannelSet::stereo()');
  expect(source).not.toContain('juce::AudioChannelSet::mono()');
  expect(files.get('soundor/SoundorProcessor.h')).toContain(
    'getBypassParameter()',
  );
  expect(source).toContain('AudioProcessorParameterGroup');
  expect(files.get('setup.cmake')).toContain('SOUNDOR_CONFIGURED_AUDIO=1');
});
