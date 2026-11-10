import { RUNTIME_API_VERSION } from '@soundor/runtime-sdk';
import { describe, expect, it } from 'vitest';

import { juceRuntime } from './index';

describe('compatibility', () => {
  // A raise of the runtime API version needs this runtime checked against it,
  // and, if it implements what the raise adds, released with it.
  it('implements the runtime API version it is built with', () => {
    expect(juceRuntime.runtime.apiVersion).toBe(RUNTIME_API_VERSION);
  });
});
