import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: { id: 'dev.soundor.orbit', name: 'Orbit' },
  // Resizing zooms the plugin rather than laying it out again, so its knobs
  // and echoes stay where the user learned them: always laid out at
  // 800×600, drawn between 400×300 and 1600×1200. In a window of another
  // shape, its background covers the rest (src/main.tsx).
  editor: {
    resizable: true,
    resize: 'scale',
    fit: 'cover',
    minWidth: 400,
    minHeight: 300,
    maxWidth: 1600,
    maxHeight: 1200,
  },
  runtimes: [
    juceRuntime({
      formats: ['vst3', 'standalone'],
    }),
    webRuntime(),
  ],
  state: {
    presetDescription: {
      type: 'string',
      default: 'Listen for the repeats between phrases.',
    },
  },
  // Complete factory snapshots also restore Hold and bypass to their defaults.
  presets: [
    {
      id: 'dotted-satellites',
      name: 'Dotted satellites',
    },
    {
      id: 'warm-magnetic',
      name: 'Warm magnetic',
      parameters: {
        time1: 0.38,
        time2: 0.76,
        time3: 1.14,
        level1: 0.9,
        level2: 0.3,
        level3: 0.12,
        feedback: 0.32,
        tone: 0.28,
        motion: 0.65,
        spread: 0.3,
        mix: 0.6,
        sync: false,
      },
      state: {
        presetDescription: 'Short, dark repeats with a little tape drift.',
      },
    },
    {
      id: 'drifting-space',
      name: 'Drifting space',
      parameters: {
        time1: 1,
        time2: 1.75,
        time3: 2.75,
        level1: 0.7,
        level2: 0.7,
        level3: 0.7,
        feedback: 0.82,
        tone: 0.4,
        motion: 0.85,
        spread: 1,
        mix: 0.8,
        sync: true,
      },
      state: {
        presetDescription: 'Long, moving tails fill the gaps.',
      },
    },
    {
      id: 'close-conversation',
      name: 'Close conversation',
      parameters: {
        time1: 0.125,
        time2: 0.14,
        time3: 0.18,
        level1: 0.85,
        level2: 0.55,
        level3: 0.85,
        feedback: 0.04,
        tone: 0.8,
        motion: 0.12,
        spread: 1,
        mix: 0.6,
        sync: false,
      },
      state: {
        presetDescription: 'A tight, wide double instead of a long tail.',
      },
    },
  ],
  parameters: {
    time1: {
      type: 'float32',
      label: 'Echo 1 time',
      min: 0.125,
      max: 3,
      default: 0.75,
    },
    time2: {
      type: 'float32',
      label: 'Echo 2 time',
      min: 0.125,
      max: 3,
      default: 1.5,
    },
    time3: {
      type: 'float32',
      label: 'Echo 3 time',
      min: 0.125,
      max: 3,
      default: 2.25,
    },
    level1: {
      type: 'float32',
      label: 'Echo 1 level',
      min: 0,
      max: 1,
      default: 0.8,
    },
    level2: {
      type: 'float32',
      label: 'Echo 2 level',
      min: 0,
      max: 1,
      default: 0.55,
    },
    level3: {
      type: 'float32',
      label: 'Echo 3 level',
      min: 0,
      max: 1,
      default: 0.35,
    },
    feedback: {
      type: 'float32',
      label: 'Feedback',
      min: 0,
      max: 0.92,
      default: 0.48,
    },
    tone: { type: 'float32', label: 'Tone', min: 0, max: 1, default: 0.55 },
    motion: { type: 'float32', label: 'Motion', min: 0, max: 1, default: 0.18 },
    spread: { type: 'float32', label: 'Spread', min: 0, max: 1, default: 0.75 },
    mix: { type: 'float32', label: 'Mix', min: 0, max: 1, default: 0.6 },
    sync: { type: 'boolean', label: 'Tempo sync', default: true },
    hold: { type: 'boolean', label: 'Hold', default: false },
    bypass: { type: 'boolean', label: 'Bypass', default: false },
  },
});
