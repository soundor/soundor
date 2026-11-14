import { z } from 'zod';

import type { ConfigIssue } from './errors';

/** A named speaker arrangement. MIDI is a separate feature. */
export type AudioChannelLayout = 'disabled' | 'mono' | 'stereo' | '5.1' | '7.1';

/** One audio bus, ordered within its direction by declaration order. */
export interface AudioBus {
  /** Whether the plugin receives or produces this bus. */
  direction: 'input' | 'output';
  /** Display name offered to the host. */
  name: string;
  /** Whether a supported layout may disable this bus. Default false. */
  optional?: boolean;
}

/** A constant latency, or latency reported by DSP through JUCE's setLatencySamples(). */
export type AudioLatency =
  | { mode: 'fixed'; samples: number }
  | { mode: 'dynamic' };
/** A constant tail, or a tail reported with the generated setTailLengthSeconds(). */
export type AudioTail =
  | { mode: 'fixed'; seconds: number }
  | { mode: 'dynamic' };

/** The host-facing audio contract. Omit to retain a project's handwritten bus setup. */
export interface AudioConfig {
  /** Named buses; the first of each direction is the main bus. */
  buses: Record<string, AudioBus>;
  /** Complete supported combinations. Arrays offer alternatives for an optional bus. */
  layouts: Record<
    string,
    Record<string, AudioChannelLayout | readonly AudioChannelLayout[]>
  >;
  /** Initial layout, before the host negotiates another supported combination. */
  defaultLayout: string;
  /** Initial selection for buses whose default layout offers alternatives. */
  defaultBuses?: Record<string, AudioChannelLayout>;
  /** Host delay compensation. Defaults to zero fixed samples. */
  latency?: AudioLatency;
  /** Host tail reporting. Defaults to zero fixed seconds. */
  tail?: AudioTail;
}

const channel = z.enum(['disabled', 'mono', 'stereo', '5.1', '7.1']);
const identifier = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_]*$/,
    'expected a stable identifier starting with a letter',
  );
export const audioSchema = z.strictObject({
  buses: z.record(
    identifier,
    z.strictObject({
      direction: z.enum(['input', 'output']),
      name: z.string().trim().min(1),
      optional: z.boolean().optional(),
    }),
  ),
  layouts: z.record(
    identifier,
    z.record(identifier, z.union([channel, z.array(channel).min(1)])),
  ),
  defaultLayout: z.string(),
  defaultBuses: z.record(identifier, channel).optional(),
  latency: z
    .discriminatedUnion('mode', [
      z.strictObject({
        mode: z.literal('fixed'),
        samples: z.number().int().min(0).max(2147483647),
      }),
      z.strictObject({ mode: z.literal('dynamic') }),
    ])
    .optional(),
  tail: z
    .discriminatedUnion('mode', [
      z.strictObject({
        mode: z.literal('fixed'),
        seconds: z.number().finite().nonnegative(),
      }),
      z.strictObject({ mode: z.literal('dynamic') }),
    ])
    .optional(),
});

/** Validate references and every complete bus arrangement before code generation. */
export function checkAudio(audio: AudioConfig, issues: ConfigIssue[]): void {
  const fail = (path: string, message: string) =>
    issues.push({ path: `audio.${path}`, message });
  const buses = Object.entries(audio.buses);
  if (buses.length === 0) fail('buses', 'declare at least one audio bus');
  if (Object.keys(audio.layouts).length === 0)
    fail('layouts', 'declare at least one supported layout');
  if (!Object.hasOwn(audio.layouts, audio.defaultLayout))
    fail('defaultLayout', 'must name a declared layout');
  for (const [name, layout] of Object.entries(audio.layouts)) {
    for (const [id, bus] of buses) {
      const value = layout[id];
      if (value === undefined) {
        fail(`layouts.${name}.${id}`, 'every layout must specify every bus');
        continue;
      }
      const choices = typeof value === 'string' ? [value] : value;
      if (new Set(choices).size !== choices.length)
        fail(`layouts.${name}.${id}`, 'duplicate channel arrangement');
      if (!bus.optional && choices.includes('disabled'))
        fail(`layouts.${name}.${id}`, 'only optional buses may be disabled');
      if (choices.length > 1 && !bus.optional)
        fail(
          `layouts.${name}.${id}`,
          'alternatives are only supported for optional buses',
        );
    }
    for (const id of Object.keys(layout))
      if (!Object.hasOwn(audio.buses, id))
        fail(`layouts.${name}.${id}`, 'unknown audio bus');
  }
  const initial = audio.layouts[audio.defaultLayout];
  for (const [id, value] of Object.entries(audio.defaultBuses ?? {})) {
    const supported = initial?.[id];
    if (
      supported === undefined ||
      !(typeof supported === 'string' ? [supported] : supported).includes(value)
    )
      fail(
        `defaultBuses.${id}`,
        'must select an arrangement of this bus in defaultLayout',
      );
  }
  if (initial)
    for (const [id, value] of Object.entries(initial)) {
      if (
        Array.isArray(value) &&
        value.length > 1 &&
        audio.defaultBuses?.[id] === undefined
      )
        fail(
          `defaultBuses.${id}`,
          'choose an initial arrangement for this bus',
        );
    }
}

/** The initial channel arrangement of a bus in a validated config. */
export function initialBusLayout(
  audio: AudioConfig,
  id: string,
): AudioChannelLayout {
  const value = audio.layouts[audio.defaultLayout]![id]!;
  return (
    audio.defaultBuses?.[id] ?? (typeof value === 'string' ? value : value[0]!)
  );
}
