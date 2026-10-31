/**
 * The handle at a resizable plugin view's bottom-right corner, outside the
 * view so that it never covers the plugin's own controls. Dragging it
 * changes the view's logical size (its UI is laid out again, not scaled);
 * with focus, the arrow keys do. The view stays centred on the stage, so
 * the size changes by twice the pointer's movement: the corner follows it.
 */

import { useRef } from 'preact/hooks';

import type { WebEditor } from '../manifest';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** How far an arrow key resizes, in logical pixels (with Shift: five times). */
const KEY_STEP = 10;

export interface ResizeHandleProps {
  readonly editor: WebEditor;
  /** The view's logical size. */
  readonly size: Size;
  /** CSS pixels per logical pixel: the stage may scale the view down. */
  readonly scale: number;
  /** The stage's room for the view in CSS pixels, once measured. */
  readonly room: Size | null;
  onResize(size: Size): void;
}

interface Drag {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly from: Size;
  readonly scale: number;
}

/**
 * `size` within the editor's limits and, unless it is larger already, the
 * stage's room: a view dragged past the stage's edge stops there instead of
 * being scaled down.
 */
export function constrainSize(
  editor: WebEditor,
  size: Size,
  room: Size | null,
  from: Size = size,
): Size {
  const axis = (value: number, min: number, max: number, fit: number) =>
    Math.min(
      Math.max(Math.round(value), min),
      Math.max(min, Math.min(max, fit)),
    );
  return {
    width: axis(
      size.width,
      editor.minWidth,
      editor.maxWidth,
      room === null ? Infinity : Math.max(from.width, Math.floor(room.width)),
    ),
    height: axis(
      size.height,
      editor.minHeight,
      editor.maxHeight,
      room === null ? Infinity : Math.max(from.height, Math.floor(room.height)),
    ),
  };
}

export function ResizeHandle({
  editor,
  size,
  scale,
  room,
  onResize,
}: ResizeHandleProps) {
  const dragRef = useRef<Drag | null>(null);
  const end = (event: PointerEvent, cancelled: boolean): void => {
    const current = dragRef.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    // A cancelled drag (the browser took the pointer) leaves the size as it was.
    if (cancelled) onResize(current.from);
  };
  return (
    <button
      type="button"
      class="soundor-resize"
      aria-label="Resize the plugin view"
      title={`${size.width} × ${size.height}: drag to resize`}
      onPointerDown={(event) => {
        if (event.button !== 0 || dragRef.current !== null) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          from: size,
          scale,
        };
      }}
      onPointerMove={(event) => {
        const current = dragRef.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        const factor = 2 / current.scale;
        onResize(
          constrainSize(
            editor,
            {
              width: current.from.width + (event.clientX - current.x) * factor,
              height:
                current.from.height + (event.clientY - current.y) * factor,
            },
            room,
            current.from,
          ),
        );
      }}
      onPointerUp={(event) => end(event, false)}
      onPointerCancel={(event) => end(event, true)}
      onLostPointerCapture={(event) => end(event, false)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? KEY_STEP * 5 : KEY_STEP;
        const [width, height] =
          {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          }[event.key] ?? [];
        if (width === undefined || height === undefined) return;
        event.preventDefault();
        onResize(
          constrainSize(
            editor,
            { width: size.width + width, height: size.height + height },
            room,
          ),
        );
      }}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M12 2v10H2z" />
      </svg>
    </button>
  );
}
