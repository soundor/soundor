/** The browser's DSP. Plain JavaScript in an AudioWorklet, never on the UI thread. */
export interface DelaySettings {
  times: number[];
  levels: number[];
  feedback: number;
  tone: number;
  motion: number;
  spread: number;
  mix: number;
  hold: boolean;
  bypass: boolean;
}

export class Delay {
  left = 0;
  right = 0;
  private readonly capacity: number;
  private readonly buffers: Float32Array[];
  private readonly delays: number[];
  private readonly filtered = [0, 0, 0];
  private readonly levels = [0.8, 0.55, 0.35];
  private feedback = 0.48;
  private motion = 0.18;
  private spread = 0.75;
  private readonly starts = [0, 0, 0];
  private readonly lengths = [1, 1, 1];
  private readonly phases = [0, 0, 0];
  private write = 0;
  private clock = 0;
  private held = false;
  private blend = 0;
  private wet = 0;
  private cutoff = 0.1;
  private readonly smooth: number;

  constructor(private readonly rate: number) {
    this.capacity = Math.ceil(rate * 10) + 2;
    this.buffers = [0, 1, 2].map(() => new Float32Array(this.capacity));
    this.delays = [rate * 0.375, rate * 0.75, rate * 1.125];
    this.smooth = 1 - Math.exp(-1 / (0.02 * rate));
  }

  configure(settings: DelaySettings) {
    this.cutoff =
      1 -
      Math.exp(
        (-2 * Math.PI * Math.min(this.rate * 0.45, 400 * 30 ** settings.tone)) /
          this.rate,
      );
  }

  private read(voice: number, position: number): number {
    const wrapped =
      ((position % this.capacity) + this.capacity) % this.capacity;
    const index = Math.floor(wrapped);
    const fraction = wrapped - index;
    const buffer = this.buffers[voice]!;
    return (
      buffer[index]! * (1 - fraction) +
      buffer[(index + 1) % this.capacity]! * fraction
    );
  }

  tick(left: number, right: number, settings: DelaySettings): void {
    if (settings.hold && !this.held) {
      for (let i = 0; i < 3; i++) {
        this.lengths[i] = Math.max(128, Math.round(this.delays[i]!));
        this.starts[i] = this.write - this.lengths[i]!;
        this.phases[i] = 0;
      }
    }
    this.held = settings.hold;
    this.feedback += (settings.feedback - this.feedback) * this.smooth;
    this.motion += (settings.motion - this.motion) * this.smooth;
    this.spread += (settings.spread - this.spread) * this.smooth;
    let wetLeft = 0,
      wetRight = 0;
    for (let i = 0; i < 3; i++) {
      const target = Math.max(
        128,
        Math.min(this.capacity - 2, settings.times[i]! * this.rate),
      );
      this.delays[i]! += (target - this.delays[i]!) * this.smooth;
      const drift =
        Math.sin(this.clock * (0.7 + i * 0.13) + i * 2.1) *
        this.motion *
        this.rate *
        0.003;
      let echo: number;
      if (this.held) {
        const phase = this.phases[i]!;
        const length = this.lengths[i]!;
        echo = this.read(i, this.starts[i]! + phase);
        if (phase > length - 64) {
          const fade = (phase - length + 64) / 64;
          echo =
            echo * (1 - fade) +
            this.read(i, this.starts[i]! + phase - length + 64) * fade;
        }
        this.phases[i] =
          phase +
          (this.lengths[i]! / this.delays[i]!) * (1 + (drift / this.rate) * 5);
        if (this.phases[i]! >= length)
          this.phases[i] = 64 + ((this.phases[i]! - length) % (length - 64));
      } else {
        echo = this.read(i, this.write - this.delays[i]! + drift);
      }
      this.filtered[i]! += (echo - this.filtered[i]!) * this.cutoff;
      if (!this.held)
        this.buffers[i]![this.write] = Math.tanh(
          (left + right) * 0.5 + this.filtered[i]! * this.feedback,
        );
      this.levels[i]! += (settings.levels[i]! - this.levels[i]!) * this.smooth;
      const pan = (i - 1) * this.spread;
      const voice = this.filtered[i]! * this.levels[i]! * 0.6;
      wetLeft += voice * Math.sqrt((1 - pan) * 0.5);
      wetRight += voice * Math.sqrt((1 + pan) * 0.5);
    }
    if (!this.held) this.write = (this.write + 1) % this.capacity;
    this.clock += 1 / this.rate;
    this.wet += (settings.mix - this.wet) * this.smooth;
    this.blend += ((settings.bypass ? 0 : 1) - this.blend) * this.smooth;
    const mix = this.wet * this.blend;
    this.left = left * (1 - mix) + wetLeft * mix;
    this.right = right * (1 - mix) + wetRight * mix;
  }
}
