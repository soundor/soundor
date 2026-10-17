// @vitest-environment happy-dom
import { fireEvent } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';

import { startAudioOnGesture } from './gesture';

function setup(isActive?: () => boolean) {
  if (isActive !== undefined) {
    vi.stubGlobal('navigator', {
      ...navigator,
      userActivation: {
        get isActive() {
          return isActive();
        },
      },
    });
  }
  const start = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const stop = startAudioOnGesture(document, { start });
  return { start, stop };
}

describe('startAudioOnGesture', () => {
  it('starts audio on the first gesture anywhere, once', () => {
    const { start } = setup();
    const knob = document.body.appendChild(document.createElement('div'));
    fireEvent.pointerDown(knob);
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(start).toHaveBeenCalledOnce();
  });

  it('waits for an event the browser counts as a gesture', () => {
    let active = false;
    const { start } = setup(() => active);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(start).not.toHaveBeenCalled();
    active = true;
    fireEvent.pointerUp(document.body);
    expect(start).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('stops listening when asked', () => {
    const { start, stop } = setup();
    stop();
    fireEvent.pointerDown(document.body);
    expect(start).not.toHaveBeenCalled();
  });
});
