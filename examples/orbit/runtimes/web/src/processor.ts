import { Delay, type DelaySettings } from './delay';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

class OrbitProcessor extends AudioWorkletProcessor {
  private readonly delay = new Delay(sampleRate);
  private settings: DelaySettings = {
    times: [0.375, 0.75, 1.125],
    levels: [0.8, 0.55, 0.35],
    feedback: 0.48,
    tone: 0.55,
    motion: 0.18,
    spread: 0.75,
    mix: 0.35,
    hold: false,
    bypass: false,
  };

  constructor() {
    super();
    this.delay.configure(this.settings);
    this.port.onmessage = (event: MessageEvent<DelaySettings>) => {
      this.settings = event.data;
      this.delay.configure(this.settings);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0],
      output = outputs[0];
    if (!output?.[0]) return true;
    for (let i = 0; i < output[0].length; i++) {
      const left = input?.[0]?.[i] ?? 0;
      this.delay.tick(left, input?.[1]?.[i] ?? left, this.settings);
      output[0][i] = this.delay.left;
      if (output[1]) output[1][i] = this.delay.right;
    }
    return true;
  }
}

registerProcessor('orbit-delay', OrbitProcessor);
