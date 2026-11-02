/**
 * The handle at a resizable plugin view's bottom-right corner, outside the
 * view so that it never covers the plugin's own controls. Dragging it
 * changes the view's size: its logical size, so its UI is laid out again,
 * or with an editor that scales the size its layout is drawn at, keeping
 * its aspect ratio unless told not to (keepAspectRatio: false). With focus,
 * the arrow keys do. The view stays centred
 * on the stage, so the size changes by twice the pointer's movement: the
 * corner follows it.
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
  /**
   * The view's size: its logical size, or with an editor that scales, the
   * size its layout is drawn at.
   */
  readonly size: Size;
  /** CSS pixels per unit of `size`: the stage may scale the view down. */
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
 * being scaled down. An editor that scales keeps its aspect ratio, unless
 * told not to.
 */
export function constrainSize(
  editor: WebEditor,
  size: Size,
  room: Size | null,
  from: Size = size,
): Size {
  if (editor.resize === 'scale' && editor.keepAspectRatio)
    return constrainZoom(editor, size, room, from);
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

/**
 * The size an editor that scales is drawn at, for a `size` asked for: its
 * own size times the zoom nearest to it (the point at its ratio closest to
 * a corner dragged anywhere), within its limits and, unless it is larger
 * already, the stage's room. `from`, the size it has, decides only that:
 * the same size asked for gets the same answer whatever the size is, or a
 * drag would answer one way and the other in turn as the editor resizes.
 */
function constrainZoom(
  editor: WebEditor,
  size: Size,
  room: Size | null,
  from: Size,
): Size {
  const { width, height } = editor;
  const wanted =
    (size.width * width + size.height * height) /
    (width * width + height * height);
  const min = Math.max(editor.minWidth / width, editor.minHeight / height);
  const max = Math.min(editor.maxWidth / width, editor.maxHeight / height);
  const fit =
    room === null
      ? Infinity
      : Math.max(
          Math.min(from.width / width, from.height / height),
          Math.min(room.width / width, room.height / height),
        );
  const zoom = Math.min(
    Math.max(wanted, min),
    Math.max(min, Math.min(max, fit)),
  );
  return { width: Math.round(width * zoom), height: Math.round(height * zoom) };
}

/**
 * The zoom an editor's layout is drawn at in `size`: 1 unless it scales;
 * then the smaller of the two axes, so it is never stretched, and never
 * beyond what its maximum allows.
 */
export function zoomOf(editor: WebEditor, size: Size): number {
  return editor.resizable && editor.resize === 'scale'
    ? Math.min(
        size.width / editor.width,
        size.height / editor.height,
        editor.maxWidth / editor.width,
        editor.maxHeight / editor.height,
      )
    : 1;
}

export interface Rect extends Size {
  readonly x: number;
  readonly y: number;
}

/** How an editor of `size` shows its UI, as the JUCE editor does. */
export interface ViewLayout {
  /** CSS pixels per layout pixel, before the stage's own scaling. */
  readonly zoom: number;
  /** The size the UI is laid out at, in its logical pixels. */
  readonly layout: Size;
  /** The part of the layout always shown whole; null for all of it. */
  readonly safeArea: Rect | null;
}

/**
 * How an editor shows its UI in `size` (its own pixels): a fixed one lays it
 * out at `size`. One that lays out again does too, up to its maximum: beyond
 * it (a page that embeds it larger), fit 'contain' lays it out at the
 * maximum, centred in bands, and 'cover' over all of it, the maximum in the
 * middle being its safe area. One that scales zooms its layout by the
 * smaller side, up to the zoom its maximum allows: 'contain' draws it
 * centred in bands, 'cover' lays it out over all of `size`, its configured
 * size in the middle being the safe area.
 */
export function viewLayout(editor: WebEditor, size: Size): ViewLayout {
  if (!editor.resizable) return { zoom: 1, layout: size, safeArea: null };
  const centred = (whole: Size, part: Size): Rect => ({
    x: (whole.width - part.width) / 2,
    y: (whole.height - part.height) / 2,
    width: part.width,
    height: part.height,
  });
  if (editor.resize === 'scale') {
    const zoom = zoomOf(editor, size);
    const configured = { width: editor.width, height: editor.height };
    if (editor.fit !== 'cover')
      return { zoom, layout: configured, safeArea: null };
    const layout = { width: size.width / zoom, height: size.height / zoom };
    return { zoom, layout, safeArea: centred(layout, configured) };
  }
  const held = {
    width: Math.min(size.width, editor.maxWidth),
    height: Math.min(size.height, editor.maxHeight),
  };
  if (editor.fit !== 'cover') return { zoom: 1, layout: held, safeArea: null };
  const beyond = held.width < size.width || held.height < size.height;
  return {
    zoom: 1,
    layout: size,
    safeArea: beyond ? centred(size, held) : null,
  };
}

/** Whether the user can change an editor's size: limits that allow none do not. */
export function canResize(editor: WebEditor): boolean {
  return (
    editor.resizable &&
    (editor.minWidth < editor.maxWidth || editor.minHeight < editor.maxHeight)
  );
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
            size,
          ),
        );
      }}
    >
      <svg class="soundor-glyph" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M12 2v10H2z" />
      </svg>
    </button>
  );
}
