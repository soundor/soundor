import type { ReactNode } from 'react';
import createReconciler from 'react-reconciler';
import { ConcurrentRoot } from 'react-reconciler/constants';
import { root as viewRoot, type UiNode } from 'soundor:ui';

import { hostConfig } from './host';

/** The one renderer: roots and portals share it. */
export const reconciler = createReconciler(hostConfig as never);

function report(kind: string) {
  return (error: unknown) => {
    // reportError() logs it like an uncaught exception, with its stack.
    reportError(
      error instanceof Error ? error : new Error(`${kind}: ${String(error)}`),
    );
  };
}

export interface Root {
  /** Renders `element` into the root's node, replacing what it showed. */
  render(element: ReactNode): void;
  /** Removes what the root rendered. */
  unmount(): void;
}

/**
 * A React root that renders into `container`: by default the view's root
 * node, so the app fills the plugin view.
 */
export function createRoot(container: UiNode = viewRoot): Root {
  const fiberRoot = reconciler.createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    'soundor',
    report('Uncaught error'),
    report('Caught error'),
    report('Recoverable error'),
    () => {},
    // Transition tracing (not used). react-reconciler 0.34 no longer takes
    // this argument; its types (0.33) still list it.
    null,
  );
  return {
    render(element) {
      reconciler.updateContainer(element, fiberRoot, null, null);
    },
    unmount() {
      reconciler.updateContainer(null, fiberRoot, null, null);
    },
  };
}

/** Renders `element` into the plugin view: createRoot().render(element). */
export function render(element: ReactNode): Root {
  const root = createRoot();
  root.render(element);
  return root;
}

/** Runs `fn` and applies the updates it schedules before returning. */
export function flushSync<T>(fn: () => T): T {
  return reconciler.flushSyncFromReconciler(fn) as T;
}
