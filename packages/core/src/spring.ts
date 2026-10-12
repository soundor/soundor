export interface SpringOptions {
  stiffness?: number;
  damping?: number;
  mass?: number;
  initialVelocity?: number;
  restDisplacement?: number;
  restVelocity?: number;
}

export type SpringParameters = Required<
  Pick<
    SpringOptions,
    | 'stiffness'
    | 'damping'
    | 'mass'
    | 'initialVelocity'
    | 'restDisplacement'
    | 'restVelocity'
  >
>;

export function springParameters(options: SpringOptions): SpringParameters {
  const result: SpringParameters = {
    stiffness: options.stiffness ?? 100,
    damping: options.damping ?? 10,
    mass: options.mass ?? 1,
    initialVelocity: options.initialVelocity ?? 0,
    restDisplacement: options.restDisplacement ?? 0.001,
    restVelocity: options.restVelocity ?? 0.001,
  };
  for (const [name, value] of Object.entries(result))
    if (!Number.isFinite(value) || (name !== 'initialVelocity' && value <= 0))
      throw new TypeError(
        'spring parameters must be finite, with positive physics and rest thresholds',
      );
  const rate = result.damping / (2 * result.mass),
    frequencySquared = result.stiffness / result.mass;
  if (
    !Number.isFinite(rate * rate) ||
    rate <= 0 ||
    !Number.isFinite(frequencySquared) ||
    frequencySquared <= 0
  )
    throw new TypeError('spring parameters exceed the supported numeric range');
  return result;
}

export function sampleSpring(
  spring: SpringParameters,
  seconds: number,
  origin: number,
  target: number,
  velocity: number,
): { position: number; velocity: number } {
  if (seconds <= 0) return { position: origin, velocity };
  const displacement = origin - target,
    rate = spring.damping / (2 * spring.mass),
    frequencySquared = spring.stiffness / spring.mass;
  const discriminant = rate * rate - frequencySquared,
    tolerance = 1e-10 * Math.max(rate * rate, frequencySquared);
  let position: number, speed: number;
  if (Math.abs(discriminant) <= tolerance) {
    const coefficient = velocity + rate * displacement,
      decay = Math.exp(-rate * seconds);
    position = decay * (displacement + coefficient * seconds);
    speed =
      decay * (coefficient - rate * (displacement + coefficient * seconds));
  } else if (discriminant < 0) {
    const frequency = Math.sqrt(-discriminant),
      coefficient = (velocity + rate * displacement) / frequency;
    const cosine = Math.cos(frequency * seconds),
      sine = Math.sin(frequency * seconds),
      decay = Math.exp(-rate * seconds);
    position = decay * (displacement * cosine + coefficient * sine);
    speed =
      decay *
      ((coefficient * frequency - rate * displacement) * cosine -
        (displacement * frequency + rate * coefficient) * sine);
  } else {
    const root = Math.sqrt(discriminant),
      slow = -frequencySquared / (rate + root),
      fast = -rate - root;
    const coefficient = (velocity - fast * displacement) / (slow - fast);
    const slowValue = coefficient * Math.exp(slow * seconds),
      fastValue = (displacement - coefficient) * Math.exp(fast * seconds);
    position = slowValue + fastValue;
    speed = slow * slowValue + fast * fastValue;
  }
  return { position: target + position, velocity: speed };
}

export function springDuration(
  spring: SpringParameters,
  origin: number,
  target: number,
  velocity: number,
): number {
  const displacement = origin - target,
    rate = spring.damping / (2 * spring.mass),
    frequencySquared = spring.stiffness / spring.mass;
  const discriminant = rate * rate - frequencySquared,
    tolerance = 1e-10 * Math.max(rate * rate, frequencySquared);
  const atRest = (seconds: number): boolean => {
    let distance: number, speed: number;
    if (Math.abs(discriminant) <= tolerance) {
      const coefficient = Math.abs(velocity + rate * displacement),
        decay = Math.exp(-rate * seconds);
      distance = (Math.abs(displacement) + coefficient * seconds) * decay;
      speed =
        (coefficient +
          rate * Math.abs(displacement) +
          rate * coefficient * seconds) *
        decay;
    } else if (discriminant < 0) {
      const frequency = Math.sqrt(-discriminant),
        coefficient = (velocity + rate * displacement) / frequency,
        decay = Math.exp(-rate * seconds);
      distance = Math.hypot(displacement, coefficient) * decay;
      speed =
        Math.hypot(
          coefficient * frequency - rate * displacement,
          displacement * frequency + rate * coefficient,
        ) * decay;
    } else {
      const root = Math.sqrt(discriminant),
        slow = -frequencySquared / (rate + root),
        fast = -rate - root;
      const coefficient = (velocity - fast * displacement) / (slow - fast);
      const slowValue = Math.abs(coefficient) * Math.exp(slow * seconds),
        fastValue =
          Math.abs(displacement - coefficient) * Math.exp(fast * seconds);
      distance = slowValue + fastValue;
      speed = -slow * slowValue - fast * fastValue;
    }
    return distance <= spring.restDisplacement && speed <= spring.restVelocity;
  };
  if (displacement === 0 && velocity === 0) return 0;
  let high = Math.max(0.001, 2 / rate);
  while (!atRest(high)) {
    high *= 2;
    if (!Number.isFinite(high) || high > Number.MAX_VALUE / 1000)
      throw new TypeError('spring has no finite supported settling time');
  }
  let low = Math.abs(discriminant) <= tolerance ? Math.min(high, 2 / rate) : 0;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (atRest(middle)) high = middle;
    else low = middle;
  }
  return Math.ceil(high * 1000);
}
