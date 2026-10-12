import { compileProgram, ProgramAnimation } from './animation-program';
import {
  sampleSpring,
  springDuration,
  springParameters,
  type SpringParameters,
} from './spring';
import { readStyle } from './style';
import type { AnimationDescription } from './types';
import type {
  AnimationKeyframe,
  AnimationOptions,
  TransformOperation,
  UiAnimation as AnimationContract,
} from './types';

interface SpringTrack {
  origin: number;
  target: number;
  velocity: number;
  parameters: SpringParameters;
}

const TRANSFORMS = new Set([
  'translateX',
  'translateY',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
]);

export function transformCss(value: readonly TransformOperation[]): string {
  if (!Array.isArray(value) || value.length > 6)
    throw new TypeError(
      'style.transform: expected an array with each supported transform once',
    );
  const seen = new Set<string>();
  return (
    value
      .map((operation) => {
        if (
          !operation ||
          typeof operation !== 'object' ||
          Object.keys(operation).length !== 1
        )
          throw new TypeError(
            'style.transform: expected one property per entry',
          );
        const [key, input] = Object.entries(operation)[0]!;
        if (!TRANSFORMS.has(key))
          throw new TypeError(`style.transform: unsupported property ${key}`);
        if (seen.has(key))
          throw new TypeError(`style.transform: duplicate ${key}`);
        seen.add(key);
        let number = input;
        if (key === 'rotate' && typeof input === 'string') {
          if (
            !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:deg|rad)$/.test(
              input,
            )
          )
            throw new TypeError('style.transform.rotate: invalid angle');
          number =
            Number.parseFloat(input) *
            (input.endsWith('deg') ? Math.PI / 180 : 1);
        }
        if (
          typeof number !== 'number' ||
          !Number.isFinite(number) ||
          Math.abs(number) > 3.4028234663852886e38
        )
          throw new TypeError(
            `style.transform.${key}: expected a finite number`,
          );
        return `${key}(${number}${key.startsWith('translate') ? 'px' : key === 'rotate' ? 'rad' : ''})`;
      })
      .join(' ') || 'none'
  );
}

export function timing(value: AnimationOptions): Required<AnimationOptions> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('animation options must be an object');
  const result = {
    duration: 300,
    delay: 0,
    easing: 'linear',
    fill: 'none',
    ...value,
  } as Required<AnimationOptions>;
  for (const name of ['duration', 'delay'] as const)
    if (!Number.isFinite(result[name]) || result[name] < 0)
      throw new TypeError(
        `animation.${name}: expected a finite nonnegative number`,
      );
  if (
    !['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(
      result.easing,
    )
  )
    throw new TypeError('animation.easing: unsupported value');
  if (!['none', 'backwards', 'forwards', 'both'].includes(result.fill))
    throw new TypeError('animation.fill: unsupported value');
  if (
    result.type !== undefined &&
    result.type !== 'timing' &&
    result.type !== 'spring'
  )
    throw new TypeError('animation.type: unsupported value');
  if (
    result.iterations !== undefined &&
    (Number.isNaN(result.iterations) ||
      result.iterations < 0 ||
      typeof result.iterations !== 'number')
  )
    throw new TypeError('animation.iterations: expected a nonnegative count');
  if (
    result.direction !== undefined &&
    !['normal', 'reverse', 'alternate', 'alternate-reverse'].includes(
      result.direction,
    )
  )
    throw new TypeError('animation.direction: unsupported value');
  if (result.type === 'spring') springParameters(result);
  return result;
}

export function keyframes(value: readonly AnimationKeyframe[]): {
  frames: Keyframe[];
  properties: Set<string>;
} {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4096)
    throw new TypeError('animate: expected 1 to 4096 keyframes');
  const properties = new Set<string>();
  const frames = value.map((frame): Keyframe => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame))
      throw new TypeError('animate: keyframes must be objects');
    const result: Keyframe = {};
    for (const [key, entry] of Object.entries(frame)) {
      if (key === 'opacity') {
        if (typeof entry !== 'number' || !Number.isFinite(entry))
          throw new TypeError('style.opacity: expected a finite number');
        result.opacity = Math.min(1, Math.max(0, entry));
      } else if (key === 'transform')
        result.transform = transformCss(entry as readonly TransformOperation[]);
      else if (key === 'backgroundColor' || key === 'borderColor') {
        readStyle({ [key]: entry });
        result[key] = entry as string;
      } else if (key === 'offset') {
        if (
          typeof entry !== 'number' ||
          !Number.isFinite(entry) ||
          entry < 0 ||
          entry > 1
        )
          throw new TypeError(
            'animation.offset: expected a number within [0,1]',
          );
        result.offset = entry;
      } else if (key === 'easing') {
        if (
          !['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(
            entry as string,
          )
        )
          throw new TypeError('animation.easing: unsupported value');
        result.easing = entry as string;
      } else throw new TypeError(`animate: unsupported property ${key}`);
      if (key !== 'offset' && key !== 'easing') properties.add(key);
    }
    return result;
  });
  if (properties.size === 0)
    throw new TypeError('animation must name supported properties');
  const advanced =
    frames.length > 2 ||
    frames.some(
      (frame) => frame.offset !== undefined || frame.easing !== undefined,
    );
  if (
    frames.length === 1 &&
    frames[0]!.offset !== undefined &&
    frames[0]!.offset !== 1
  )
    throw new TypeError('animate: a single target has offset 1');
  if (frames.length === 2 && !advanced)
    for (const frame of frames)
      for (const property of properties)
        frame[property] ??=
          property === 'opacity'
            ? 1
            : property === 'transform'
              ? 'none'
              : property === 'backgroundColor'
                ? 'transparent'
                : 'black';
  if (advanced && frames.length > 1) {
    frames[0]!.offset ??= 0;
    frames.at(-1)!.offset ??= 1;
    let anchor = 0;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i]!.offset === undefined) continue;
      if (frames[i]!.offset! < frames[anchor]!.offset!)
        throw new TypeError('animation offsets must be nondecreasing');
      for (let j = anchor + 1; j < i; j++)
        frames[j]!.offset =
          frames[anchor]!.offset! +
          ((frames[i]!.offset! - frames[anchor]!.offset!) * (j - anchor)) /
            (i - anchor);
      anchor = i;
    }
  }
  return { frames, properties };
}

export function standardEase(easing: string, progress: number): number {
  const x = Math.min(1, Math.max(0, progress));
  if (easing === 'linear' || x === 0 || x === 1) return x;
  const points: Record<string, readonly number[]> = {
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  const [x1, y1, x2, y2] = points[easing]!;
  const cubic = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0,
    high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (cubic(middle, x1!, x2!) < x) low = middle;
    else high = middle;
  }
  return cubic((low + high) / 2, y1!, y2!);
}

type TransformValue = { key: string; value: number };
export function transformValues(text: unknown): TransformValue[] | undefined {
  if (!text || text === 'none') return [];
  if (typeof text !== 'string') return undefined;
  const values: TransformValue[] = [];
  let consumed = '';
  for (const match of text.matchAll(
    /(translateX|translateY|scale|scaleX|scaleY|rotate)\(([^)]+)\)/g,
  )) {
    const key = match[1]!,
      input = match[2]!;
    let value = Number.parseFloat(input);
    if (key === 'rotate' && input.endsWith('deg')) value *= Math.PI / 180;
    if (!Number.isFinite(value)) return undefined;
    values.push({ key, value });
    consumed += match[0];
  }
  return consumed.replaceAll(/\s/g, '') === text.replaceAll(/\s/g, '')
    ? values
    : undefined;
}
export function transformText(values: readonly TransformValue[]): string {
  return (
    values
      .map(
        ({ key, value }) =>
          `${key}(${value}${key.startsWith('translate') ? 'px' : key === 'rotate' ? 'rad' : ''})`,
      )
      .join(' ') || 'none'
  );
}
function pairedTransforms(
  from: unknown,
  to: unknown,
): readonly [string, string] | undefined {
  const before = transformValues(from),
    after = transformValues(to);
  if (!before || !after) return undefined; // external CSS matrices use browser decomposition
  const oldOrder = before.map(({ key }) => key),
    order = after.map(({ key }) => key);
  if (
    oldOrder.filter((key) => order.includes(key)).join(',') !==
    order.filter((key) => oldOrder.includes(key)).join(',')
  )
    throw new TypeError(
      'retargeted transforms must preserve shared operation order',
    );
  for (let i = 0; i < oldOrder.length; i++) {
    const key = oldOrder[i]!;
    if (order.includes(key)) continue;
    const later = oldOrder.slice(i + 1).find((next) => order.includes(next));
    order.splice(
      later === undefined ? order.length : order.indexOf(later),
      0,
      key,
    );
  }
  const align = (values: TransformValue[]) =>
    transformText(
      order.map((key) => ({
        key,
        value:
          values.find((value) => value.key === key)?.value ??
          (key.startsWith('scale') ? 1 : 0),
      })),
    );
  return [align(before), align(after)];
}

export interface ManagedAnimation extends AnimationContract {
  readonly options: AnimationOptions;
  readonly scopes: readonly HTMLElement[];
  propertiesFor(element: HTMLElement): ReadonlySet<string>;
  sampleTransform(element?: HTMLElement): string | undefined;
  springVelocity(key: string, element?: HTMLElement): number | undefined;
}

/** One view's browser-owned animations. There is no JS frame scheduler. */
export class AnimationController {
  readonly #byElement = new WeakMap<HTMLElement, Set<ManagedAnimation>>();
  readonly #handles = new Set<WeakRef<ManagedAnimation>>();
  readonly #refs = new WeakMap<ManagedAnimation, WeakRef<ManagedAnimation>>();
  readonly #media: MediaQueryList | undefined;
  readonly #mediaChanged = () => {
    if (this.reducedMotion) this.#finishAll();
  };
  #override: boolean | undefined;

  constructor(window: Window | null = globalThis.window) {
    this.#media = window?.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.#media?.addEventListener('change', this.#mediaChanged);
  }
  get reducedMotion(): boolean {
    return this.#override ?? this.#media?.matches ?? false;
  }
  set reducedMotion(value: boolean) {
    if (typeof value !== 'boolean')
      throw new TypeError('reduced motion must be a boolean');
    this.#override = value;
    if (value) this.#finishAll();
  }
  #finishAll(): void {
    for (const ref of this.#handles) {
      const handle = ref.deref();
      if (
        handle &&
        (handle.playState === 'running' || handle.playState === 'paused')
      )
        handle.finish();
      if (!handle) this.#handles.delete(ref);
    }
  }
  dispose(): void {
    this.#media?.removeEventListener('change', this.#mediaChanged);
    for (const ref of this.#handles) ref.deref()?.cancel();
    this.#handles.clear();
  }
  create(
    element: HTMLElement,
    frames: readonly AnimationKeyframe[],
    options: AnimationOptions = {},
  ): UiAnimation {
    const normalized = keyframes(frames);
    const settings = timing(options);
    const handle = new UiAnimation(
      this,
      element,
      normalized.frames,
      normalized.properties,
      settings,
    );
    const ref = new WeakRef(handle);
    this.#refs.set(handle, ref);
    this.#handles.add(ref);
    return handle;
  }
  /** @internal */
  register(handle: ManagedAnimation): void {
    for (const element of handle.scopes) {
      const existing =
        this.#byElement.get(element) ?? new Set<ManagedAnimation>();
      for (const previous of existing)
        if (
          previous !== handle &&
          [...handle.propertiesFor(element)].some((property) =>
            previous.propertiesFor(element).has(property),
          )
        )
          previous.cancel();
      existing.add(handle);
      this.#byElement.set(element, existing);
    }
    let ref = this.#refs.get(handle);
    if (!ref) {
      ref = new WeakRef(handle);
      this.#refs.set(handle, ref);
    }
    this.#handles.add(ref);
  }
  createProgram(
    element: HTMLElement,
    description: AnimationDescription,
    options: AnimationOptions = {},
  ): AnimationContract {
    timing(options);
    if (
      description &&
      (description.kind === undefined || description.kind === 'effect') &&
      'keyframes' in description
    ) {
      return this.create(
        description.target?.animationElement(this) ?? element,
        description.keyframes,
        { ...description.options, ...options },
      );
    }
    const compiled = compileProgram(this, element, description, options);
    return new ProgramAnimation(this, element, compiled);
  }
  /** @internal Used only while compiling or retargeting a description. */
  existing(element: HTMLElement): readonly ManagedAnimation[] {
    return [...(this.#byElement.get(element) ?? [])];
  }
  /** @internal Snapshot ordered transforms before removing an older override. */
  snapshot(element: HTMLElement): Keyframe {
    const computed =
      element.ownerDocument.defaultView!.getComputedStyle(element);
    const previous = [...(this.#byElement.get(element) ?? [])].find((item) =>
      item.propertiesFor(element).has('transform'),
    );
    return {
      opacity: computed.opacity || '1',
      transform:
        previous?.sampleTransform(element) ??
        element.style.transform ??
        computed.transform ??
        'none',
      backgroundColor: computed.backgroundColor || 'transparent',
      borderColor: computed.borderColor || 'black',
    };
  }
  start(
    handle: UiAnimation,
    element: HTMLElement,
    frames: Keyframe[],
    properties: ReadonlySet<string>,
    options: Required<AnimationOptions>,
  ): Animation {
    const existing =
      this.#byElement.get(element) ?? new Set<ManagedAnimation>();
    const computed =
      element.ownerDocument.defaultView!.getComputedStyle(element);
    const from: Keyframe = {};
    for (const property of properties)
      from[property] =
        computed.getPropertyValue(
          property.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()),
        ) ||
        (property === 'opacity'
          ? '1'
          : property === 'transform'
            ? 'none'
            : property === 'backgroundColor'
              ? 'transparent'
              : 'black');
    if (properties.has('transform') && frames.length === 1) {
      const previous = [...existing].find((item) =>
        item.propertiesFor(element).has('transform'),
      );
      from.transform = previous
        ? (previous.sampleTransform(element) ?? computed.transform)
        : element.style.transform || computed.transform || 'none';
    }
    const playback = this.prepare(
      element,
      frames,
      properties,
      options,
      from,
      handle,
      [...existing],
    );
    // Snapshot before cancelling conflicts to preserve mid-flight presentation.
    for (const previous of existing)
      if (
        [...properties].some((property) =>
          previous.propertiesFor(element).has(property),
        )
      )
        previous.cancel();
    const animation = element.animate(playback, {
      duration: options.duration,
      delay: options.delay,
      easing: options.type === 'spring' ? 'linear' : options.easing,
      fill: options.fill,
      ...(options.iterations === undefined
        ? {}
        : { iterations: options.iterations }),
      ...(options.direction === undefined
        ? {}
        : { direction: options.direction }),
      ...(this.reducedMotion
        ? {
            duration: 0,
            delay: 0,
            iterations: Number.isFinite(options.iterations ?? 1)
              ? (options.iterations ?? 1)
              : 1,
          }
        : {}),
    });
    handle.recordFrames(playback);
    existing.add(handle);
    const ref = this.#refs.get(handle);
    if (ref) this.#handles.add(ref);
    this.#byElement.set(element, existing);
    return animation;
  }
  /** @internal Compile once; composition supplies its preceding virtual presentation. */
  prepare(
    element: HTMLElement,
    frames: Keyframe[],
    properties: ReadonlySet<string>,
    options: Required<AnimationOptions>,
    from: Keyframe,
    handle?: UiAnimation,
    existing: readonly ManagedAnimation[] = [],
  ): Keyframe[] {
    const submitted =
      frames.length === 1
        ? [{ ...from }, { ...frames[0]! }]
        : frames.map((frame) => ({ ...frame }));
    const advanced =
      submitted.length > 2 ||
      submitted.some(
        (frame) => frame.offset !== undefined || frame.easing !== undefined,
      );
    if (advanced) {
      const before: Keyframe = { offset: 0 },
        after: Keyframe = { offset: 1 };
      for (const property of properties) {
        const authored = submitted.filter(
          (frame) => frame[property] !== undefined,
        );
        if (submitted[0]!.offset! > 0 || submitted[0]![property] === undefined)
          before[property] = from[property];
        if (
          submitted.at(-1)!.offset! < 1 ||
          submitted.at(-1)![property] === undefined
        )
          after[property] = authored.at(-1)?.[property] ?? from[property];
      }
      if (Object.keys(before).length > 1) submitted.unshift(before);
      if (Object.keys(after).length > 1) submitted.push(after);
    }
    if (properties.has('transform')) {
      let order: unknown = submitted.find(
        (frame) => frame.transform !== undefined,
      )?.transform;
      for (const frame of submitted)
        if (frame.transform !== undefined) {
          const pair = pairedTransforms(order, frame.transform);
          if (pair) order = pair[1];
        }
      for (const frame of submitted)
        if (frame.transform !== undefined) {
          const pair = pairedTransforms(frame.transform, order);
          if (pair) frame.transform = pair[0];
        }
    }
    let playback = submitted;
    if (options.type === 'spring') {
      if (
        frames.length > 2 ||
        [...properties].some(
          (property) => property !== 'opacity' && property !== 'transform',
        )
      )
        throw new TypeError(
          'spring effects support an origin and target of numeric opacity and transform properties',
        );
      const parameters = springParameters(options),
        tracks = new Map<string, SpringTrack>();
      const previous =
        frames.length === 1
          ? [...existing].find((item) =>
              [...properties].some((property) =>
                item.propertiesFor(element).has(property),
              ),
            )
          : undefined;
      if (properties.has('opacity'))
        tracks.set('opacity', {
          origin: Number(submitted[0]!.opacity),
          target: Number(submitted.at(-1)!.opacity),
          velocity:
            previous?.springVelocity('opacity', element) ??
            parameters.initialVelocity,
          parameters,
        });
      const before = transformValues(submitted[0]!.transform),
        after = transformValues(submitted.at(-1)!.transform);
      if (properties.has('transform')) {
        if (!before || !after || before.length !== after.length)
          throw new TypeError(
            'spring transforms require supported transform operations',
          );
        for (let i = 0; i < before.length; i++) {
          const value = before[i]!,
            target = after[i]!;
          tracks.set(value.key, {
            origin: value.value,
            target: target.value,
            velocity:
              previous?.springVelocity(value.key, element) ??
              parameters.initialVelocity,
            parameters,
          });
        }
      }
      const duration = Math.max(
        0,
        ...[...tracks.values()].map((track) =>
          springDuration(
            parameters,
            track.origin,
            track.target,
            track.velocity,
          ),
        ),
      );
      options.duration = duration;
      handle?.recordSpring(tracks);
      const samples = Math.min(4095, Math.max(1, Math.ceil(duration * 0.24)));
      playback = Array.from({ length: samples + 1 }, (_, i): Keyframe => {
        const offset = i / samples,
          frame: Keyframe = { offset };
        const values = new Map(
          [...tracks].map(([key, track]) => [
            key,
            i === samples
              ? track.target
              : sampleSpring(
                  parameters,
                  (offset * duration) / 1000,
                  track.origin,
                  track.target,
                  track.velocity,
                ).position,
          ]),
        );
        if (properties.has('opacity'))
          frame.opacity = Math.min(1, Math.max(0, values.get('opacity')!));
        if (properties.has('transform'))
          frame.transform = transformText(
            before!.map((value) => ({
              key: value.key,
              value: Math.max(
                -3.4028234663852886e38,
                Math.min(3.4028234663852886e38, values.get(value.key)!),
              ),
            })),
          );
        return frame;
      });
    }
    return playback;
  }
  settled(
    handle: ManagedAnimation,
    _element: HTMLElement,
    cancelled: boolean,
  ): void {
    if (
      cancelled ||
      handle.options.fill === 'none' ||
      handle.options.fill === 'backwards'
    ) {
      for (const element of handle.scopes)
        this.#byElement.get(element)?.delete(handle);
      const ref = this.#refs.get(handle);
      if (ref) this.#handles.delete(ref);
    }
  }
}

function endTime(options: Required<AnimationOptions>): number {
  return (
    options.delay +
    (options.duration === 0 || options.iterations === 0
      ? 0
      : options.duration * (options.iterations ?? 1))
  );
}

export class UiAnimation implements AnimationContract {
  #native: Animation;
  #source: Promise<Animation> | undefined;
  #finished: Promise<void> | undefined;
  #submitted: Keyframe[] = [];
  #spring = new Map<string, SpringTrack>();
  constructor(
    readonly controller: AnimationController,
    readonly element: HTMLElement,
    readonly frames: Keyframe[],
    readonly properties: ReadonlySet<string>,
    readonly options: Required<AnimationOptions>,
  ) {
    this.#native = controller.start(this, element, frames, properties, options);
    void this.finished;
  }
  get scopes(): readonly HTMLElement[] {
    return [this.element];
  }
  propertiesFor(_element: HTMLElement): ReadonlySet<string> {
    return this.properties;
  }
  /** @internal Only sampled at retarget time, never from a JS frame loop. */
  sampleTransform(): string | undefined {
    const progress = this.#native.effect?.getComputedTiming().progress;
    if (progress === null || progress === undefined) return undefined;
    const frames = this.#submitted.filter(
      (frame) => frame.transform !== undefined,
    );
    let lower = frames[0],
      upper = frames.at(-1);
    for (let i = 0; i < frames.length; i++) {
      const offset = frames[i]!.offset ?? i / (frames.length - 1);
      if (offset <= progress) lower = frames[i];
      else {
        upper = frames[i];
        break;
      }
    }
    const from = transformValues(lower?.transform),
      to = transformValues(upper?.transform);
    if (!from || !to || from.length !== to.length) return undefined;
    const a = lower?.offset ?? 0,
      b = upper?.offset ?? 1;
    const local =
      b === a
        ? 0
        : standardEase(lower?.easing ?? 'linear', (progress - a) / (b - a));
    return transformText(
      from.map((value, index) => ({
        key: value.key,
        value: value.value + local * (to[index]!.value - value.value),
      })),
    );
  }
  /** @internal */
  recordSpring(tracks: Map<string, SpringTrack>): void {
    this.#spring = tracks;
  }
  /** @internal Retarget-only analytic velocity, never a per-frame JS callback. */
  springVelocity(key: string): number | undefined {
    const track = this.#spring.get(key);
    if (!track) return undefined;
    if (this.playState === 'finished') return 0;
    const timing = this.#native.effect?.getComputedTiming();
    const elapsed = Math.max(
      0,
      Number(this.#native.currentTime ?? 0) - this.options.delay,
    );
    const progress = timing?.progress ?? (elapsed / this.options.duration) % 1;
    const iteration =
      timing?.currentIteration ?? Math.floor(elapsed / this.options.duration);
    const direction = this.options.direction ?? 'normal';
    const reversed =
      (direction === 'reverse' || direction === 'alternate-reverse') !==
      ((direction === 'alternate' || direction === 'alternate-reverse') &&
        iteration % 2 === 1);
    return (
      (reversed ? -1 : 1) *
      sampleSpring(
        track.parameters,
        (progress * this.options.duration) / 1000,
        track.origin,
        track.target,
        track.velocity,
      ).velocity
    );
  }
  /** @internal */
  recordFrames(frames: Keyframe[]): void {
    this.#submitted = frames;
  }
  get finished(): Promise<void> {
    // WAAPI replaces its finished promise on cancel. Keep the cancelled
    // run's promise until play(), matching the native contract.
    if (this.#native.playState === 'idle' && this.#finished)
      return this.#finished;
    if (this.#source !== this.#native.finished) {
      const source = this.#native.finished;
      this.#source = source;
      this.#finished = source.then(
        () => {
          if (this.#source === source)
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
  get playState(): AnimationContract['playState'] {
    return this.#native.playState;
  }
  get currentTime(): number {
    if (
      this.playState === 'finished' &&
      this.controller.reducedMotion &&
      !Number.isFinite(this.options.iterations ?? 1)
    )
      return this.options.duration + this.options.delay;
    return this.playState === 'finished' &&
      Number.isFinite(endTime(this.options))
      ? endTime(this.options)
      : Number(this.#native.currentTime ?? 0);
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
      this.#native.pause();
    }
    const end = endTime(this.options);
    this.#native.currentTime = Math.min(value, end);
    if (Number.isFinite(end) && value >= end) this.#native.finish();
    void this.finished;
  }
  pause(): void {
    if (this.playState === 'finished') return;
    if (this.playState === 'idle') this.play();
    this.#native.pause();
  }
  resume(): void {
    this.play();
  }
  play(): void {
    if (this.playState === 'idle')
      this.#native = this.controller.start(
        this,
        this.element,
        this.frames,
        this.properties,
        this.options,
      );
    else {
      this.controller.register(this);
      this.#native.play();
    }
    void this.finished;
  }
  cancel(): void {
    this.#native.cancel();
    this.controller.settled(this, this.element, true);
  }
  finish(): void {
    if (this.playState === 'idle') this.play();
    if (
      this.controller.reducedMotion &&
      !Number.isFinite(this.options.iterations ?? 1)
    )
      this.#native.effect?.updateTiming({ iterations: 1 });
    this.#native.finish();
  }
}
