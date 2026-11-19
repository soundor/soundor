/**
 * The plugin's descriptor: everything the generic VST3 adapter needs to be
 * this plugin, as JSON the generated Rust crate embeds and hands it at run
 * time (`soundor_vst3_plugin`, native/include/soundor/vst3/PluginAbi.h).
 *
 * Every part comes from the resolved config, through the same descriptions
 * the other runtimes use: parameters with their behaviour as the expressions
 * config resolved them into (the adapter interprets them with the C++
 * compiler's semantics), state as describeState() and describeAudioState()
 * have it, the native API as describeNativeApi() has it. Nothing about the
 * plugin is compiled into the adapter.
 */

import { createHash } from 'node:crypto';

import {
  describeAudioState,
  describeNativeApi,
  describeState,
  initialBusLayout,
  resolveEditor,
  stateJson,
  type AudioChannelLayout,
  type ResolvedParameter,
  type ResolvedSoundorConfig,
} from '@soundor/runtime-sdk';

import type { ResolvedVst3Options } from './options';

/** The descriptor format the adapter reads (Descriptor.h's descriptorFormat). */
export const DESCRIPTOR_FORMAT = 1;

const CHANNELS: Record<AudioChannelLayout, number> = {
  disabled: 0,
  mono: 1,
  stereo: 2,
  '5.1': 6,
  '7.1': 8,
};

/** VST3 subcategories of the config's categories. */
const SUBCATEGORIES: Record<string, string> = {
  eq: 'EQ',
  dynamics: 'Dynamics',
  delay: 'Delay',
  reverb: 'Reverb',
  modulation: 'Modulation',
  distortion: 'Distortion',
  filter: 'Filter',
  utility: 'Tools',
  analyzer: 'Analyzer',
  synth: 'Synth',
  sampler: 'Sampler',
  generator: 'Generator',
};

/**
 * A parameter's VST3 ParamID: its id's hash, as JUCE's VST3 wrapper derives
 * it (juce::String::hashCode, kept to 31 bits, the range every host takes),
 * so it stays the same across versions and a host's automation keeps it.
 */
export function parameterVstId(id: string): number {
  let hash = 0;
  for (const character of id)
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return hash & 0x7fffffff;
}

/**
 * The plugin's VST3 class ids (32 hex digits), derived from its id: stable
 * across versions and rebuilds, distinct for every plugin id. A renamed
 * binary is the same plugin; a changed `plugin.id` is another.
 */
export function classIds(pluginId: string): {
  processor: string;
  controller: string;
} {
  const id = (role: string) =>
    createHash('sha256')
      .update(`soundor/vst3-runtime/${role}/${pluginId}`)
      .digest('hex')
      .slice(0, 32)
      .toUpperCase();
  return { processor: id('processor'), controller: id('controller') };
}

/** The vendor hosts show: the config's, or the vendor part of the id (`com.acme.reverb` → `acme`). */
export function vendorName(config: ResolvedSoundorConfig): string {
  return (
    config.plugin.vendor?.name ??
    config.plugin.id.split('.')[1] ??
    config.plugin.id
  );
}

interface Plain {
  min: number;
  max: number;
  default: number;
  step: number;
  unit: string;
}

/** A parameter's plain range, default and step, as parameters::Info holds them. */
function plain(parameter: ResolvedParameter): Plain {
  switch (parameter.type) {
    case 'boolean':
      return {
        min: 0,
        max: 1,
        default: parameter.default ? 1 : 0,
        step: 0,
        unit: '',
      };
    case 'choice':
      return {
        min: 0,
        max: parameter.options.length - 1,
        default: parameter.options.findIndex(
          (option) => option.value === parameter.default,
        ),
        step: 0,
        unit: '',
      };
    default:
      return {
        min: parameter.min,
        max: parameter.max,
        default: parameter.default,
        step: parameter.step ?? 0,
        unit: parameter.unit ?? '',
      };
  }
}

/** VST3's step count: 0 for a continuous parameter, else its steps. */
function stepCount(parameter: ResolvedParameter): number {
  switch (parameter.type) {
    case 'boolean':
      return 1;
    case 'choice':
      return Math.max(0, parameter.options.length - 1);
    case 'float32':
      return 0;
    default: {
      const step = parameter.step ?? 1;
      return Math.max(0, Math.round((parameter.max - parameter.min) / step));
    }
  }
}

/** A preset's value of a parameter as a plain value. */
function presetPlain(
  parameter: ResolvedParameter,
  value: number | boolean | string,
): number {
  if (parameter.type === 'boolean') return value === true ? 1 : 0;
  if (parameter.type === 'choice')
    return parameter.options.findIndex((option) => option.value === value);
  return value as number;
}

/** The config's audio as the adapter's buses and layouts. */
function audio(config: ResolvedSoundorConfig) {
  const configured = config.audio;
  if (configured === undefined) {
    if (config.plugin.kind === 'midiEffect')
      return {
        inputs: [],
        outputs: [],
        layouts: [{ name: 'midi', inputs: [], outputs: [] }],
      };
    // No audio configuration: stereo in and out, mono with mono, as the JUCE runtime's.
    return {
      inputs: [{ name: 'Input', initialChannels: 2, enabledChannels: 2 }],
      outputs: [{ name: 'Output', initialChannels: 2, enabledChannels: 2 }],
      layouts: [
        { name: 'stereo', inputs: [[2]], outputs: [[2]] },
        { name: 'mono', inputs: [[1]], outputs: [[1]] },
      ],
    };
  }
  const buses = Object.entries(configured.buses);
  const bus = ([id, declared]: (typeof buses)[number]) => {
    const initial = CHANNELS[initialBusLayout(configured, id)];
    // A bus that starts disabled still needs its channels for when the host enables it.
    const enabled =
      initial > 0
        ? initial
        : (Object.values(configured.layouts)
            .flatMap((layout) => {
              const value = layout[id];
              return value === undefined
                ? []
                : typeof value === 'string'
                  ? [value]
                  : [...value];
            })
            .map((value) => CHANNELS[value])
            .find((channels) => channels > 0) ?? 2);
    return {
      name: declared.name,
      initialChannels: initial,
      enabledChannels: enabled,
    };
  };
  const inputs = buses.filter(([, declared]) => declared.direction === 'input');
  const outputs = buses.filter(
    ([, declared]) => declared.direction === 'output',
  );
  const counts = (
    layout: Record<string, AudioChannelLayout | readonly AudioChannelLayout[]>,
    list: typeof buses,
  ) =>
    list.map(([id]) => {
      const value = layout[id] ?? 'disabled';
      return (typeof value === 'string' ? [value] : [...value]).map(
        (choice) => CHANNELS[choice],
      );
    });
  return {
    inputs: inputs.map(bus),
    outputs: outputs.map(bus),
    layouts: Object.entries(configured.layouts).map(([name, layout]) => ({
      name,
      inputs: counts(layout, inputs),
      outputs: counts(layout, outputs),
    })),
  };
}

/** The descriptor's object: what descriptorJson() writes. */
export function describePlugin(
  config: ResolvedSoundorConfig,
  options: ResolvedVst3Options,
) {
  const parameters = config.parameters;
  const native = describeNativeApi(config.native);
  if (!native.ok)
    throw new Error(
      `Invalid native API: ${native.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    );
  const state = describeState(config.state, config.native);
  const audioState = describeAudioState(state);
  const editor = resolveEditor(config.editor);
  const ids = options.classIds ?? classIds(config.plugin.id);
  const vstIds = new Map<number, string>();
  for (const parameter of parameters) {
    const id = parameterVstId(parameter.id);
    const other = vstIds.get(id);
    if (other !== undefined)
      throw new Error(
        `Parameters ${other} and ${parameter.id} have the same VST3 id (${id}): rename one of them.`,
      );
    vstIds.set(id, parameter.id);
  }
  const groups = Object.entries(config.parameterGroups ?? {}).map(
    ([id, group], index) => ({
      id,
      label: group.label,
      unit: index + 1,
    }),
  );
  const kind = config.plugin.kind ?? 'effect';
  const subcategories = [
    kind === 'instrument' ? 'Instrument' : 'Fx',
    ...(kind === 'midiEffect' ? ['Tools'] : []),
    ...(config.plugin.categories ?? []).map(
      (category) => SUBCATEGORIES[category]!,
    ),
  ];
  const latency = config.audio?.latency;
  const tail = config.audio?.tail;
  const finite = (value: number) => (Number.isFinite(value) ? value : 0);
  return {
    format: DESCRIPTOR_FORMAT,
    plugin: {
      id: config.plugin.id,
      name: config.plugin.name,
      vendor: vendorName(config),
      url: config.plugin.vendor?.website ?? '',
      email: config.plugin.vendor?.supportEmail ?? '',
      version: config.plugin.version ?? '0.1.0',
      copyright: config.plugin.copyright ?? '',
      subcategories: [...new Set(subcategories)].join('|'),
      processorCid: ids.processor,
      controllerCid: ids.controller,
    },
    audio: {
      ...audio(config),
      latency: latency?.mode === 'fixed' ? latency.samples : 0,
      tailSeconds:
        tail?.mode === 'fixed'
          ? tail.seconds
          : tail?.mode === 'dynamic'
            ? -1
            : 0,
    },
    midi: {
      input: config.midi?.input === true,
      output: config.midi?.output === true,
    },
    editor: {
      width: editor.width,
      height: editor.height,
      minWidth: editor.minWidth,
      minHeight: editor.minHeight,
      maxWidth: finite(editor.maxWidth),
      maxHeight: finite(editor.maxHeight),
      resizable: editor.resizable,
      scale: editor.resize === 'scale',
      keepAspectRatio: editor.keepAspectRatio,
      cover: editor.fit === 'cover',
      background: 0xff000000,
    },
    runtime: { timeLimit: options.timeLimit },
    parameters: parameters.map((parameter) => {
      const values = plain(parameter);
      return {
        id: parameter.id,
        label: parameter.label,
        type: parameter.type,
        access: parameter.access,
        ...values,
        choices:
          parameter.type === 'choice'
            ? parameter.options.map((option) => ({
                value: option.value,
                label: option.label,
              }))
            : [],
        group: parameter.group ?? '',
        role: parameter.role ?? '',
        vstId: parameterVstId(parameter.id),
        stepCount: stepCount(parameter),
        semantics: parameter.semantics,
      };
    }),
    groups,
    state: {
      fields: state.fields.map((field) => ({
        name: field.name,
        type: field.type,
        default: stateJson(field.default),
        maxLength: field.maxLength ?? null,
        audio: field.audio === true,
      })),
      types: state.types,
      audio: {
        size: audioState.size,
        fields: audioState.fields.map((field) => ({
          name: field.name,
          kind: field.kind,
          element: field.element,
          offset: field.offset,
          ...(field.kind === 'array'
            ? { dataOffset: field.dataOffset, maxLength: field.maxLength }
            : {}),
        })),
      },
    },
    presets: (config.presets ?? []).map((preset) => ({
      id: preset.id,
      name: preset.name,
      parameters: Object.fromEntries(
        Object.entries(preset.parameters).flatMap(([id, value]) => {
          const parameter = parameters.find((candidate) => candidate.id === id);
          return parameter === undefined || parameter.access === 'readOnly'
            ? []
            : [[id, presetPlain(parameter, value)]];
        }),
      ),
      state: Object.fromEntries(
        Object.entries(preset.state).map(([field, value]) => [
          field,
          stateJson(value),
        ]),
      ),
    })),
    streams: native.model.streams.map((stream) => ({
      name: stream.name,
      kind: stream.kind,
      element: stream.element,
      maxLength: stream.kind === 'buffer' ? stream.maxLength : 0,
    })),
    events: native.model.events.map((event) => event.name),
    contract: {
      parameters: parameters.length,
      published: parameters.filter(
        (parameter) => parameter.access === 'readOnly',
      ).length,
      streams: native.model.streams.length,
      stateSize: audioState.size,
    },
  };
}

/** The descriptor, as the generated crate embeds it. */
export function descriptorJson(
  config: ResolvedSoundorConfig,
  options: ResolvedVst3Options,
): string {
  return `${JSON.stringify(describePlugin(config, options))}\n`;
}
