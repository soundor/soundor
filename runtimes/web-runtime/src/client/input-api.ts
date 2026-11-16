/** Browser input API; the implementation and Vite integration remain private. */
export { defineInput, oscillator, audioFile, microphone } from './input';
export type {
  BuiltinInput,
  WebInput,
  WebAudioInput,
  WebAudioInputContext,
  WebAudioCleanup,
  WebAudioInputInfo,
} from './input';
