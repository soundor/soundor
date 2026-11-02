// A resize grip drawn by the plugin, in the corner of its view: dragged, or
// with focus the arrow keys, it asks for another editor size
// (requestEditorSize()), which the editor's limits hold and the host gives,
// or not. It hides where the editor cannot be asked (a fixed editor, a page
// that owns its size).
//
// The drag measures in screenX/Y: the editor's pixels, which neither the
// editor's size nor the zoom of an editor that scales changes, unlike
// clientX/Y. The size it asks for is the size at the press plus how far the
// pointer went, never the last size plus the last step, so nothing drifts.
//
// Its look is the <Svg> below: replace it with anything, keeping the View.

import { View } from '@soundor/react';
import { Path, Svg } from '@soundor/react/svg';
import { useRef, useSyncExternalStore } from 'react';
import {
  editorSize,
  requestEditorSize,
  subscribeEditorSize,
  type KeyboardEvent,
  type PointerEvent,
} from 'soundor:ui';

/** The grip's side, in logical pixels. */
const SIZE = 18;
/** How far an arrow key resizes, in editor pixels (with Shift: five times). */
const KEY_STEP = 10;

interface Drag {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function ResizeGrip({ color = '#8a8f99' }: { readonly color?: string }) {
  const editor = useSyncExternalStore(subscribeEditorSize, editorSize);
  const drag = useRef<Drag | null>(null);
  if (!editor.resizable) return null;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || drag.current !== null) return;
    // The press keeps the pointer's events here until it is released, also
    // where the pointer leaves the grip (or the view).
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId,
      x: event.screenX,
      y: event.screenY,
      width: editor.width,
      height: editor.height,
    };
  };
  const onPointerMove = (event: PointerEvent) => {
    const from = drag.current;
    if (from === null || from.pointerId !== event.pointerId) return;
    requestEditorSize(
      from.width + event.screenX - from.x,
      from.height + event.screenY - from.y,
    );
  };
  const end = (event: PointerEvent, cancelled: boolean) => {
    const from = drag.current;
    if (from === null || from.pointerId !== event.pointerId) return;
    drag.current = null;
    // A drag the platform took back leaves the size as it was.
    if (cancelled) requestEditorSize(from.width, from.height);
  };
  const onKeyDown = (event: KeyboardEvent) => {
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
    requestEditorSize(editor.width + width, editor.height + height);
  };

  return (
    <View
      focusable
      accessibilityRole="button"
      accessibilityLabel="Resize the editor"
      accessibilityHint="Drag, or use the arrow keys"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => end(event, false)}
      onPointerCancel={(event) => end(event, true)}
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: SIZE,
        height: SIZE,
        cursor: 'nwse-resize',
      }}
    >
      <Svg width={SIZE} height={SIZE} viewBox="0 0 18 18">
        <Path
          d="M16 6L6 16M16 11L11 16"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}
