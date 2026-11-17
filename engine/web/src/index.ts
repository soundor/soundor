// @soundor/engine/web: Soundor's engine in a browser. Its C++ core (the node
// tree, styles, Yoga layout and text layout, the same sources a plugin's
// engine compiles) runs as WebAssembly, and its DOM adapter shows the tree as
// real HTML elements and routes the browser's input to Soundor events: what
// the web runtime's soundor:ui is. The module (soundor-core.wasm) is built
// separately (`pnpm --filter @soundor/engine build:wasm`) and not part of
// this package.

export { Engine, type EngineOptions } from './ui/view.ts';
export { UiNode } from './ui/node.ts';
export type { ModuleSource } from './core.ts';
export {
  AccessibilityActionEvent,
  FocusEvent,
  InputEvent,
  KeyboardEvent,
  PointerEvent,
  WheelEvent,
} from './ui/events.ts';
export { UiAnimation } from './ui/animation.ts';
export {
  pressable,
  type PressableHandlers,
  type PressableState,
} from './ui/pressable.ts';
export {
  delay,
  effect,
  parallel,
  repeat,
  sequence,
  stagger,
} from './ui/animation-description.ts';
export {
  installResizeObserver,
  type NodeResizeObserver,
} from './ui/resize-observer.ts';
export type * from './ui/types.ts';
