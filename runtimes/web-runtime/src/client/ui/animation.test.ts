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
      { opacity: '0.25', transform: 'none' },
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
  ).toThrow('same order');
});
