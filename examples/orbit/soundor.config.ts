import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: { id: 'dev.soundor.orbit', name: 'Orbit' },
  // Resizing zooms the plugin rather than laying it out again, so its knobs
  // and echoes stay where the user learned them: always laid out at
  // 800×600, drawn between 400×300 and 1600×1200.
  editor: { resizable: true, resize: 'scale' },
  runtimes: [
    juceRuntime({
      formats: ['vst3', 'standalone'],
      engine: { mode: 'source' },
    }),
    webRuntime(),
  ],
  parameters: [
    {
      type: 'float',
      id: 'time1',
      label: 'Echo 1 time',
      min: 0.125,
      max: 3,
      default: 0.75,
    },
    {
      type: 'float',
      id: 'time2',
      label: 'Echo 2 time',
      min: 0.125,
      max: 3,
      default: 1.5,
    },
    {
      type: 'float',
      id: 'time3',
      label: 'Echo 3 time',
      min: 0.125,
      max: 3,
      default: 2.25,
    },
    {
      type: 'float',
      id: 'level1',
      label: 'Echo 1 level',
      min: 0,
      max: 1,
      default: 0.8,
    },
    {
      type: 'float',
      id: 'level2',
      label: 'Echo 2 level',
      min: 0,
      max: 1,
      default: 0.55,
    },
    {
      type: 'float',
      id: 'level3',
      label: 'Echo 3 level',
      min: 0,
      max: 1,
      default: 0.35,
    },
    {
      type: 'float',
      id: 'feedback',
      label: 'Feedback',
      min: 0,
      max: 0.92,
      default: 0.48,
    },
    { type: 'float', id: 'tone', label: 'Tone', min: 0, max: 1, default: 0.55 },
    {
      type: 'float',
      id: 'motion',
      label: 'Motion',
      min: 0,
      max: 1,
      default: 0.18,
    },
    {
      type: 'float',
      id: 'spread',
      label: 'Spread',
      min: 0,
      max: 1,
      default: 0.75,
    },
    { type: 'float', id: 'mix', label: 'Mix', min: 0, max: 1, default: 0.6 },
    { type: 'bool', id: 'sync', label: 'Tempo sync', default: true },
    { type: 'bool', id: 'hold', label: 'Hold', default: false },
    { type: 'bool', id: 'bypass', label: 'Bypass', default: false },
  ],
});
