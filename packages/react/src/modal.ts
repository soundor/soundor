/**
 * Modal: an overlay that takes the view's input until it closes. It is a
 * Portal entry like any other, inside the plugin's one view: no window, no
 * second surface.
 */

import {
  createElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  overlayRoot,
  root,
  type KeyboardEvent,
  type PointerEvent,
  type Style,
  type UiNode,
} from 'soundor:ui';

import { View } from './components';
import { FocusScope } from './focus';
import { prioritized } from './host';
import { OverlayEntry } from './portal';
import type { StyleProp } from './style';

// ── Dismissal ─────────────────────────────────────────────────────────────────

/**
 * Open modals that can be asked to close, by when they opened; the last one
 * is on top. A request (Escape now; a platform's Back later) goes to it.
 */
const dismissible: { order: number; request: () => void }[] = [];
const listening = new WeakSet<UiNode>();

/** Asks the topmost modal to close; whether there was one to ask. */
function requestDismiss(): boolean {
  const top = dismissible.at(-1);
  if (top === undefined) return false;
  top.request();
  return true;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.key !== 'Escape') return;
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  prioritized(event.type, () => {
    if (requestDismiss()) event.preventDefault();
  });
}

/** Keys reach the root of wherever focus is, or root when nothing has it. */
function listen(): void {
  for (const tree of [root, overlayRoot]) {
    if (listening.has(tree)) continue;
    listening.add(tree);
    tree.addEventListener('keydown', onKeyDown);
  }
}

// ── The component ─────────────────────────────────────────────────────────────

export interface ModalProps {
  children?: ReactNode;
  /** Whether it shows: true by default. The caller decides; see onRequestClose. */
  visible?: boolean;
  /**
   * Asked to close (Escape, or a press on the backdrop when
   * dismissOnBackdropPress): set `visible` to false to close it.
   */
  onRequestClose?: () => void;
  /** A press on the backdrop itself (not the content) asks to close. */
  dismissOnBackdropPress?: boolean;
  /** The backdrop's style (transparent by default): a dimming color, say. */
  backdropStyle?: StyleProp;
  /** What assistive technology calls the dialog. */
  accessibilityLabel?: string;
}

const FILL: Style = {
  position: 'absolute',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
};
const CONTENT: Style = { ...FILL, pointerEvents: 'box-none' };

/** Numbers modals as they render: a modal opened from another is above it. */
let openings = 0;

function ModalLayer({
  children,
  onRequestClose,
  dismissOnBackdropPress,
  backdropStyle,
}: Omit<ModalProps, 'visible' | 'accessibilityLabel'>): ReactNode {
  const [order] = useState(() => ++openings);
  // The latest handler, for requests that come in later.
  const latest = useRef(onRequestClose);
  useLayoutEffect(() => {
    latest.current = onRequestClose;
  });

  useLayoutEffect(() => {
    listen();
    const entry = { order, request: () => latest.current?.() };
    const above = dismissible.findIndex((other) => other.order > order);
    if (above < 0) dismissible.push(entry);
    else dismissible.splice(above, 0, entry);
    return () => {
      dismissible.splice(dismissible.indexOf(entry), 1);
    };
  }, [order, latest]);

  const backdrop = createElement(View, {
    style: [FILL, backdropStyle],
    // A press here does not take focus from the modal's content.
    onPointerDown: (event: PointerEvent) => event.preventDefault(),
    onClick: (event: PointerEvent) => {
      if (event.target === event.currentTarget && dismissOnBackdropPress)
        onRequestClose?.();
    },
  });
  return createElement(
    FocusScope,
    { trapped: true, autoFocus: true, restoreFocus: true },
    backdrop,
    createElement(View, { style: CONTENT }, children),
  );
}

/**
 * A modal layer over the whole view: its children over a backdrop that
 * blocks the pointer from everything below, with focus trapped inside
 * (focused on open, given back on close). Escape, and a backdrop press when
 * `dismissOnBackdropPress`, call `onRequestClose`; the modal stays until
 * `visible` is false.
 *
 * It is a Portal entry: it stacks above overlays opened before it, and
 * portals opened from inside it stack above it. It is not a window.
 *
 * To assistive technology it is a modal dialog: while it shows, only it is
 * perceived, with the overlays opened from inside it (the topmost modal,
 * when several are open).
 */
export function Modal({
  visible = true,
  accessibilityLabel,
  ...props
}: ModalProps): ReactNode {
  if (!visible) return null;
  return createElement(
    OverlayEntry,
    {
      accessibility: {
        role: 'dialog',
        modal: true,
        ...(accessibilityLabel !== undefined && { label: accessibilityLabel }),
      },
    },
    createElement(ModalLayer, props),
  );
}
