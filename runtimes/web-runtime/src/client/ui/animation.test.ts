// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

import { AnimationController, transformCss } from './animation';

class BrowserAnimation {
  playState: AnimationPlayState = 'running';
  currentTime = 0;
  finished!: Promise<Animation>;
  resolve!: (value: Animation) => void;
  reject!: (error: DOMException) => void;
  constructor() {
    this.reset();
  }
  reset() {
    this.finished = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
  pause() {
    this.playState = 'paused';
  }
  play() {
    if (this.playState === 'finished' || this.playState === 'idle')
      this.reset();
    this.playState = 'running';
  }
  cancel() {
    this.playState = 'idle';
    this.reject(new DOMException('Animation cancelled', 'AbortError'));
    this.reset();
  }
  finish() {
    this.playState = 'finished';
    this.resolve(this as unknown as Animation);
  }
}

const controllers: AnimationController[] = [];
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers.length = 0;
  vi.restoreAllMocks();
});
function setup() {
  const animations: BrowserAnimation[] = [];
  const submit = vi.fn(
    (_frames: Keyframe[], _options?: KeyframeAnimationOptions) => {
      const animation = new BrowserAnimation();
      animations.push(animation);
      return animation as unknown as Animation;
    },
  );
  const element = document.createElement('div');
  Object.defineProperty(element, 'animate', { value: submit });
  document.body.append(element);
  const controller = new AnimationController();
  controllers.push(controller);
  return { controller, element, submit, animations };
}

it('submits one browser animation, supports playback and rejects cancellation without a RAF loop', async () => {
  const { controller, element, submit, animations } = setup();
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  element.style.opacity = '0.25';
  const animation = controller.create(
    element,
    [{ opacity: 1, transform: [{ translateY: 0 }] }],
    { duration: 250, easing: 'ease-out', fill: 'forwards' },
  );
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0]).toEqual([
    [
      { opacity: '0.25', transform: 'translateY(0px)' },
      { opacity: 1, transform: 'translateY(0px)' },
    ],
    { duration: 250, delay: 0, easing: 'ease-out', fill: 'forwards' },
  ]);
  expect(raf).not.toHaveBeenCalled();
  animation.pause();
  expect(animation.playState).toBe('paused');
  animation.resume();
  expect(animation.playState).toBe('running');
  animation.cancel();
  await expect(animation.finished).rejects.toMatchObject({
    name: 'AbortError',
  });
  animation.play();
  expect(submit).toHaveBeenCalledTimes(2);
  expect(animation.playState).toBe('running');
  animations[1]!.finish();
  await expect(animation.finished).resolves.toBeUndefined();
  animation.pause();
  expect(animation.playState).toBe('finished');
});

it('retargets from the current presentation before cancelling conflicts and preserves independent animations', async () => {
  const { controller, element, animations, submit } = setup();
  const first = controller.create(element, [{ opacity: 1 }], {
    fill: 'forwards',
  });
  const movement = controller.create(element, [
    { transform: [{ translateX: 30 }] },
  ]);
  element.style.opacity = '0.6'; // Browser's presented value at interruption.
  const next = controller.create(element, [{ opacity: 0 }]);
  expect(submit.mock.calls[2]![0]).toEqual([
    { opacity: '0.6' },
    { opacity: 0 },
  ]);
  expect(first.playState).toBe('idle');
  expect(movement.playState).toBe('running');
  await expect(first.finished).rejects.toMatchObject({ name: 'AbortError' });
  next.finish();
  await next.finished;
  expect(animations).toHaveLength(3);
});

it('reduced motion finishes active and paused animations and disposal cancels retained fills', async () => {
  const { controller, element, submit } = setup();
  const first = controller.create(element, [{ opacity: 0 }], {
    fill: 'forwards',
  });
  first.pause();
  controller.reducedMotion = true;
  await first.finished;
  expect(first.playState).toBe('finished');
  controller.create(element, [{ transform: [{ scale: 1 }] }], {
    duration: 100,
    delay: 50,
  });
  expect(submit.mock.calls[1]![1]).toMatchObject({ duration: 0, delay: 0 });
  controller.dispose();
  expect(first.playState).toBe('idle');
});

it('validates the native property subset, numeric timings and ordered transforms', () => {
  const { controller, element } = setup();
  expect(
    transformCss([{ translateX: 12 }, { rotate: '90deg' }, { scale: 0.95 }]),
  ).toBe('translateX(12px) rotate(1.5707963267948966rad) scale(0.95)');
  expect(() => transformCss([{ scale: 1 }, { scale: 2 }])).toThrow(
    'duplicate scale',
  );
  expect(() =>
    controller.create(element, [{ opacity: 0 }], { duration: -1 }),
  ).toThrow('nonnegative');
  expect(() => controller.create(element, [{}])).toThrow(
    'supported properties',
  );
  expect(() =>
    controller.create(element, [
      { transform: [{ scale: 1 }, { translateX: 0 }] },
      { transform: [{ translateX: 10 }, { scale: 2 }] },
    ]),
  ).toThrow('shared operation order');
});

it('preserves ordered transform interpolation and retargets from the browser effect progress', () => {
  const { controller, element, animations, submit } = setup();
  element.style.transform = 'scale(1) translateX(0px)';
  controller.create(
    element,
    [{ transform: [{ scale: 2 }, { translateX: 10 }] }],
    { duration: 100, fill: 'forwards' },
  );
  expect(submit.mock.calls[0]![0]).toEqual([
    { transform: 'scale(1) translateX(0px)' },
    { transform: 'scale(2) translateX(10px)' },
  ]);
  Object.defineProperty(animations[0], 'effect', {
    value: { getComputedTiming: () => ({ progress: 0.5 }) },
  });
  controller.create(
    element,
    [{ transform: [{ scale: 1 }, { translateX: 20 }] }],
    { duration: 100 },
  );
  expect(submit.mock.calls[1]![0][0]).toEqual({
    transform: 'scale(1.5) translateX(5px)',
  });
  expect(() =>
    controller.create(element, [
      { transform: [{ translateX: 0 }, { scale: 1 }] },
    ]),
  ).toThrow('shared operation order');
});

it('submits springs as one browser-owned curve and preserves analytic velocity on retarget', () => {
  const { controller, element, submit, animations } = setup();
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  element.style.opacity = '0';
  const first = controller.create(element, [{ opacity: 1 }], {
    type: 'spring',
    stiffness: 300,
    damping: 25,
    fill: 'forwards',
  });
  const options = submit.mock.calls[0]![1]!;
  const frames = submit.mock.calls[0]![0];
  expect(frames.length).toBeGreaterThan(10);
  expect(frames[0]!.opacity).toBe(0);
  expect(frames.at(-1)!.opacity).toBe(1);
  expect(options.easing).toBe('linear');
  expect(options.duration).toBeGreaterThan(100);
  animations[0]!.currentTime = 75;
  const velocity = first.springVelocity('opacity');
  expect(velocity).toBeGreaterThan(0);
  element.style.opacity = '0.4';
  const next = controller.create(element, [{ opacity: 0 }], {
    type: 'spring',
    stiffness: 300,
    damping: 25,
    fill: 'forwards',
  });
  expect(first.playState).toBe('idle');
  expect(next.springVelocity('opacity')).toBeCloseTo(velocity!, 10);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(raf).not.toHaveBeenCalled();
});

it('passes native keyframe offsets, per-frame easing, paint and repetition to the browser', () => {
  const { controller, element, submit } = setup();
  const animation = controller.create(
    element,
    [
      { opacity: 0, backgroundColor: '#ff0000', offset: 0, easing: 'ease-in' },
      { opacity: 1, backgroundColor: '#0000ff', offset: 0.3 },
      { opacity: 0.5, backgroundColor: '#00ff00', offset: 1 },
    ],
    { duration: 100, iterations: 3, direction: 'alternate', fill: 'both' },
  );
  expect(submit.mock.calls[0]![0]).toEqual([
    { opacity: 0, backgroundColor: '#ff0000', offset: 0, easing: 'ease-in' },
    { opacity: 1, backgroundColor: '#0000ff', offset: 0.3 },
    { opacity: 0.5, backgroundColor: '#00ff00', offset: 1 },
  ]);
  expect(submit.mock.calls[0]![1]).toMatchObject({
    duration: 100,
    iterations: 3,
    direction: 'alternate',
    fill: 'both',
  });
  animation.pause();
  animation.currentTime = 175;
  expect(animation.currentTime).toBe(175);
  expect(animation.playState).toBe('paused');
  expect(() =>
    controller.create(element, [
      { opacity: 0, offset: 0.8 },
      { opacity: 1, offset: 0.2 },
    ]),
  ).toThrow('nondecreasing');
  expect(() =>
    controller.create(element, [{ backgroundColor: 'red' }], {
      type: 'spring',
    }),
  ).toThrow('numeric opacity');
});

it('compiles sequence, delay and repeat once and exposes one completion handle', async () => {
  const { controller, element, submit, animations } = setup();
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  const handle = controller.createProgram(element, {
    kind: 'sequence',
    children: [
      {
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        options: { duration: 100 },
      },
      { kind: 'delay', duration: 50 },
      { keyframes: [{ opacity: 0 }], options: { duration: 100 } },
    ],
    options: { fill: 'forwards', iterations: 2, direction: 'alternate' },
  });
  expect(submit).toHaveBeenCalledTimes(2); // One compiled target curve and one clock.
  const frames = submit.mock.calls[0]![0];
  expect(frames[0]!.opacity).toBe(0);
  expect(frames.at(-1)!.opacity).toBe(0);
  expect(submit.mock.calls[1]![1]).toMatchObject({ duration: 500 });
  handle.pause();
  handle.currentTime = 175;
  expect(animations.map((animation) => animation.currentTime)).toEqual([
    175, 175,
  ]);
  handle.resume();
  handle.finish();
  await handle.finished;
  expect(handle.currentTime).toBe(500);
  expect(raf).not.toHaveBeenCalled();
});

it('owns all parallel targets atomically, validates overlaps before cancellation and cancels on conflicts', async () => {
  const { controller, element, animations } = setup();
  const other = document.createElement('div');
  const otherAnimations: BrowserAnimation[] = [];
  Object.defineProperty(other, 'animate', {
    value: () => {
      const animation = new BrowserAnimation();
      otherAnimations.push(animation);
      return animation;
    },
  });
  const target = {
    animationElement: (owner: AnimationController) => {
      expect(owner).toBe(controller);
      return other;
    },
  } as unknown as import('./node').UiNode;
  const program = controller.createProgram(element, {
    kind: 'parallel',
    children: [
      {
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        options: { duration: 100 },
      },
      {
        target,
        keyframes: [
          { transform: [{ scale: 1 }] },
          { transform: [{ scale: 2 }] },
        ],
        options: { duration: 200 },
      },
    ],
    options: { fill: 'both' },
  });
  expect(() =>
    controller.createProgram(element, {
      kind: 'parallel',
      children: [
        { keyframes: [{ opacity: 0 }] },
        { keyframes: [{ opacity: 1 }] },
      ],
    }),
  ).toThrow('disjoint');
  expect(program.playState).toBe('running');
  controller.create(other, [{ transform: [{ scale: 3 }] }]);
  expect(program.playState).toBe('idle');
  expect(animations[0]!.playState).toBe('idle');
  expect(otherAnimations[0]!.playState).toBe('idle');
  await expect(program.finished).rejects.toMatchObject({ name: 'AbortError' });
});

it('encodes infinite phases after a finite prefix without per-phase JS callbacks and finishes them for reduced motion', async () => {
  const { controller, element, submit } = setup();
  const handle = controller.createProgram(element, {
    kind: 'sequence',
    children: [
      { kind: 'delay', duration: 50 },
      {
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        options: {
          duration: 100,
          iterations: Infinity,
          direction: 'alternate',
        },
      },
    ],
    options: { fill: 'forwards' },
  });
  expect(submit).toHaveBeenCalledTimes(3);
  expect(submit.mock.calls[1]![1]).toMatchObject({
    duration: 200,
    delay: 50,
    iterations: Infinity,
  });
  expect(() => handle.finish()).toThrow('infinite');
  handle.currentTime = 175;
  controller.reducedMotion = true;
  await handle.finished;
  expect(handle.playState).toBe('finished');
  expect(handle.currentTime).toBe(150);
  expect(submit.mock.calls.at(-1)![0]).toEqual([
    { opacity: 1 },
    { opacity: 1 },
  ]);
});

it('captures the directed endpoint of a group as the next implicit origin', () => {
  const { controller, element, submit } = setup();
  element.style.opacity = '1';
  controller.createProgram(element, {
    kind: 'sequence',
    children: [
      {
        kind: 'sequence',
        children: [{ keyframes: [{ opacity: 0 }], options: { duration: 100 } }],
        options: { direction: 'reverse' },
      },
      { keyframes: [{ opacity: 0 }], options: { duration: 100 } },
    ],
  });
  const frames = submit.mock.calls[0]![0];
  const middle = frames.find((frame) => frame.offset === 0.75)!;
  expect(middle.opacity).toBeCloseTo(0.5);
});
