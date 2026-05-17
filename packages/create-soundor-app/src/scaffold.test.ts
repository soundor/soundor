import { describe, expect, it } from 'vitest';

import { tokenReplace } from './scaffold';

describe('tokenReplace', () => {
  it('replaces __PROJECT_NAME__ with the project name', () => {
    expect(tokenReplace('name: __PROJECT_NAME__', 'my-app', 'juce')).toBe(
      'name: my-app',
    );
  });

  it('replaces __RUNTIME__ with the runtime', () => {
    expect(tokenReplace('runtime: __RUNTIME__', 'my-app', 'juce')).toBe(
      'runtime: juce',
    );
  });

  it('replaces all occurrences', () => {
    const input = '<title>__PROJECT_NAME__</title><h1>__PROJECT_NAME__</h1>';
    expect(tokenReplace(input, 'my-app', 'juce')).toBe(
      '<title>my-app</title><h1>my-app</h1>',
    );
  });

  it('replaces both tokens in the same string', () => {
    const input = 'name: __PROJECT_NAME__, runtime: __RUNTIME__';
    expect(tokenReplace(input, 'soundor-demo', 'juce')).toBe(
      'name: soundor-demo, runtime: juce',
    );
  });

  it('returns content unchanged when no tokens present', () => {
    const input = 'no tokens here';
    expect(tokenReplace(input, 'my-app', 'juce')).toBe('no tokens here');
  });
});
