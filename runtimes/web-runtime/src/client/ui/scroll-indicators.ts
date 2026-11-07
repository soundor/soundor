/** A scroll indicator: thick, how far in from the box's edge, and its least long. */
const THICKNESS = 3;
const EDGE_GAP = 2;
const MIN_LENGTH = 16;
/** Near a mouse: how thick, on a track as thick as this along the box's edge. */
const GROWN_THICKNESS = 8;
const TRACK_THICKNESS = 12;
/** How long after touch scrolling stops its indicators start to fade. */
const FADE_AFTER_MS = 1000;

/** What places a scroll view's indicators, in Yoga's frame of its border box. */
export interface ScrollBox {
  readonly contentWidth: number;
  readonly contentHeight: number;
  /** Its content box. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly borderLeft: number;
  readonly borderTop: number;
}

interface Drag {
  readonly vertical: boolean;
  readonly pointerId: number;
  /** Where the pointer and the scroll position were when pressed. */
  readonly from: number;
  readonly scroll: number;
}

const lengthOf = (room: number, content: number): number =>
  Math.max(MIN_LENGTH, (room * room) / content);

/** How much bigger on screen than in CSS pixels, under transformed ancestors. */
const scaleOf = (shown: number, laidOut: number): number =>
  laidOut > 0 && shown > 0 ? shown / laidOut : 1;

/**
 * A scroll view's indicators. They draw as the engine's `drawScrollIndicators()`
 * does, and a mouse uses them as there (`Surface::route()`): near an edge a track
 * appears under a bar grown to take hold of. Pressing the bar drags it, and
 * pressing the track jumps there and drags from there.
 * Touch is the browser's: it scrolls, and the bars show only while it does.
 */
export class ScrollIndicators {
  readonly #element: HTMLElement;
  readonly #vertical: HTMLElement;
  readonly #horizontal: HTMLElement;
  readonly #verticalTrack: HTMLElement;
  readonly #horizontalTrack: HTMLElement;
  #box: ScrollBox | null = null;
  #drag: Drag | null = null;
  #touch = false;
  #enabled = true;
  #fade: ReturnType<typeof setTimeout> | undefined;

  constructor(element: HTMLElement) {
    this.#element = element;
    const document = element.ownerDocument;
    const bar = (axis: string): HTMLElement => {
      const created = document.createElement('div');
      created.className = `sd-scroll-indicator sd-scroll-indicator-${axis}`;
      return created;
    };
    this.#vertical = bar('y');
    this.#horizontal = bar('x');
    this.#verticalTrack = this.#createTrack(true);
    this.#horizontalTrack = this.#createTrack(false);
    // In this order: the bars draw over the tracks.
    element.append(
      this.#verticalTrack,
      this.#horizontalTrack,
      this.#vertical,
      this.#horizontal,
    );
    const window = document.defaultView;
    this.#setTouch(window?.matchMedia?.('(hover: none)').matches === true);
    element.addEventListener('scroll', () => this.#scrolled(), {
      passive: true,
    });
    element.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      this.#setTouch(false);
      this.#updateHover(event);
    });
    element.addEventListener('pointerdown', (event) => {
      this.#setTouch(event.pointerType === 'touch');
    });
    element.addEventListener('pointerleave', () => {
      if (this.#drag === null) this.#setGrown(false, false);
    });
  }

  /** Puts the bars where a new layout, or a scroll, leaves them. */
  place(box: ScrollBox | null = this.#box): void {
    this.#box = box;
    if (box === null) return;
    this.#placeAxis(box, true);
    this.#placeAxis(box, false);
  }

  /** Without them, it scrolls the same, with its edges left to what is there. */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) this.release();
    this.place();
  }

  /** Forgets the pointer, which sends nothing more to an element taken away. */
  release(): void {
    this.#setDrag(null);
    this.#setGrown(false, false);
    this.#show(false);
  }

  #placeAxis(box: ScrollBox, vertical: boolean): void {
    const bar = vertical ? this.#vertical : this.#horizontal;
    const track = vertical ? this.#verticalTrack : this.#horizontalTrack;
    const room = vertical ? box.height : box.width;
    const content = vertical ? box.contentHeight : box.contentWidth;
    if (!this.#enabled || !(content > room + 0.5 && room > 0)) {
      bar.style.display = 'none';
      track.style.display = 'none';
      return;
    }
    const { scrollLeft, scrollTop } = this.#element;
    // They are in the element, which scrolls them too: put back by what it did.
    const along = vertical
      ? box.y - box.borderTop + scrollTop
      : box.x - box.borderLeft + scrollLeft;
    const edge = vertical
      ? box.x + box.width - box.borderLeft + scrollLeft
      : box.y + box.height - box.borderTop + scrollTop;
    const length = lengthOf(room, content);
    const scrolled = vertical ? scrollTop : scrollLeft;
    const at = along + ((room - length) * scrolled) / (content - room);
    const grown = bar.classList.contains('sd-scroll-indicator-grown');
    const thickness = grown ? GROWN_THICKNESS : THICKNESS;
    const [start, side, size, breadth] = vertical
      ? (['top', 'left', 'height', 'width'] as const)
      : (['left', 'top', 'width', 'height'] as const);
    bar.style.display = 'block';
    bar.style[start] = `${at}px`;
    bar.style[side] = `${edge - thickness - EDGE_GAP}px`;
    bar.style[size] = `${length}px`;
    bar.style[breadth] = `${thickness}px`;
    track.style.display = grown ? 'block' : 'none';
    track.style[start] = `${along}px`;
    track.style[side] = `${edge - TRACK_THICKNESS}px`;
    track.style[size] = `${room}px`;
    track.style[breadth] = `${TRACK_THICKNESS}px`;
  }

  #createTrack(vertical: boolean): HTMLElement {
    const track = this.#element.ownerDocument.createElement('div');
    track.className = 'sd-scroll-track';
    // The view's listeners, on an ancestor, never see the drag: a track is not
    // the plugin's to press, and pressing it leaves focus where it is.
    track.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.pointerType === 'touch') return;
      event.stopPropagation();
      event.preventDefault();
      try {
        track.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic or already released pointers cannot be captured.
      }
      this.#setDrag({
        vertical,
        pointerId: event.pointerId,
        from: vertical ? event.clientY : event.clientX,
        scroll: this.#jumpTo(event, vertical),
      });
    });
    track.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.#drag?.pointerId) return;
      event.stopPropagation();
      this.#dragTo(event);
    });
    const end = (event: PointerEvent): void => {
      if (event.pointerId !== this.#drag?.pointerId) return;
      event.stopPropagation();
      this.#setDrag(null);
      this.#updateHover(event);
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('lostpointercapture', end);
    return track;
  }

  /**
   * Brings the bar under a press beside it, its middle at the pointer, and says
   * where that scrolls to. A press on the bar moves nothing. The answer may be
   * past either end, for a drag from it to stay under the pointer.
   */
  #jumpTo(event: PointerEvent, vertical: boolean): number {
    const element = this.#element;
    const scroll = vertical ? element.scrollTop : element.scrollLeft;
    const box = this.#box;
    if (box === null) return scroll;
    const room = vertical ? box.height : box.width;
    const content = vertical ? box.contentHeight : box.contentWidth;
    const length = lengthOf(room, content);
    const travel = room - length;
    if (travel <= 0) return scroll;
    const rect = element.getBoundingClientRect();
    const pointer = vertical
      ? (event.clientY - rect.top) /
          scaleOf(rect.height, element.offsetHeight) -
        box.y
      : (event.clientX - rect.left) / scaleOf(rect.width, element.offsetWidth) -
        box.x;
    const range = content - room;
    const at = (travel * scroll) / range;
    if (pointer >= at && pointer <= at + length) return scroll;
    const target = ((pointer - length / 2) * range) / travel;
    if (vertical) element.scrollTop = target;
    else element.scrollLeft = target;
    this.place();
    return target;
  }

  /** Holds the drag, and shows on its bar that it is held. */
  #setDrag(drag: Drag | null): void {
    this.#drag = drag;
    const pressed = 'sd-scroll-indicator-pressed';
    this.#vertical.classList.toggle(pressed, drag?.vertical === true);
    this.#horizontal.classList.toggle(pressed, drag?.vertical === false);
  }

  #dragTo(event: PointerEvent): void {
    const drag = this.#drag;
    const box = this.#box;
    if (drag === null || box === null) return;
    const element = this.#element;
    const rect = element.getBoundingClientRect();
    if (drag.vertical) {
      const travel = box.height - lengthOf(box.height, box.contentHeight);
      if (travel <= 0) return;
      const moved =
        (event.clientY - drag.from) /
        scaleOf(rect.height, element.offsetHeight);
      element.scrollTop =
        drag.scroll + (moved * (box.contentHeight - box.height)) / travel;
    } else {
      const travel = box.width - lengthOf(box.width, box.contentWidth);
      if (travel <= 0) return;
      const moved =
        (event.clientX - drag.from) / scaleOf(rect.width, element.offsetWidth);
      element.scrollLeft =
        drag.scroll + (moved * (box.contentWidth - box.width)) / travel;
    }
    // The browser's scroll event comes with the next frame; the bar follows now.
    this.place();
  }

  /** The track shows exactly where a press would take it: its own strip. */
  #updateHover(event: PointerEvent): void {
    const box = this.#box;
    if (box === null || this.#drag !== null) return;
    const element = this.#element;
    const rect = element.getBoundingClientRect();
    const x =
      (event.clientX - rect.left) / scaleOf(rect.width, element.offsetWidth);
    const y =
      (event.clientY - rect.top) / scaleOf(rect.height, element.offsetHeight);
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const inside = x >= box.x && y >= box.y && x <= right && y <= bottom;
    this.#setGrown(
      inside && x >= right - TRACK_THICKNESS,
      inside && y >= bottom - TRACK_THICKNESS,
    );
  }

  #setGrown(vertical: boolean, horizontal: boolean): void {
    const was = [
      this.#vertical.classList.contains('sd-scroll-indicator-grown'),
      this.#horizontal.classList.contains('sd-scroll-indicator-grown'),
    ];
    if (was[0] === vertical && was[1] === horizontal) return;
    this.#vertical.classList.toggle('sd-scroll-indicator-grown', vertical);
    this.#horizontal.classList.toggle('sd-scroll-indicator-grown', horizontal);
    this.place();
  }

  #setTouch(touch: boolean): void {
    if (touch === this.#touch) {
      if (touch) this.#setGrown(false, false);
      return;
    }
    this.#touch = touch;
    // On the bars: a style set on the node rewrites the classes of its element.
    this.#vertical.classList.toggle('sd-scroll-indicator-touch', touch);
    this.#horizontal.classList.toggle('sd-scroll-indicator-touch', touch);
    if (touch) this.#setGrown(false, false);
    else this.#show(false);
  }

  #show(showing: boolean): void {
    clearTimeout(this.#fade);
    this.#vertical.classList.toggle('sd-scroll-indicator-showing', showing);
    this.#horizontal.classList.toggle('sd-scroll-indicator-showing', showing);
  }

  #scrolled(): void {
    this.place();
    if (!this.#touch) return;
    this.#show(true);
    this.#fade = setTimeout(() => this.#show(false), FADE_AFTER_MS);
  }
}
