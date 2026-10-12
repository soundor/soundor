import {
  sampleSpring,
  springDuration,
  springParameters,
} from '@soundor/core/spring';

import type { TestNode } from './node';
import type { TestRuntime } from './runtime';
import type {
  AnimationDescription,
  AnimationKeyframe,
  AnimationOptions,
  UiAnimation,
} from './types';

type Values = Record<string, unknown>;
interface Phase {
  span: number;
  duration: number;
  options: AnimationOptions;
  node?: TestNode;
  frames?: readonly AnimationKeyframe[];
  before?: Values;
  children: { start: number; phase: Phase }[];
  owned?: Map<TestNode, Set<string>>;
}
const PROPERTIES = [
  'opacity',
  'transform',
  'backgroundColor',
  'borderColor',
] as const;
const finite = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError(`${name} must be finite and nonnegative`);
  return value;
};
function settings(options: AnimationOptions): AnimationOptions {
  const out = {
    duration: 300,
    delay: 0,
    iterations: 1,
    direction: 'normal' as const,
    fill: 'none' as const,
    easing: 'linear' as const,
    ...options,
  };
  finite(out.duration, 'duration');
  finite(out.delay, 'delay');
  if (
    typeof out.iterations !== 'number' ||
    Number.isNaN(out.iterations) ||
    out.iterations < 0
  )
    throw new TypeError('invalid animation iterations');
  if (
    !['normal', 'reverse', 'alternate', 'alternate-reverse'].includes(
      out.direction,
    )
  )
    throw new TypeError('invalid animation direction');
  if (!['none', 'both', 'forwards', 'backwards'].includes(out.fill))
    throw new TypeError('invalid animation fill');
  if (
    !['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(
      out.easing,
    )
  )
    throw new TypeError('invalid animation easing');
  if (out.type !== undefined && !['timing', 'spring'].includes(out.type))
    throw new TypeError('invalid animation type');
  if (out.type === 'spring') springParameters(out);
  return out;
}
/** CSS standard cubic curves, evaluated without frame integration. */
function ease(name: AnimationOptions['easing'], value: number): number {
  if (!name || name === 'linear') return value;
  const points = {
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  }[name]!;
  const curve = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0,
    high = 1;
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (curve(middle, points[0]!, points[2]!) < value) low = middle;
    else high = middle;
  }
  return curve((low + high) / 2, points[1]!, points[3]!);
}
function validateTransforms(items: unknown) {
  if (!Array.isArray(items) || items.length > 6)
    throw new TypeError('invalid animation transform');
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Object.keys(item).length !== 1)
      throw new TypeError('transform requires one operation per entry');
    const [key, value] = Object.entries(item)[0]!;
    if (
      ![
        'translateX',
        'translateY',
        'scale',
        'scaleX',
        'scaleY',
        'rotate',
      ].includes(key) ||
      seen.has(key)
    )
      throw new TypeError('unsupported or duplicated transform operation');
    seen.add(key);
    if (typeof value === 'number' && Number.isFinite(value)) continue;
    if (
      key === 'rotate' &&
      typeof value === 'string' &&
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:deg|rad)$/.test(value)
    )
      continue;
    throw new TypeError('transform requires a finite number or angle');
  }
}
function blend(property: string, a: unknown, b: unknown, t: number): unknown {
  if (property === 'opacity')
    return Math.min(1, Math.max(0, Number(a) + (Number(b) - Number(a)) * t));
  if (property === 'transform') {
    const before = (a ?? []) as Record<string, number | string>[];
    const after = (b ?? []) as Record<string, number | string>[];
    const keys = [...new Set([...before, ...after].flatMap(Object.keys))];
    const read = (items: typeof before, key: string) => {
      const value =
        items.find((item) => key in item)?.[key] ??
        (key.startsWith('scale') ? 1 : 0);
      return typeof value === 'string'
        ? parseFloat(value) * (value.endsWith('deg') ? Math.PI / 180 : 1)
        : value;
    };
    return keys.map((key) => ({
      [key]: read(before, key) + (read(after, key) - read(before, key)) * t,
    }));
  }
  if (t === 0) return a;
  if (t === 1) return b;
  const color = (value: unknown) => {
    if (value === 'transparent' || value === undefined) return [0, 0, 0, 0];
    const hex = /^#([a-f\d]{3,8})$/i.exec(String(value))?.[1];
    if (!hex || ![3, 4, 6, 8].includes(hex.length))
      throw new TypeError(
        'simulated paint animations require hex colors or transparent',
      );
    const full = hex.length < 5 ? [...hex].map((x) => x + x).join('') : hex;
    return [0, 2, 4]
      .map((i) => parseInt(full.slice(i, i + 2), 16))
      .concat(full.length === 8 ? parseInt(full.slice(6), 16) : 255);
  };
  const from = color(a),
    to = color(b);
  return (
    '#' +
    from
      .map((x, i) =>
        Math.round(x + (to[i]! - x) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function offsets(frames: readonly AnimationKeyframe[]): number[] {
  const out = frames.map((frame) => frame.offset ?? NaN);
  if (Number.isNaN(out[0]!)) out[0] = 0;
  if (Number.isNaN(out.at(-1)!)) out[out.length - 1] = 1;
  let start = 0;
  for (let end = 1; end < out.length; end++)
    if (!Number.isNaN(out[end]!)) {
      if (out[end]! < out[start]!)
        throw new TypeError('animation offsets must be nondecreasing');
      for (let i = start + 1; i < end; i++)
        out[i] =
          out[start]! +
          ((out[end]! - out[start]!) * (i - start)) / (end - start);
      start = end;
    }
  return out;
}
function sample(
  phase: Phase,
  time: number,
  state: Map<TestNode, Values>,
  final = false,
) {
  const { options, duration } = phase;
  const elapsed = final
    ? duration *
      (Number.isFinite(options.iterations ?? 1) ? (options.iterations ?? 1) : 1)
    : Math.max(0, time - (options.delay ?? 0));
  const iterations =
    final && options.iterations === Infinity ? 1 : (options.iterations ?? 1);
  const total = duration === 0 ? 0 : duration * iterations;
  const done = elapsed >= total;
  const index =
    duration === 0
      ? 0
      : done && Number.isFinite(total)
        ? Math.max(0, Math.ceil(iterations) - 1)
        : Math.floor(elapsed / duration);
  let progress =
    duration === 0
      ? 1
      : done && Number.isFinite(total)
        ? iterations - index
        : (elapsed / duration) % 1;
  const direction = options.direction;
  if (
    (direction === 'reverse' || direction === 'alternate-reverse') !==
    ((direction === 'alternate' || direction === 'alternate-reverse') &&
      index % 2 === 1)
  )
    progress = 1 - progress;
  progress = ease(
    options.type === 'spring' ? 'linear' : options.easing,
    progress,
  );
  if (phase.node && phase.frames) {
    const values = state.get(phase.node) ?? {};
    const frames =
      phase.frames.length === 1
        ? ([phase.before!, phase.frames[0]!] as AnimationKeyframe[])
        : phase.frames;
    const positions = offsets(frames);
    for (const property of PROPERTIES) {
      const track = frames
        .map((frame, i) => ({
          value: frame[property],
          at: positions[i]!,
          easing: frame.easing,
        }))
        .filter((point) => point.value !== undefined);
      if (!track.length) continue;
      if (track[0]!.at > 0)
        track.unshift({
          value: phase.before![property] as never,
          at: 0,
          easing: undefined,
        });
      if (track.at(-1)!.at < 1) track.push({ ...track.at(-1)!, at: 1 });
      let right = track.findIndex((point) => point.at >= progress);
      if (right < 0) right = track.length - 1;
      const after = track[right]!,
        before = track[Math.max(0, right - 1)]!;
      let t =
        after.at === before.at
          ? 1
          : ease(
              before.easing,
              (progress - before.at) / (after.at - before.at),
            );
      if (options.type === 'spring' && !done)
        t = sampleSpring(
          springParameters(options),
          (progress * duration) / 1000,
          0,
          1,
          options.initialVelocity ?? 0,
        ).position;
      values[property] = blend(property, before.value, after.value, t);
    }
    state.set(phase.node, values);
  } else
    for (const child of phase.children) {
      const local =
        (Number.isFinite(duration) ? progress * duration : elapsed) -
        child.start;
      if (final || local >= 0)
        sample(
          child.phase,
          final ? child.phase.span : Math.min(local, child.phase.span),
          state,
          final,
        );
    }
}
export class TestAnimation implements UiAnimation {
  playState: UiAnimation['playState'] = 'running';
  finished!: Promise<void>;
  private resolve!: () => void;
  private reject!: (reason: Error) => void;
  private time = 0;
  readonly owned = new Map<TestNode, Set<string>>();
  readonly values = new Map<TestNode, Values>();
  private phase: Phase;
  readonly before: Values;
  constructor(
    readonly runtime: TestRuntime,
    node: TestNode,
    readonly keyframes: readonly AnimationKeyframe[] | AnimationDescription,
    readonly options: AnimationOptions,
  ) {
    this.before = { ...runtime.presentation(node) };
    let count = 0;
    const virtual = new Map<TestNode, Values>();
    const compile = (
      input: AnimationDescription,
      fallback: TestNode,
      depth = 0,
    ): Phase => {
      if (depth > 64 || ++count > 16384)
        throw new TypeError('animation composition exceeds its limits');
      if (input.kind === 'delay')
        return {
          span: finite(input.duration, 'delay'),
          duration: input.duration,
          options: { iterations: 1 },
          children: [],
        };
      const opts = settings(input.options ?? {});
      const phase: Phase = {
        span: 0,
        duration: 0,
        options: opts,
        children: [],
      };
      if ('keyframes' in input) {
        const target = input.target ?? fallback;
        if (target.runtime !== runtime)
          throw new TypeError('animation target belongs to another runtime');
        if (!input.keyframes.length || input.keyframes.length > 4096)
          throw new TypeError('animate requires 1 to 4096 keyframes');
        offsets(input.keyframes);
        for (const frame of input.keyframes) {
          for (const key of Object.keys(frame))
            if (![...PROPERTIES, 'offset', 'easing'].includes(key))
              throw new TypeError(`unsupported animation property ${key}`);
          if (frame.transform !== undefined)
            validateTransforms(frame.transform);
          if (frame.easing !== undefined) settings({ easing: frame.easing });
          if (frame.opacity !== undefined && !Number.isFinite(frame.opacity))
            throw new TypeError('invalid opacity');
          if (frame.offset !== undefined) {
            finite(frame.offset, 'offset');
            if (frame.offset > 1) throw new TypeError('offset exceeds one');
          }
        }
        phase.node = target;
        phase.frames = input.keyframes.map((frame) => ({
          ...frame,
          ...(frame.transform
            ? {
                transform: frame.transform.map((operation) => ({
                  ...operation,
                })),
              }
            : {}),
        }));
        phase.before = {
          opacity: 1,
          transform: [],
          ...runtime.presentation(target),
          ...virtual.get(target),
        };
        const properties = new Set(
          input.keyframes.flatMap((frame) =>
            PROPERTIES.filter((p) => frame[p] !== undefined),
          ),
        );
        if (!properties.size)
          throw new TypeError('animation must name supported properties');
        if (
          opts.type === 'spring' &&
          (input.keyframes.length > 2 ||
            properties.has('backgroundColor') ||
            properties.has('borderColor'))
        )
          throw new TypeError('springs require numeric origin and target');
        phase.owned = new Map([[target, properties]]);
        this.owned.set(
          target,
          new Set([...(this.owned.get(target) ?? []), ...properties]),
        );
        phase.duration =
          opts.type === 'spring'
            ? springDuration(
                springParameters(opts),
                0,
                1,
                opts.initialVelocity ?? 0,
              )
            : opts.duration!;
      } else {
        if (input.children.length === 0) phase.duration = 0;
        for (const [i, child] of input.children.entries()) {
          const compiled = compile(child, fallback, depth + 1);
          const start =
            input.kind === 'sequence'
              ? phase.duration
              : input.kind === 'stagger'
                ? i * finite(input.stagger ?? 0, 'stagger')
                : 0;
          if (!Number.isFinite(start))
            throw new TypeError('infinite sequence phase must be last');
          phase.owned ??= new Map();
          for (const [target, properties] of compiled.owned ?? []) {
            const owned = phase.owned.get(target) ?? new Set<string>();
            if (
              input.kind !== 'sequence' &&
              [...properties].some((property) => owned.has(property))
            )
              throw new TypeError(
                'parallel animation children must own disjoint properties',
              );
            phase.owned.set(target, new Set([...owned, ...properties]));
          }
          phase.children.push({ start, phase: compiled });
          phase.duration = Math.max(phase.duration, start + compiled.span);
          if (input.kind === 'sequence')
            sample(compiled, compiled.span, virtual, true);
        }
      }
      if (
        !Number.isFinite(phase.duration) &&
        ((opts.direction ?? 'normal') !== 'normal' || opts.iterations !== 1)
      )
        throw new TypeError(
          'infinite compositions require normal direction and one iteration',
        );
      phase.span =
        (opts.delay ?? 0) +
        (phase.duration === 0 ? 0 : phase.duration * (opts.iterations ?? 1));
      return phase;
    };
    const description = Array.isArray(keyframes)
      ? { keyframes, options }
      : (keyframes as AnimationDescription);
    this.phase = compile(description as AnimationDescription, node);
    if (!Array.isArray(keyframes) && Object.keys(options).length) {
      const opts = settings(options);
      opts.duration = this.phase.span;
      this.phase = {
        options: opts,
        children: [{ start: 0, phase: this.phase }],
        duration: this.phase.span,
        span: opts.delay! + this.phase.span * opts.iterations!,
      };
    }
    this.promise();
    this.update();
  }
  private promise() {
    this.finished = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.finished.catch(() => {});
  }
  get currentTime() {
    return this.time;
  }
  set currentTime(value: number) {
    finite(value, 'currentTime');
    if (this.playState === 'finished' && value < this.phase.span) {
      this.promise();
      this.playState = 'paused';
    }
    this.time = Math.min(value, this.phase.span);
    this.update();
  }
  tick(milliseconds: number) {
    if (this.playState === 'running') {
      this.time = Math.min(this.time + milliseconds, this.phase.span);
      this.update();
    }
  }
  private update(final = false) {
    this.values.clear();
    const fill = this.phase.options.fill;
    if (
      this.time >= (this.phase.options.delay ?? 0) ||
      fill === 'backwards' ||
      fill === 'both'
    )
      sample(this.phase, this.time, this.values, final);
    if (this.time >= this.phase.span || final) {
      this.playState = 'finished';
      if (fill !== 'forwards' && fill !== 'both') this.values.clear();
      this.resolve();
    }
  }
  play() {
    if (this.playState === 'idle' || this.playState === 'finished') {
      this.time = 0;
      this.promise();
    }
    this.playState = 'running';
    this.update();
  }
  resume() {
    this.play();
  }
  pause() {
    if (this.playState === 'running') this.playState = 'paused';
  }
  cancel() {
    if (this.playState === 'idle') return;
    this.playState = 'idle';
    this.values.clear();
    const error = new Error('Animation cancelled');
    error.name = 'AbortError';
    this.reject(error);
  }
  finish() {
    if (!Number.isFinite(this.phase.span))
      throw new Error('cannot finish an infinite animation');
    this.time = this.phase.span;
    this.update();
  }
  reduceMotion() {
    this.update(true);
  }
}
