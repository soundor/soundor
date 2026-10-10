// What a benchmark scenario is: a view mounted on the stage, and the work it
// does every frame. The bench (src/bench.ts) runs scenarios one at a time and
// measures their frames; soundor_run_ui measures the same frames natively.

import type { ComponentType } from 'react';

/**
 * - webgl-stress: Three.js scenes that stress one thing on purpose (draw
 *   calls, uploads, vertices moved by JavaScript): the worst case.
 * - webgl: the same visuals the way a plugin should draw them (the GPU does
 *   the per-frame work), and raw WebGL calls.
 * - canvas: Canvas 2D drawing.
 * - ui: React and soundor:ui updates, and a UI that does not change.
 * - mixed: a plugin-like view with a bit of everything.
 */
export type Group = 'webgl-stress' | 'webgl' | 'canvas' | 'ui' | 'mixed';

export const GROUPS: readonly Group[] = [
  'webgl-stress',
  'webgl',
  'canvas',
  'ui',
  'mixed',
];

/** What a frame did, as far as the scenario knows. */
export interface FrameReport {
  /** Time spent in the scenario's own update, if it splits it out (ms). */
  update?: number;
  /** Three's draw calls and triangles this frame. */
  drawCalls?: number;
  triangles?: number;
}

/**
 * Runs one frame: `time` is in seconds since the scenario started. All of a
 * frame's work happens inside the call (React updates are flushed), so the
 * bench can time it.
 */
export type FrameFunction = (time: number) => FrameReport | void;

export interface StageProps {
  scenario: Scenario;
  /** Called with the frame function once the stage is ready to run. */
  register(frame: FrameFunction): void;
}

export interface Scenario {
  /** Unique: the name results and phases are reported under. */
  readonly id: string;
  readonly group: Group;
  readonly label: string;
  /** What the scenario measures. */
  readonly stresses: string;
  /** The view it runs in, mounted while it runs. */
  readonly Stage: ComponentType<StageProps>;
  /**
   * Scenarios with the same stage key share one mounted stage (and so one
   * WebGL context): the stage switches between them. Default: the id.
   */
  readonly stageKey?: string;
}

/** The stage's size, in view pixels. */
export const STAGE_WIDTH = 640;
export const STAGE_HEIGHT = 360;
