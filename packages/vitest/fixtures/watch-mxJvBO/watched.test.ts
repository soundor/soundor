import { parameters } from 'soundor:parameters';
import { test, expect } from 'vitest';
test('watch value', () => expect(parameters.gain.get()).toBe(2));
