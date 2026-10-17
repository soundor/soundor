import { type RefObject, useEffect, useState } from 'react';

export interface Fullscreen {
  readonly expanded: boolean;
  expand(): void;
  collapse(): void;
}

/**
 * Full screen for a live preview's figure: the Fullscreen API where the page
 * may use it, else the figure covering the window (iOS). Escape leaves.
 */
export function useFullscreen(
  figure: RefObject<HTMLElement | null>,
): Fullscreen {
  const [expanded, setExpanded] = useState(false);

  const collapse = () => {
    setExpanded(false);
    if (document.fullscreenElement !== null) void document.exitFullscreen();
  };

  useEffect(() => {
    if (!expanded) return;
    // The browser leaves full screen on Escape itself.
    const left = () => {
      if (document.fullscreenElement === null) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      // Not when the editor used it, to close its completions, say.
      if (event.key === 'Escape' && !event.defaultPrevented) collapse();
    };
    // The page under it stays put, and gives up its scrollbar's room.
    const { body, documentElement: root } = document;
    const saved = [body.style.overflow, root.style.scrollbarGutter] as const;
    body.style.overflow = 'hidden';
    root.style.scrollbarGutter = 'auto';
    document.addEventListener('fullscreenchange', left);
    document.addEventListener('keydown', escape);
    return () => {
      [body.style.overflow, root.style.scrollbarGutter] = saved;
      document.removeEventListener('fullscreenchange', left);
      document.removeEventListener('keydown', escape);
    };
  }, [expanded]);

  return {
    expanded,
    expand: () => {
      setExpanded(true);
      figure.current?.requestFullscreen?.().catch(() => {});
    },
    collapse,
  };
}
