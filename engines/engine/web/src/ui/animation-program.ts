import {
  keyframes,
  standardEase,
  timing,
  transformText,
  transformValues,
  type AnimationController,
  type ManagedAnimation,
} from './animation';
import type { UiElement } from './node';
import type {
  AnimationDescription,
  AnimationOptions,
  UiAnimation,
} from './types';

interface Phase {
  kind: 'effect' | 'sequence' | 'parallel' | 'stagger' | 'delay';
  settings: Required<AnimationOptions>;
  span: number;
  element?: UiElement;
  frames?: Keyframe[];
  children: Phase[];
  starts: number[];
  owned: Map<UiElement, Set<string>>;
}
export interface CompiledProgram {
  settings: Required<AnimationOptions>;
  span: number;
  finiteSpan: number;
  prefix: number;
  delay: number;
  period: number;
  owned: Map<UiElement, Set<string>>;
  curves: Map<
    UiElement,
    { prefix: Keyframe[]; cycle: Keyframe[]; final: Keyframe }
  >;
}

const MAX_PHASES = 16384;
const MAX_POINTS = 1_000_000;

/** Compile once into browser-owned curves. Playback never evaluates this tree in JS. */
export function compileProgram(
  controller: AnimationController,
  defaultElement: UiElement,
  description: AnimationDescription,
  options: AnimationOptions,
): CompiledProgram {
  const initial = new Map<UiElement, Keyframe>();
  const virtual = new Map<UiElement, Keyframe>();
  const colors = new Map<string, number[]>();
  const prepared = new Map<UiElement, Set<string>>();
  let count = 0;
  const color = (input: unknown, element: UiElement): number[] => {
    const text = String(input);
    const cached = colors.get(text);
    if (cached) return cached;
    let value: number[];
    const hex = /^#([\da-f]{3,8})$/i.exec(text)?.[1];
    if (text === 'transparent') value = [0, 0, 0, 0];
    else if (hex && [3, 4, 6, 8].includes(hex.length)) {
      const full =
        hex.length <= 4
          ? [...hex].map((letter) => letter + letter).join('')
          : hex;
      value = [0, 2, 4].map((index) =>
        Number.parseInt(full.slice(index, index + 2), 16),
      );
      value.push(
        full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1,
      );
    } else {
      const probe = element.ownerDocument.createElement('span');
      probe.style.color = text;
      element.ownerDocument.body.append(probe);
      const resolved =
        element.ownerDocument.defaultView!.getComputedStyle(probe).color;
      probe.remove();
      if (!/^rgba?\(/.test(resolved))
        throw new TypeError('composition paint requires an sRGB color');
      const parts = resolved.match(/[\d.]+/g)?.map(Number);
      if (!parts || parts.length < 3)
        throw new TypeError('composition paint requires an sRGB color');
      value = [...parts.slice(0, 3), parts[3] ?? 1];
    }
    colors.set(text, value);
    return value;
  };
  const blend = (
    property: string,
    from: unknown,
    to: unknown,
    progress: number,
    element: UiElement,
  ): string | number => {
    if (property === 'opacity')
      return Number(from) + (Number(to) - Number(from)) * progress;
    if (property === 'transform') {
      const before = transformValues(from),
        after = transformValues(to);
      if (!before || !after || before.length !== after.length)
        throw new TypeError('composed transforms require supported operations');
      return transformText(
        before.map((entry, i) => ({
          key: entry.key,
          value: entry.value + (after[i]!.value - entry.value) * progress,
        })),
      );
    }
    const before = color(from, element),
      after = color(to, element);
    const channels = before.map(
      (value, i) => value + (after[i]! - value) * progress,
    );
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${channels[3]})`;
  };
  const progress = (phase: Phase, time: number, finite = false): number => {
    const { duration, delay, direction = 'normal' } = phase.settings;
    const iterations =
      finite && !Number.isFinite(phase.settings.iterations ?? 1)
        ? 1
        : (phase.settings.iterations ?? 1);
    const elapsed = Math.max(0, time - delay),
      total = duration === 0 || iterations === 0 ? 0 : duration * iterations;
    const done = elapsed >= total - 1e-7;
    const iteration =
      duration === 0
        ? 0
        : done && Number.isFinite(total)
          ? Math.max(0, Math.ceil(iterations) - 1)
          : Math.floor(elapsed / duration);
    let value =
      duration === 0
        ? 1
        : done && Number.isFinite(total)
          ? iterations === 0
            ? 0
            : iterations - iteration
          : (elapsed / duration) % 1;
    const reverse =
      (direction === 'reverse' || direction === 'alternate-reverse') !==
      ((direction === 'alternate' || direction === 'alternate-reverse') &&
        iteration % 2 === 1);
    if (reverse) value = 1 - value;
    return standardEase(
      phase.settings.type === 'spring' ? 'linear' : phase.settings.easing,
      value,
    );
  };
  const apply = (
    phase: Phase,
    time: number,
    state: Map<UiElement, Keyframe>,
    finite = false,
  ): void => {
    if (phase.kind === 'effect') {
      const value = progress(phase, time, finite),
        element = phase.element!,
        target = state.get(element)!;
      for (const property of phase.owned.get(element)!) {
        const frames = phase.frames!.filter(
          (frame) => frame[property] !== undefined,
        );
        let lower = frames[0]!,
          upper = frames.at(-1)!;
        for (const frame of frames) {
          if (Number(frame.offset) <= value) lower = frame;
          else {
            upper = frame;
            break;
          }
        }
        const a = Number(lower.offset),
          b = Number(upper.offset);
        const local =
          a === b
            ? 0
            : standardEase(
                lower.easing ?? 'linear',
                Math.min(1, Math.max(0, (value - a) / (b - a))),
              );
        target[property] = blend(
          property,
          lower[property],
          upper[property],
          local,
          element,
        );
      }
      return;
    }
    const duration =
      finite && !Number.isFinite(phase.settings.duration)
        ? finiteDuration(phase)
        : phase.settings.duration;
    const local = Number.isFinite(duration)
      ? progress(
          { ...phase, settings: { ...phase.settings, duration } },
          time,
          finite,
        ) * duration
      : Math.max(0, time - phase.settings.delay);
    for (let i = 0; i < phase.children.length; i++) {
      if (local < phase.starts[i]!) break;
      const child = phase.children[i]!;
      apply(
        child,
        Math.min(
          local - phase.starts[i]!,
          finite ? finiteSpan(child) : child.span,
        ),
        state,
        finite,
      );
      if (
        phase.kind === 'sequence' &&
        local < phase.starts[i]! + (finite ? finiteSpan(child) : child.span)
      )
        break;
    }
  };
  const finiteDuration = (phase: Phase): number =>
    phase.kind === 'effect' || phase.kind === 'delay'
      ? phase.settings.duration
      : phase.kind === 'sequence'
        ? phase.children.reduce((sum, child) => sum + finiteSpan(child), 0)
        : Math.max(
            0,
            ...phase.children.map(
              (child, i) => phase.starts[i]! + finiteSpan(child),
            ),
          );
  const finiteSpan = (phase: Phase): number =>
    Number.isFinite(phase.span)
      ? phase.span
      : finiteDuration(phase) + phase.settings.delay;
  const compile = (
    input: AnimationDescription,
    depth: number,
    root = false,
  ): Phase => {
    if (
      !input ||
      typeof input !== 'object' ||
      depth > 64 ||
      ++count > MAX_PHASES
    )
      throw new TypeError(
        'animation composition exceeds its depth or phase limit',
      );
    const before = new Map(
      [...virtual].map(([element, frame]) => [element, { ...frame }]),
    );
    const kind = input.kind ?? 'effect';
    const settings = timing({
      ...('options' in input ? input.options : {}),
      ...(root ? options : {}),
    });
    const phase: Phase = {
      kind,
      settings,
      span: 0,
      children: [],
      starts: [],
      owned: new Map(),
    };
    if (kind === 'effect' && 'keyframes' in input) {
      const element =
        input.target?.animationElement(controller) ?? defaultElement;
      if (!initial.has(element)) {
        const snapshot = controller.snapshot(element);
        initial.set(element, snapshot);
        virtual.set(element, { ...snapshot });
      }
      const normalized = keyframes(input.keyframes);
      const frames = controller.prepare(
        element,
        normalized.frames,
        normalized.properties,
        settings,
        virtual.get(element)!,
        undefined,
        [...normalized.properties].some((property) =>
          prepared.get(element)?.has(property),
        )
          ? []
          : controller.existing(element),
      );
      const used = prepared.get(element) ?? new Set<string>();
      for (const property of normalized.properties) used.add(property);
      prepared.set(element, used);
      frames.forEach((frame, i) => {
        frame.offset ??= i / (frames.length - 1);
      });
      phase.element = element;
      phase.frames = frames;
      phase.owned.set(element, normalized.properties);
      apply(
        phase,
        settings.duration *
          (Number.isFinite(settings.iterations ?? 1)
            ? (settings.iterations ?? 1)
            : 1) +
          settings.delay,
        virtual,
        true,
      );
    } else if (kind === 'delay' && 'duration' in input) {
      settings.duration = input.duration;
      if (!Number.isFinite(input.duration) || input.duration < 0)
        throw new TypeError('delay requires a finite nonnegative duration');
    } else if (
      'children' in input &&
      ['sequence', 'parallel', 'stagger'].includes(kind)
    ) {
      if (settings.type === 'spring')
        throw new TypeError('composition options cannot be springs');
      if (!Array.isArray(input.children) || input.children.length === 0)
        throw new TypeError('composition children must be an array');
      const gap = input.stagger ?? 0;
      if (!Number.isFinite(gap) || gap < 0)
        throw new TypeError('stagger requires a finite nonnegative interval');
      let cursor = 0;
      for (let i = 0; i < input.children.length; i++) {
        if (kind === 'sequence' && !Number.isFinite(cursor))
          throw new TypeError('an infinite sequence phase must be last');
        const child = compile(input.children[i]!, depth + 1);
        const start =
          kind === 'sequence' ? cursor : kind === 'stagger' ? i * gap : 0;
        phase.children.push(child);
        phase.starts.push(start);
        cursor =
          kind === 'sequence'
            ? cursor + child.span
            : Math.max(cursor, start + child.span);
        for (const [element, properties] of child.owned) {
          const owned = phase.owned.get(element) ?? new Set<string>();
          if (
            kind !== 'sequence' &&
            [...properties].some((property) => owned.has(property))
          )
            throw new TypeError(
              'parallel phases require disjoint properties on each target',
            );
          for (const property of properties) owned.add(property);
          phase.owned.set(element, owned);
        }
      }
      settings.duration = cursor;
    } else throw new TypeError('unsupported animation description');
    if (
      !Number.isFinite(settings.duration) &&
      ((settings.iterations ?? 1) !== 1 ||
        (settings.direction ?? 'normal') !== 'normal')
    )
      throw new TypeError(
        'infinite compositions require normal direction and one outer iteration',
      );
    phase.span =
      settings.delay +
      (settings.duration === 0 || settings.iterations === 0
        ? 0
        : settings.duration * (settings.iterations ?? 1));
    if (Number.isNaN(phase.span))
      throw new TypeError('unsupported animation duration');
    if (phase.children.length && Number.isFinite(phase.span)) {
      for (const [element, frame] of virtual)
        virtual.set(element, {
          ...(before.get(element) ?? initial.get(element) ?? frame),
        });
      apply(phase, phase.span, virtual);
    }
    return phase;
  };
  const root = compile(description, 0, true);
  // Infinite subtrees eventually repeat. Encode their prefix and common period
  // as separate browser effects; no JS callback advances internal phases.
  const periodic = (phase: Phase): { prefix: number; period: number } => {
    if (Number.isFinite(phase.span)) return { prefix: phase.span, period: 0 };
    if (Number.isFinite(phase.settings.duration))
      return {
        prefix: phase.settings.delay,
        period:
          phase.settings.duration *
          ((phase.settings.direction ?? '').startsWith('alternate') ? 2 : 1),
      };
    let prefix = phase.settings.delay,
      period = 0;
    for (let i = 0; i < phase.children.length; i++) {
      const tail = periodic(phase.children[i]!);
      prefix = Math.max(
        prefix,
        phase.settings.delay + phase.starts[i]! + tail.prefix,
      );
      if (tail.period) {
        if (!period) period = tail.period;
        else {
          const a = Math.round(period * 1000),
            b = Math.round(tail.period * 1000);
          const gcd = (x: number, y: number): number =>
            y === 0 ? x : gcd(y, x % y);
          period = ((a / gcd(a, b)) * b) / 1000;
        }
      }
    }
    if (!Number.isFinite(period) || period > 3_600_000)
      throw new TypeError('browser composition common period exceeds one hour');
    return { prefix, period };
  };
  const tail = periodic(root);
  const sample = (time: number, finite = false): Map<UiElement, Keyframe> => {
    const state = new Map(
      [...initial].map(([element, frame]) => [element, { ...frame }]),
    );
    apply(root, time, state, finite);
    return state;
  };
  const curves: CompiledProgram['curves'] = new Map();
  for (const element of root.owned.keys())
    curves.set(element, { prefix: [], cycle: [], final: {} });
  const build = (
    duration: number,
    start: number,
    key: 'prefix' | 'cycle',
  ): void => {
    const samples = Math.min(16383, Math.max(1, Math.ceil(duration * 0.24)));
    if ((samples + 1) * curves.size > MAX_POINTS)
      throw new TypeError(
        'browser composition exceeds its compiled curve budget',
      );
    for (let i = 0; i <= samples; i++) {
      const state = sample(start + (duration * i) / samples);
      for (const [element, curve] of curves) {
        const frame: Keyframe = { offset: i / samples };
        for (const property of root.owned.get(element)!)
          frame[property] = state.get(element)![property];
        curve[key].push(frame);
      }
    }
  };
  build(
    Math.max(0, tail.prefix - root.settings.delay),
    root.settings.delay,
    'prefix',
  );
  if (tail.period) build(tail.period, tail.prefix, 'cycle');
  const end = sample(finiteSpan(root), true);
  for (const [element, curve] of curves)
    for (const property of root.owned.get(element)!)
      curve.final[property] = end.get(element)![property];
  return {
    settings: root.settings,
    span: root.span,
    finiteSpan: finiteSpan(root),
    prefix: tail.prefix,
    delay: root.settings.delay,
    period: tail.period,
    owned: root.owned,
    curves,
  };
}

/** A single public handle controls every browser effect in a composed program. */
export class ProgramAnimation implements ManagedAnimation {
  readonly options: AnimationOptions;
  readonly scopes: readonly UiElement[];
  #clock!: Animation;
  #effects: Animation[] = [];
  #source: Promise<Animation> | undefined;
  #finished: Promise<void> | undefined;
  #reduced = false;
  constructor(
    readonly controller: AnimationController,
    readonly element: UiElement,
    readonly program: CompiledProgram,
  ) {
    this.options = program.settings;
    this.scopes = [...program.owned.keys()];
    this.#start();
  }
  propertiesFor(element: UiElement): ReadonlySet<string> {
    return this.program.owned.get(element) ?? new Set();
  }
  sampleTransform(element = this.element): string | undefined {
    // Ordered curves are sampled only when an application retargets them.
    const curve = this.program.curves.get(element);
    if (!curve) return undefined;
    const time = this.currentTime;
    const cyclic = this.program.period && time >= this.program.prefix;
    const frames = cyclic ? curve.cycle : curve.prefix;
    const duration = cyclic
      ? this.program.period
      : this.program.prefix - this.program.delay;
    const progress =
      duration === 0
        ? 1
        : cyclic
          ? ((time - this.program.prefix) % duration) / duration
          : Math.min(1, Math.max(0, (time - this.program.delay) / duration));
    const index = Math.min(
      frames.length - 2,
      Math.floor(progress * (frames.length - 1)),
    );
    const a = transformValues(frames[index]?.transform),
      b = transformValues(frames[index + 1]?.transform);
    if (!a || !b || a.length !== b.length) return undefined;
    const fraction = progress * (frames.length - 1) - index;
    return transformText(
      a.map((value, i) => ({
        key: value.key,
        value: value.value + (b[i]!.value - value.value) * fraction,
      })),
    );
  }
  springVelocity(key: string, element = this.element): number | undefined {
    if (this.playState === 'finished') return 0;
    const curve = this.program.curves.get(element);
    if (!curve) return undefined;
    const valueAt = (time: number): number | undefined => {
      const cyclic = this.program.period && time >= this.program.prefix;
      const frames = cyclic ? curve.cycle : curve.prefix;
      const duration = cyclic
        ? this.program.period
        : this.program.prefix - this.program.delay;
      const progress =
        duration === 0
          ? 1
          : cyclic
            ? ((time - this.program.prefix) % duration) / duration
            : Math.min(1, Math.max(0, (time - this.program.delay) / duration));
      const index = Math.min(
        frames.length - 2,
        Math.floor(progress * (frames.length - 1)),
      );
      const numeric = (frame: Keyframe | undefined) =>
        key === 'opacity'
          ? Number(frame?.opacity)
          : transformValues(frame?.transform)?.find(
              (value) => value.key === key,
            )?.value;
      const a = numeric(frames[index]),
        b = numeric(frames[index + 1]);
      return a === undefined || b === undefined
        ? undefined
        : a + (b - a) * (progress * (frames.length - 1) - index);
    };
    const time = this.currentTime,
      beforeTime = Math.max(0, time - 0.1);
    const before = valueAt(beforeTime),
      after = valueAt(time + 0.1);
    return before === undefined || after === undefined
      ? undefined
      : ((after - before) * 1000) / (time + 0.1 - beforeTime);
  }
  #start(): void {
    this.controller.register(this);
    this.#reduced = this.controller.reducedMotion;
    const fill = this.options.fill ?? 'none';
    for (const [element, curve] of this.program.curves) {
      if (this.#reduced)
        this.#effects.push(
          element.animate([curve.final, curve.final], { duration: 0, fill }),
        );
      else {
        this.#effects.push(
          element.animate(curve.prefix, {
            duration: this.program.prefix - this.program.delay,
            delay: this.program.delay,
            fill: fill === 'both' || fill === 'backwards' ? 'both' : 'forwards',
            easing: 'linear',
          }),
        );
        if (this.program.period)
          this.#effects.push(
            element.animate(curve.cycle, {
              duration: this.program.period,
              delay: this.program.prefix,
              iterations: Infinity,
              fill: 'forwards',
              easing: 'linear',
            }),
          );
      }
    }
    this.#clock = this.element.animate([], {
      duration: this.#reduced ? 0 : this.program.period || this.program.span,
      delay: this.#reduced ? 0 : this.program.period ? this.program.prefix : 0,
      iterations: this.#reduced ? 1 : this.program.period ? Infinity : 1,
      fill: 'both',
    });
    for (const effect of this.#effects) effect.finished.catch(() => {});
    void this.finished;
  }
  #cancelEffects(): void {
    for (const effect of this.#effects) {
      effect.finished.catch(() => {});
      effect.cancel();
    }
  }
  get playState(): UiAnimation['playState'] {
    return this.#clock.playState;
  }
  get currentTime(): number {
    return this.playState === 'finished'
      ? this.#reduced
        ? this.program.finiteSpan
        : this.program.span
      : Number(this.#clock.currentTime ?? 0);
  }
  set currentTime(value: number) {
    if (!Number.isFinite(value) || value < 0)
      throw new TypeError(
        'animation currentTime must be finite and nonnegative',
      );
    if (this.playState === 'idle') {
      this.play();
      this.pause();
    } else if (this.playState === 'finished') {
      this.controller.register(this);
      this.#clock.pause();
      for (const effect of this.#effects) effect.pause();
    }
    value = Math.min(value, this.program.span);
    this.#clock.currentTime = value;
    for (const effect of this.#effects) {
      effect.currentTime = value;
      effect.finished.catch(() => {});
    }
    if (Number.isFinite(this.program.span) && value >= this.program.span)
      this.finish();
    void this.finished;
  }
  get finished(): Promise<void> {
    if (this.playState === 'idle' && this.#finished) return this.#finished;
    if (this.#source !== this.#clock.finished) {
      const source = this.#clock.finished;
      this.#source = source;
      this.#finished = source.then(
        () => {
          if (this.#source !== source) return;
          if (this.options.fill === 'none' || this.options.fill === 'backwards')
            this.#cancelEffects();
          this.controller.settled(this, this.element, false);
        },
        (error: unknown) => {
          if (this.#source === source)
            this.controller.settled(this, this.element, true);
          throw error;
        },
      );
      this.#finished.catch(() => {});
    }
    return this.#finished!;
  }
  pause(): void {
    if (this.playState === 'finished') return;
    if (this.playState === 'idle') this.play();
    this.#clock.pause();
    for (const effect of this.#effects) effect.pause();
  }
  play(): void {
    if (this.playState === 'idle') {
      this.#effects = [];
      this.#start();
    } else {
      this.controller.register(this);
      const finished = this.playState === 'finished';
      if (finished) this.currentTime = 0;
      this.#clock.play();
      for (const effect of this.#effects) {
        effect.play();
        effect.finished.catch(() => {});
      }
    }
    void this.finished;
  }
  resume(): void {
    this.play();
  }
  cancel(): void {
    this.#cancelEffects();
    this.#clock.finished.catch(() => {});
    this.#clock.cancel();
    this.controller.settled(this, this.element, true);
  }
  finish(): void {
    if (!Number.isFinite(this.program.span) && !this.controller.reducedMotion)
      throw new Error('cannot finish an infinite animation');
    if (this.playState === 'finished') return;
    if (this.playState === 'idle') this.play();
    if (this.controller.reducedMotion) {
      this.#cancelEffects();
      this.#effects = [...this.program.curves].map(([element, curve]) =>
        element.animate([curve.final, curve.final], {
          duration: 0,
          fill: this.options.fill,
        }),
      );
      for (const effect of this.#effects) effect.finished.catch(() => {});
      this.#reduced = true;
      this.#clock.effect?.updateTiming({
        duration: 0,
        delay: 0,
        iterations: 1,
      });
    } else for (const effect of this.#effects) effect.finish();
    this.#clock.finish();
  }
}
