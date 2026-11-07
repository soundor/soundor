import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { PointerEvent, UiNode } from 'soundor:ui';

/** What the hook watches, and what tells it. */
interface Watching {
  observer: ResizeObserver | null;
  /** The scroll view, what it scrolls, and the track. */
  sized: readonly (UiNode | null)[];
  /** The scroll view whose `scroll` events it listens to. */
  scrolled: UiNode | null;
}

export interface ScrollbarOptions {
  /** Which way it scrolls; `'vertical'` by default. */
  axis?: 'vertical' | 'horizontal';
  /** The thumb's least length, however much there is to scroll; 16 by default. */
  minThumbLength?: number;
}

export interface Scrollbar {
  /** Whether there is anything to scroll on this axis. */
  visible: boolean;
  /** Whether the pointer is over the track. */
  hovered: boolean;
  /** Whether the track or the thumb is pressed, until its release. */
  pressed: boolean;
  /** For the node the thumb travels along. A press on it jumps there. */
  trackProps: {
    ref: RefObject<UiNode | null>;
    onPointerDown: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerUp: (event: PointerEvent) => void;
    onPointerCancel: (event: PointerEvent) => void;
    onPointerEnter: (event: PointerEvent) => void;
    onPointerLeave: (event: PointerEvent) => void;
  };
  /**
   * For the thumb, the track's first child, at its start. This hook sets its
   * length and its `transform`, without rendering, so leave those out of its style.
   */
  thumbProps: { ref: RefObject<UiNode | null> };
}

/**
 * What a scrollbar of your own needs: draw a track and a thumb however you like,
 * anywhere, and they scroll the scroll view. Give the `ScrollView`
 * `scrollIndicators={false}` to replace its own.
 *
 *   const scroll = useRef<UiNode>(null);
 *   const bar = useScrollbar(scroll);
 *
 *   <ScrollView ref={scroll} scrollIndicators={false}>…</ScrollView>
 *   {bar.visible && (
 *     <View {...bar.trackProps} style={styles.track}>
 *       <View {...bar.thumbProps} style={styles.thumb} />
 *     </View>
 *   )}
 */
export function useScrollbar(
  scroll: RefObject<UiNode | null>,
  options: ScrollbarOptions = {},
): Scrollbar {
  const vertical = (options.axis ?? 'vertical') === 'vertical';
  const minLength = options.minThumbLength ?? 16;
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const track = useRef<UiNode | null>(null);
  const thumb = useRef<UiNode | null>(null);
  const drag = useRef<{ from: number; scroll: number } | null>(null);

  /** What there is to scroll, and how the thumb shows it; null for nothing. */
  const measure = () => {
    const node = scroll.current;
    if (node === null) return null;
    const client = vertical ? node.clientHeight : node.clientWidth;
    // Not laid out, or laid out to nothing: nothing can be asked of it.
    if (client <= 0) return null;
    const content = vertical ? node.scrollHeight : node.scrollWidth;
    if (content <= client + 0.5) return null;
    // What the thumb has to travel along: inside the track's padding.
    const room =
      (vertical ? track.current?.clientHeight : track.current?.clientWidth) ??
      0;
    const length = Math.min(
      room,
      Math.max(minLength, (room * client) / content),
    );
    return {
      node,
      range: content - client,
      length,
      travel: room - length,
      scrolled: vertical ? node.scrollTop : node.scrollLeft,
    };
  };

  const scrollTo = (node: UiNode, position: number) => {
    if (vertical) node.scrollTop = position;
    else node.scrollLeft = position;
  };

  const sync = () => {
    const measured = measure();
    setVisible(measured !== null);
    const bar = thumb.current;
    if (measured === null || bar === null) return;
    const at =
      measured.travel > 0
        ? (measured.travel * measured.scrolled) / measured.range
        : 0;
    const style = bar.style;
    const size = vertical ? style.height : style.width;
    const moved = style.transform?.[0] as
      | { translateX?: number; translateY?: number }
      | undefined;
    if (
      size === measured.length &&
      (vertical ? moved?.translateY : moved?.translateX) === at
    )
      return;
    bar.style = {
      ...style,
      [vertical ? 'height' : 'width']: measured.length,
      transform: [vertical ? { translateY: at } : { translateX: at }],
    };
  };

  // What changes the bar: the scroll view's size, its content's and the
  // track's, which a ResizeObserver tells, and scrolling. The nodes come and
  // go with renders, so each render checks that it watches the ones there are.
  const latest = useRef(sync);
  latest.current = sync;
  const [onChange] = useState(() => () => latest.current());
  const watching = useRef<Watching>({
    observer: null,
    sized: [],
    scrolled: null,
  });
  useLayoutEffect(() => {
    const watched = watching.current;
    const node = scroll.current;
    const sized = [node, node?.firstChild ?? null, track.current];
    if (sized.some((value, i) => value !== watched.sized[i])) {
      watched.observer ??= new ResizeObserver(onChange);
      watched.observer.disconnect();
      for (const value of sized)
        if (value !== null) watched.observer.observe(value);
      watched.sized = sized;
    }
    if (watched.scrolled !== node) {
      watched.scrolled?.removeEventListener('scroll', onChange);
      node?.addEventListener('scroll', onChange);
      watched.scrolled = node;
    }
    // A style set by a render replaces what this hook put in it.
    sync();
  });
  useEffect(
    () => () => {
      const watched = watching.current;
      watched.observer?.disconnect();
      watched.scrolled?.removeEventListener('scroll', onChange);
      watched.sized = [];
      watched.scrolled = null;
    },
    [onChange],
  );

  const position = (event: PointerEvent) =>
    vertical ? event.clientY : event.clientX;

  return {
    visible,
    hovered,
    pressed,
    trackProps: {
      ref: track,
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        const measured = measure();
        if (measured === null) return;
        // Keeps focus where it is, as a browser's scrollbar does.
        event.preventDefault();
        let start = measured.scrolled;
        // A press on the track itself says where along it, unlike one on the
        // thumb or in it. It jumps to bring the thumb's middle there, if not on
        // it; past either end is kept, for a drag to stay under the pointer.
        if (event.target === track.current && measured.travel > 0) {
          // From where the thumb starts, the track's padding being none of it.
          const origin = thumb.current?.layout;
          const offset =
            (vertical ? event.offsetY : event.offsetX) -
            (origin === undefined ? 0 : vertical ? origin.y : origin.x);
          const at = (measured.travel * start) / measured.range;
          if (offset < at || offset > at + measured.length) {
            start =
              ((offset - measured.length / 2) * measured.range) /
              measured.travel;
            scrollTo(measured.node, start);
          }
        }
        drag.current = { from: position(event), scroll: start };
        setPressed(true);
      },
      onPointerMove: (event) => {
        const held = drag.current;
        if (held === null) return;
        const measured = measure();
        if (measured === null || measured.travel <= 0) return;
        scrollTo(
          measured.node,
          held.scroll +
            ((position(event) - held.from) * measured.range) / measured.travel,
        );
      },
      onPointerUp: () => {
        drag.current = null;
        setPressed(false);
      },
      onPointerCancel: () => {
        drag.current = null;
        setPressed(false);
      },
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
    },
    thumbProps: { ref: thumb },
  };
}
