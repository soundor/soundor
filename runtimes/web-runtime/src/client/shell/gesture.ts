import type { WebAudioHost } from '../audio';

/**
 * The events that count as a user gesture, which browsers require before a
 * page plays audio: a key, a mouse button, or a touch lifted.
 */
const GESTURES = ['keydown', 'pointerdown', 'pointerup', 'touchend'] as const;

/**
 * Starts audio on the page's first user gesture, wherever it is: on the
 * plugin (a knob, a key) as much as on the host's controls. Listens no more
 * once audio starts; returns a function that stops listening earlier.
 */
export function startAudioOnGesture(
  target: Document,
  audio: Pick<WebAudioHost, 'start'>,
): () => void {
  const activation = target.defaultView?.navigator.userActivation;
  const start = (): void => {
    // Not every event of these kinds is a gesture (Escape, say): wait.
    if (activation !== undefined && !activation.isActive) return;
    stop();
    void audio.start();
  };
  const stop = (): void => {
    for (const type of GESTURES) {
      target.removeEventListener(type, start, { capture: true });
    }
  };
  for (const type of GESTURES) {
    target.addEventListener(type, start, { capture: true });
  }
  return stop;
}
