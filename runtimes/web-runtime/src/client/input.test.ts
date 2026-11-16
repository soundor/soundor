import { expect, it } from 'vitest';

import {
  audioFile,
  defineInput,
  microphone,
  oscillator,
  validateInputs,
} from './input';

it('composes built-in factories with the unchanged custom input lifecycle', () => {
  const source = { id: 'test', label: 'Test', start: () => () => {} };
  expect(defineInput(source)).toBe(source);
  const inputs = [
    defineInput(source),
    oscillator({ frequency: 330 }),
    audioFile(),
    microphone(),
  ];
  expect(validateInputs(inputs)).toBe(inputs);
});

it.each([
  undefined,
  null,
  {},
  'bad',
  [null],
  [{ id: '', label: 'Bad', start() {} }],
  [{ id: 'oscillator', label: 'Bad', start() {} }],
  [{ id: 'none', label: 'Bad', start() {} }],
  [{ id: 'demo', label: '', start() {} }],
  [{ id: 'demo', label: 'Bad' }],
  [{ type: 'file' }, { type: 'file' }],
])('rejects invalid module exports %j without falling back', (value) => {
  expect(() => validateInputs(value)).toThrow(/input|Input/);
});
