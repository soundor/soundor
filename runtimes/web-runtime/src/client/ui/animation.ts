import type {
  AnimationKeyframe,
  AnimationOptions,
  TransformOperation,
  UiAnimation as AnimationContract,
} from './types';

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
            !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:deg|rad)$/.test(input)
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

function timing(value: AnimationOptions): Required<AnimationOptions> {
  if (!value || typeof value !== 'object')
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
  return result;
}

function keyframes(value: readonly AnimationKeyframe[]): {
  frames: Keyframe[];
  properties: Set<string>;
} {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2)
    throw new TypeError(
      'animate: timing animations require one target or two keyframes',
    );
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
      else throw new TypeError(`animate: unsupported property ${key}`);
      properties.add(key);
    }
    return result;
  });
  if (properties.size === 0)
    throw new TypeError('animation must name supported properties');
  if (
    value.length === 2 &&
    value[0]?.transform?.length &&
    value[0].transform
      .map((entry: TransformOperation) => Object.keys(entry)[0])
      .join(',') !==
      value[1]?.transform
        ?.map((entry: TransformOperation) => Object.keys(entry)[0])
        .join(',')
  )
    throw new TypeError(
      'animate: transform entries must use the same order in both keyframes',
    );
  if (frames.length === 2)
    for (const frame of frames)
      for (const property of properties)
        frame[property] ??= property === 'opacity' ? 1 : 'none';
  return { frames, properties };
}

type TransformValue = { key: string; value: number };
function transformValues(text: unknown): TransformValue[] | undefined {
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
function transformText(values: readonly TransformValue[]): string {
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

/** One view's browser-owned animations. There is no JS frame scheduler. */
export class AnimationController {
  readonly #byElement = new WeakMap<HTMLElement, Set<UiAnimation>>();
  readonly #handles = new Set<WeakRef<UiAnimation>>();
  readonly #refs = new WeakMap<UiAnimation, WeakRef<UiAnimation>>();
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
  start(
    handle: UiAnimation,
    element: HTMLElement,
    frames: Keyframe[],
    properties: ReadonlySet<string>,
    options: Required<AnimationOptions>,
  ): Animation {
    const existing = this.#byElement.get(element) ?? new Set<UiAnimation>();
    const computed =
      element.ownerDocument.defaultView!.getComputedStyle(element);
    const from: Keyframe = {};
    for (const property of properties)
      from[property] =
        computed.getPropertyValue(property) ||
        (property === 'opacity' ? '1' : 'none');
    if (properties.has('transform') && frames.length === 1) {
      const previous = [...existing].find((item) =>
        item.properties.has('transform'),
      );
      from.transform = previous
        ? (previous.sampleTransform() ?? computed.transform)
        : element.style.transform || computed.transform || 'none';
    }
    const submitted =
      frames.length === 1
        ? [from, { ...frames[0]! }]
        : frames.map((frame) => ({ ...frame }));
    if (properties.has('transform')) {
      const pair = pairedTransforms(
        submitted[0]!.transform,
        submitted[1]!.transform,
      );
      if (pair) {
        submitted[0]!.transform = pair[0];
        submitted[1]!.transform = pair[1];
      }
    }
    // Snapshot before cancelling conflicts to preserve mid-flight presentation.
    for (const previous of existing)
      if ([...properties].some((property) => previous.properties.has(property)))
        previous.cancel();
    const animation = element.animate(submitted, {
      ...options,
      ...(this.reducedMotion ? { duration: 0, delay: 0 } : {}),
    });
    handle.recordFrames(submitted);
    existing.add(handle);
    const ref = this.#refs.get(handle);
    if (ref) this.#handles.add(ref);
    this.#byElement.set(element, existing);
    return animation;
  }
  settled(handle: UiAnimation, element: HTMLElement, cancelled: boolean): void {
    if (
      cancelled ||
      handle.options.fill === 'none' ||
      handle.options.fill === 'backwards'
    ) {
      this.#byElement.get(element)?.delete(handle);
      const ref = this.#refs.get(handle);
      if (ref) this.#handles.delete(ref);
    }
  }
}

export class UiAnimation implements AnimationContract {
  #native: Animation;
  #source: Promise<Animation> | undefined;
  #finished: Promise<void> | undefined;
  #submitted: Keyframe[] = [];
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
  /** @internal Only sampled at retarget time, never from a JS frame loop. */
  sampleTransform(): string | undefined {
    const progress = this.#native.effect?.getComputedTiming().progress;
    if (progress === null || progress === undefined) return undefined;
    const from = transformValues(this.#submitted[0]?.transform),
      to = transformValues(this.#submitted[1]?.transform);
    if (!from || !to || from.length !== to.length) return undefined;
    return transformText(
      from.map((value, index) => ({
        key: value.key,
        value: value.value + progress * (to[index]!.value - value.value),
      })),
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
    return this.playState === 'finished'
      ? this.options.duration + this.options.delay
      : Number(this.#native.currentTime ?? 0);
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
    else this.#native.play();
    void this.finished;
  }
  cancel(): void {
    this.#native.cancel();
    this.controller.settled(this, this.element, true);
  }
  finish(): void {
    if (this.playState === 'idle') this.play();
    this.#native.finish();
  }
}
