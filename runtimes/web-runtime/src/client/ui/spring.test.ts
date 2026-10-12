import { expect, it } from 'vitest';

import { sampleSpring, springDuration, springParameters } from './spring';

it('matches analytic stepping in underdamped, critically damped and overdamped motion', () => {
  for (const damping of [10, 20, 40]) {
    const parameters = springParameters({ damping });
    expect(sampleSpring(parameters, 0, 0, 1, 2)).toEqual({
      position: 0,
      velocity: 2,
    });
    const half = sampleSpring(parameters, 0.1, 0, 1, 2),
      whole = sampleSpring(parameters, 0.2, 0, 1, 2);
    const stepped = sampleSpring(
      parameters,
      0.1,
      half.position,
      1,
      half.velocity,
    );
    expect(stepped.position).toBeCloseTo(whole.position, 12);
    expect(stepped.velocity).toBeCloseTo(whole.velocity, 12);
    const duration = springDuration(parameters, 0, 1, 2);
    for (const extra of [0, 0.03, 0.1, 1]) {
      const final = sampleSpring(parameters, duration / 1000 + extra, 0, 1, 2);
      expect(Math.abs(final.position - 1)).toBeLessThanOrEqual(
        parameters.restDisplacement,
      );
      expect(Math.abs(final.velocity)).toBeLessThanOrEqual(
        parameters.restVelocity,
      );
    }
  }
});
it('retargets with unchanged position and velocity and rejects invalid physics', () => {
  const parameters = springParameters({ stiffness: 300, damping: 25, mass: 1 });
  const old = sampleSpring(parameters, 0.075, 0, 1, 0);
  expect(sampleSpring(parameters, 0, old.position, 0, old.velocity)).toEqual(
    old,
  );
  expect(springDuration(parameters, 1, 1, 0)).toBe(0);
  for (const bad of [
    { mass: 0 },
    { damping: -1 },
    { stiffness: Infinity },
    { restVelocity: 0 },
    { initialVelocity: NaN },
  ])
    expect(() => springParameters(bad)).toThrow('spring parameters');
});
