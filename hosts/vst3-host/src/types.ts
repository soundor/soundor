/** A bus's speaker arrangement: a channel count, or a name ("mono",
    "stereo", an SDK name such as "5.1"), or a hexadecimal mask ("0x3"). */
export interface BusSetup {
  channels?: number;
  arrangement?: string;
  /** Default: main buses and the buses the plugin marks default-active. */
  active?: boolean;
}

export type ProcessMode = 'realtime' | 'offline' | 'prefetch';

export interface ProcessingSetup {
  /** Hz. Default 48000. */
  sampleRate?: number;
  /** The largest block the plugin is given, in frames. Default 512. */
  blockSize?: number;
  /** The mode the plugin is told it runs in (ProcessSetup::processMode).
      Default "realtime": what a DAW's playback does. Processing is offline
      either way. */
  processMode?: ProcessMode;
  /** By audio input bus index; `null` or a missing entry keeps the
      plugin's default. */
  inputs?: (BusSetup | null)[];
  outputs?: (BusSetup | null)[];
}

export interface BusInfo {
  index: number;
  name: string;
  type: 'main' | 'aux';
  channels: number;
  /** Audio buses: the arrangement's name, or its mask in hexadecimal. */
  arrangement?: string;
  active: boolean;
  defaultActive: boolean;
}

export interface PluginClass {
  name: string;
  /** The class's 32-digit hexadecimal id. */
  classId: string;
}

export interface PluginInfo {
  path: string;
  name: string;
  classId: string;
  vendor: string;
  version: string;
  sdkVersion: string;
  subCategories: string[];
  factory: { vendor: string; url: string; email: string };
  /** Every audio processor class of the bundle. */
  classes: PluginClass[];
  separateController: boolean;
  hasController: boolean;
  sampleRate: number;
  blockSize: number;
  processMode: ProcessMode;
  buses: {
    audioInputs: BusInfo[];
    audioOutputs: BusInfo[];
    eventInputs: BusInfo[];
    eventOutputs: BusInfo[];
  };
  parameterCount: number;
  latencySamples: number;
  tailSamples: number | 'infinite';
}

/** A VST3 parameter. `id` is the plugin's ParamID (an unsigned 32-bit
    integer), stable across instances and sessions of the same plugin. */
export interface ParameterInfo {
  id: number;
  title: string;
  shortTitle: string;
  units: string;
  /** 0: continuous; 1: a toggle; n: n + 1 discrete values. */
  stepCount: number;
  defaultNormalized: number;
  unitId: number;
  flags: {
    canAutomate: boolean;
    readOnly: boolean;
    wrap: boolean;
    list: boolean;
    hidden: boolean;
    programChange: boolean;
    bypass: boolean;
  };
  /** The current value, from 0 to 1. */
  normalized: number;
  /** The same value in the plugin's own units (normalizedParamToPlain). */
  plain: number;
  /** The plugin's text for it (getParamStringByValue), or null. */
  display: string | null;
}

/** Either value; the other is derived by the plugin's controller. */
export type ParameterValue = { normalized: number } | { plain: number };

export interface ParameterChange {
  id: number;
  /** Normalized, 0 to 1. */
  value: number;
  /** The frame it applies at, from the start of the process call. Default 0. */
  time?: number;
}

interface TimedEvent {
  /** The frame, from the start of the process call. Default 0. */
  time?: number;
  /** MIDI channel 0–15. Default 0. */
  channel?: number;
}

interface NoteEventBase extends TimedEvent {
  /** Event bus index. Default 0. */
  bus?: number;
  pitch: number;
  /** -1 (default): none. */
  noteId?: number;
}

export interface NoteOnEvent extends NoteEventBase {
  type: 'noteOn';
  /** 0 to 1. Default 1. */
  velocity?: number;
  /** Cents. */
  tuning?: number;
  /** Frames, when known in advance. */
  length?: number;
}

export interface NoteOffEvent extends NoteEventBase {
  type: 'noteOff';
  velocity?: number;
  tuning?: number;
}

export interface PolyPressureEvent extends NoteEventBase {
  type: 'polyPressure';
  pressure: number;
}

/** MIDI controllers reach VST3 plugins as parameter changes, through the
    plugin's IMidiMapping; one it does not map is dropped with a warning. */
export interface ControlChangeEvent extends TimedEvent {
  type: 'controlChange';
  bus?: number;
  controller: number;
  /** 0 to 1 (MIDI value / 127). */
  value: number;
}

export interface PitchBendEvent extends TimedEvent {
  type: 'pitchBend';
  bus?: number;
  /** -1 to 1. */
  value: number;
}

export interface ChannelPressureEvent extends TimedEvent {
  type: 'channelPressure';
  bus?: number;
  /** 0 to 1. */
  value: number;
}

export type InputEvent =
  | NoteOnEvent
  | NoteOffEvent
  | PolyPressureEvent
  | ControlChangeEvent
  | PitchBendEvent
  | ChannelPressureEvent;

export type OutputEvent =
  | {
      type: 'noteOn' | 'noteOff';
      time: number;
      bus: number;
      channel: number;
      pitch: number;
      velocity: number;
      noteId: number;
    }
  | {
      type: 'polyPressure';
      time: number;
      bus: number;
      channel: number;
      pitch: number;
      pressure: number;
      noteId: number;
    }
  | {
      type: 'midiCC';
      time: number;
      bus: number;
      channel: number;
      controller: number;
      value: number;
      value2: number;
    }
  | { type: 'other'; time: number; bus: number; vstType: number };

export interface Transport {
  playing: boolean;
  /** Beats per minute. */
  tempo: number;
  timeSignature: { numerator: number; denominator: number };
  /** The project position, in frames. */
  samplePosition: number;
  /** The same position in quarter notes. */
  musicalPosition: number;
}

/** Changes to the host's transport, kept for later calls. Give the position
    in frames or in quarter notes, not both. */
export interface TransportUpdate {
  playing?: boolean;
  tempo?: number;
  timeSignature?: { numerator?: number; denominator?: number };
  samplePosition?: number;
  musicalPosition?: number;
}

/** Audio as channels: one Float32Array per channel, all the same length. */
export type AudioBus = readonly Float32Array[];

export interface RequestOptions {
  /** Milliseconds; the host is stopped if it does not answer in time.
      Default: the host's requestTimeout. */
  timeout?: number;
  signal?: AbortSignal;
}

export interface ProcessRequest extends RequestOptions {
  /** Frames to process. Default: the length of the given input channels;
      required when no input is given (instruments). */
  frames?: number;
  /** By audio input bus index. A missing, `null` or `undefined` bus gets
      silence. A given bus has exactly the bus's channel count. */
  inputs?: readonly (AudioBus | null | undefined)[];
  events?: readonly InputEvent[];
  parameterChanges?: readonly ParameterChange[];
  transport?: TransportUpdate;
}

export interface ProcessResult {
  frames: number;
  /** By audio output bus index; an inactive bus has no channels. The
      arrays are the caller's. */
  outputs: Float32Array[][];
  events: OutputEvent[];
  /** What the processor reported (meters, read-only values), with the
      frame each applies at. */
  parameterChanges: Required<ParameterChange>[];
  /** The transport after the call. */
  transport: Transport;
  /** Input the plugin could not take (an unmapped MIDI controller). */
  warnings: string[];
}

/** A plugin's saved state: its processor's, then its controller's. */
export interface PluginState {
  component: Uint8Array;
  controller: Uint8Array;
}

/**
 * How an editor is shown: `editor`, a window that is the plugin's editor
 * alone, or `host`, the editor with the host interface around it (a dock
 * and a side panel). Either way the editor has the same size, and
 * everything the interface does can be done through this API.
 */
export type Presentation = 'editor' | 'host';

export interface EditorInfo {
  open: boolean;
  /** The editor's size (not the window's). */
  width?: number;
  height?: number;
  resizable?: boolean;
  scale?: number;
  platformType?: string;
  presentation?: Presentation;
  /** The window's content size: the editor's in `editor`, more in `host`. */
  window?: { width: number; height: number };
  /** `host`: the frames the interface has presented. An idle window
      presents none. */
  interfaceFrames?: number;
}

/** Where live audio's input comes from: a 220 Hz triangle wave, a WAV
    file (looped), the default recording device, or silence. It plays while
    the transport does. */
export type AudioInput = 'oscillator' | 'file' | 'microphone' | 'none';

export interface AudioSettings {
  input?: AudioInput;
  /** A WAV file's path, for the `file` input (selects it when no input is given). */
  file?: string;
  muted?: boolean;
  /** The output volume, from 0 to 1. */
  volume?: number;
}

export interface AudioStatus {
  /** Live audio plays through the default output device. */
  running: boolean;
  muted: boolean;
  volume: number;
  input: AudioInput;
  file: string | null;
  /** The output device's name while running. */
  device: string | null;
  /** The device or the plugin's processing failed. */
  error: string | null;
  /** The input could not be opened (a microphone) or read (a file). */
  inputError: string | null;
}

export interface LatencyInfo {
  latencySamples: number;
  tailSamples: number | 'infinite';
}

export interface HostEvents {
  /** The editor's controller began, made or ended a parameter edit. */
  beginEdit: { id: number };
  performEdit: { id: number; value: number };
  endEdit: { id: number };
  /** The plugin asked to be restarted; the host did so between calls. */
  restart: { flags: number; reasons: string[]; latencySamples: number };
  dirty: { dirty: boolean };
  editorRequested: Record<string, never>;
  editorResized: EditorInfo;
  /** The user closed the editor's window. */
  editorClosed: Record<string, never>;
  /** Live audio changed from the host interface (started, stopped, muted,
      another input or volume). */
  audioChanged: AudioStatus;
  /** The host process ended. */
  exit: { code: number | null; signal: NodeJS.Signals | null };
}
