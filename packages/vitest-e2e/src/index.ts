export {
  dominantFrequency,
  impulse,
  noise,
  noteOff,
  noteOn,
  peak,
  render,
  rms,
  silence,
  sine,
  type Audio,
  type RenderRequest,
  type SignalOptions,
} from './audio';
export type { AudioMatcherOptions, SilenceOptions } from './audio-matchers';
export {
  launchHost,
  launchPlugin,
  type LaunchHostOptions,
  type LaunchPluginOptions,
} from './launch';
export type { MatcherOptions } from './matchers';
export { soundor, type SoundorE2EOptions } from './plugin';
export type { ScreenshotMatcherOptions } from './screenshot';
export { readWav, writeWav, type WavAudio } from './wav';
export type { Locator } from '@soundor/driver';
export type { Vst3Plugin } from '@soundor/driver/vst3';
export type { HostParameter, Vst3Host } from '@soundor/vst3-host';
