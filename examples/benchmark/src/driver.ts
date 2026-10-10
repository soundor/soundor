// Runs scenarios one at a time and measures their frames: what each frame
// function cost in JavaScript (and, for Three.js, its update and render), and
// how often frames came. soundor_run_ui measures the same frames natively,
// per phase: the driver names each measured scenario in
// globalThis.soundorRunUiPhase.

import type { FrameFunction, Group, Scenario } from './scenarios';

/** What one scenario cost over a run of frames. */
export interface Result {
  scenario: string;
  group: Group;
  frames: number;
  fps: number;
  /** JavaScript time per frame in the scenario's frame function (ms). */
  scriptAverage: number;
  scriptP95: number;
  /** ... of which in the scenario's own update, when it says (Three.js). */
  updateAverage: number;
  /** ... and the rest: rendering (Three, and the calls it makes). */
  renderAverage: number;
  drawCalls: number;
  triangles: number;
}

/** Frames between updates of the live statistics (4 per second at 60 fps). */
export const STATS_INTERVAL = 15;

const average = (values: readonly number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Frame timings, kept for one scenario. */
class Meter {
  script: number[] = [];
  update: number[] = [];
  intervals: number[] = [];
  drawCalls = 0;
  triangles = 0;
  last = 0;

  add(script: number, update: number, now: number): void {
    this.script.push(script);
    this.update.push(update);
    if (this.last > 0) this.intervals.push(now - this.last);
    this.last = now;
    for (const list of [this.script, this.update, this.intervals]) {
      if (list.length > 600) list.shift();
    }
  }

  summary(scenario: Scenario): Result {
    const sorted = [...this.script].sort((a, b) => a - b);
    const interval = average(this.intervals);
    const script = average(this.script);
    const update = average(this.update);
    return {
      scenario: scenario.id,
      group: scenario.group,
      frames: this.script.length,
      fps: interval > 0 ? 1000 / interval : 0,
      scriptAverage: script,
      scriptP95:
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ??
        0,
      updateAverage: update,
      renderAverage: script - update,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
    };
  }
}

declare global {
  // What soundor_run_ui reports the frames under (a scenario being measured).
  var soundorRunUiPhase: string | undefined;
}

export class Driver {
  private activate: (scenario: Scenario) => void = () => {};
  private onStats: (() => void) | null = null;

  private frame: FrameFunction | null = null;
  private meter = new Meter();
  private started = 0;
  private frames = 0;
  private handle = 0;
  /** Called after each measured frame (for a run of several scenarios). */
  private onFrame: (() => void) | null = null;

  /** `current` is the scenario the app shows first. */
  constructor(public current: Scenario) {
    const tick = () => {
      this.run();
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  /**
   * Connects the app: `activate` shows a scenario on the stage (the app's
   * state), `onStats` is called every STATS_INTERVAL frames.
   */
  attach(activate: (scenario: Scenario) => void, onStats: () => void): void {
    this.activate = activate;
    this.onStats = onStats;
  }

  /** The stage's frame function, once it is ready (stable: a stage prop). */
  readonly register = (frame: FrameFunction): void => {
    this.frame = frame;
    this.meter = new Meter();
    this.started = performance.now();
  };

  show(scenario: Scenario): void {
    if (scenario === this.current && this.frame !== null) {
      // Already running (its stage will not register again): start over.
      this.meter = new Meter();
      this.started = performance.now();
      return;
    }
    // Until the new stage registers, no frame runs or counts.
    this.frame = null;
    this.current = scenario;
    this.activate(scenario);
  }

  result(): Result {
    return this.meter.summary(this.current);
  }

  /**
   * `scenarios` one after the other, each for `frames` frames after
   * `warmup` (shader compiling, first uploads), then the results in order.
   */
  runAll(
    scenarios: readonly Scenario[],
    frames = 120,
    warmup = 30,
  ): Promise<Result[]> {
    const results: Result[] = [];
    let index = -1;
    let count = 0;
    return new Promise((resolve) => {
      const next = () => {
        index++;
        globalThis.soundorRunUiPhase = undefined;
        if (index >= scenarios.length) {
          this.onFrame = null;
          resolve(results);
          return;
        }
        count = 0;
        this.show(scenarios[index]!);
      };
      this.onFrame = () => {
        count++;
        // soundor_run_ui reports its own timings of these frames per phase.
        if (count === warmup) {
          this.meter = new Meter();
          globalThis.soundorRunUiPhase = scenarios[index]!.id;
        }
        if (count === warmup + frames) {
          results.push(this.meter.summary(scenarios[index]!));
          next();
        }
      };
      next();
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.handle);
    this.frame = null;
    this.onFrame = null;
  }

  private run(): void {
    const frame = this.frame;
    if (frame === null) return;
    const begin = performance.now();
    const report = frame((begin - this.started) / 1000) ?? {};
    const end = performance.now();
    this.meter.add(end - begin, report.update ?? 0, end);
    if (report.drawCalls !== undefined) this.meter.drawCalls = report.drawCalls;
    if (report.triangles !== undefined) this.meter.triangles = report.triangles;
    // The live statistics are for watching; a run of scenarios does not
    // update them, so what the view draws depends on the scenario alone.
    if (++this.frames % STATS_INTERVAL === 0 && this.onFrame === null)
      this.onStats?.();
    this.onFrame?.();
  }
}
