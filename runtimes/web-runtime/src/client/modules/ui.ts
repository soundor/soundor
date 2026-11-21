// `soundor:ui` in the browser: the plugin view's node tree, drawn with DOM
// elements in the host's plugin viewport. The same plugin code (and
// @soundor/react) runs on it as on the native runtime's Skia renderer.

// The engine (`@soundor/engine/web`) is the view: its C++ core, compiled to
// WebAssembly, holds the tree and lays it out; its DOM adapter shows it and
// routes input. This module gives plugin code the page's engine.

import {
  installResizeObserver,
  type AnimationDescription,
  type AnimationOptions,
  type EditorSize,
  type Style,
  type UiNode,
  type ViewSize,
} from '@soundor/engine/web';

import { uiView } from '../context';
import { registerFont as register, type FontDescriptors } from '../ui/fonts';
export {
  effect,
  sequence,
  parallel,
  stagger,
  delay,
  repeat,
} from '@soundor/engine/web';
export function animate(
  description: AnimationDescription,
  options?: AnimationOptions,
): ReturnType<UiNode['animate']> {
  return root.animate(description, options);
}

export function isVisible(): boolean {
  return view.isVisible();
}
export function subscribeVisibility(
  listener: (visible: boolean) => void,
): () => void {
  return view.subscribeVisibility(listener);
}

export function isFocused(): boolean {
  return view.isFocused();
}
export function subscribeFocus(
  listener: (focused: boolean) => void,
): () => void {
  return view.subscribeFocus(listener);
}

const view = uiView();

// ResizeObserver observes nodes, as in the engine; DOM elements as before.
installResizeObserver();

/** The view's root node; it always fills the view. */
export const root = view.root;

/**
 * The view's overlay layer: a second root, over all of root and hit before
 * it, letting the pointer through where nothing in it takes it.
 */
export const overlayRoot = view.overlay;

/** A new, detached view: a box laid out with flexbox. */
export function createView(style?: Style): UiNode {
  return view.createView(style);
}

/** A new, detached text node. */
export function createText(text = '', style?: Style): UiNode {
  return view.createText(text, style);
}

/** A new, detached image showing a bundled asset. */
export function createImage(source = '', style?: Style): UiNode {
  return view.createImage(source, style);
}

/** A root vector viewport; internal shapes have no UI/layout nodes. */
export function createSvg(style?: Style): UiNode {
  return view.createSvg(style);
}

/**
 * A new, detached canvas: pixels code draws with getContext('2d'), 300 by
 * 150 until its width and height say otherwise. Its box is that size in
 * logical pixels unless its style sizes it.
 */
export function createCanvas(style?: Style): UiNode {
  return view.createCanvas(style);
}

// The browser's own canvas classes, which soundor:ui exports natively too.
export const CanvasRenderingContext2D = globalThis.CanvasRenderingContext2D;
export const CanvasGradient = globalThis.CanvasGradient;
export const CanvasPattern = globalThis.CanvasPattern;
export const ImageData = globalThis.ImageData;
export const TextMetrics = globalThis.TextMetrics;
export const WebGL2RenderingContext = globalThis.WebGL2RenderingContext;

/** A new, detached single-line text input. It is focusable. */
export function createTextInput(
  options: { value?: string; placeholder?: string; style?: Style } = {},
): UiNode {
  return view.createTextInput(options);
}

/**
 * The view's size in logical pixels, device pixels per logical pixel and its
 * safe area: the same frozen object until one of them changes.
 */
export function viewSize(): ViewSize {
  return view.size();
}

/**
 * Calls `listener` with the new viewSize() whenever the view's size, scale
 * or safe area changes. Returns a function that unsubscribes.
 */
export function subscribeViewSize(
  listener: (size: ViewSize) => void,
): () => void {
  return view.subscribeSize(listener);
}

/**
 * The size of the plugin viewport on the host's page, in the editor's
 * logical pixels: the same frozen object until it changes.
 */
export function editorSize(): EditorSize {
  return view.editorSize();
}

/**
 * Asks for the plugin viewport to be `width`×`height` editor pixels, held to
 * the editor's limits and the page's room, as its handle resizes it, and
 * returns that size; null where it cannot be asked (`?embed`, a fixed
 * editor). The viewport resizes with the host page's next render;
 * subscribeEditorSize() tells of it.
 */
export function requestEditorSize(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } | null {
  return view.requestEditorSize(width, height);
}

/**
 * Calls `listener` with the new editorSize() whenever the viewport changes
 * size, or whether it can be asked for, whoever resized it. Returns a
 * function that unsubscribes.
 */
export function subscribeEditorSize(
  listener: (size: EditorSize) => void,
): () => void {
  return view.subscribeEditorSize(listener);
}

/**
 * Makes a bundled font file a face of `family`, as CSS's @font-face does.
 * Resolves once the font is ready; rejects if the file is not a font.
 */
export function registerFont(
  family: string,
  source: string,
  descriptors?: FontDescriptors,
): Promise<void> {
  return register(family, source, descriptors);
}

/** Ends the pointer lock, if any: the pointer shows again where it began. */
export function exitPointerLock(): void {
  view.exitPointerLock();
}

/**
 * Has assistive technology speak `message`: an ARIA live region's, polite
 * or assertive.
 */
export function announce(
  message: string,
  options?: { priority?: 'polite' | 'assertive' },
): void {
  view.announce(message, options);
}

/** The node holding the pointer lock, if any. */
export function pointerLockNode(): UiNode | null {
  return view.pointerLockNode();
}

/** The node that has keyboard focus, if any. */
export function focusedNode(): UiNode | null {
  return view.focusedNode();
}

/** The clipboard's text (navigator.clipboard's shape). */
export const clipboard = Object.freeze({
  readText: (): Promise<string> => view.readClipboard(),
  writeText: (text: string): Promise<void> => view.writeClipboard(String(text)),
});

export {
  pressable,
  type PressableHandlers,
  type PressableState,
} from '@soundor/engine/web';

export {
  AccessibilityActionEvent,
  FocusEvent,
  InputEvent,
  KeyboardEvent,
  PointerEvent,
  UiAnimation,
  UiNode,
  WheelEvent,
} from '@soundor/engine/web';
export function setReducedMotion(value: boolean): void {
  view.animations.reducedMotion = value;
}
export function prefersReducedMotion(): boolean {
  return view.animations.reducedMotion;
}
