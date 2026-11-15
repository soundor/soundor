// The DOM adapter (experimental): the engine's nodes as HTML elements, a
// <div> per view and a <span> per text node, nested as the nodes are. The
// engine lays out (Yoga, in WebAssembly); every element is absolutely
// positioned at the box it reported, so the browser runs no layout of its
// own over them, and CSS only draws. A text node's lines are the engine's
// too: one <span> each, never wrapped by the browser.

import type { Frame, Lines, NodeState } from './state.ts';
import { drawStyle } from './style.ts';

export class DomAdapter {
  readonly container: HTMLElement;
  #observer: ResizeObserver;
  #root: NodeState;

  /**
   * Shows `root`'s tree in `container`, sized to fill it: `resize` is called
   * with its content box's size whenever it changes. Every node
   * alive (`nodes`) gets its element, in the root's tree or not yet.
   */
  constructor(
    container: HTMLElement,
    root: NodeState,
    nodes: Iterable<NodeState>,
    resize: (width: number, height: number) => void,
  ) {
    this.container = container;
    this.#root = root;
    const all = [...nodes];
    for (const node of all) this.create(node);
    for (const node of all)
      for (const child of node.children) node.element!.append(child.element!);
    const element = root.element!;
    // The root fills the container's content box; its descendants are
    // placed inside it.
    element.style.position = 'relative';
    container.append(element);
    this.#observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) resize(box.width, box.height);
    });
    this.#observer.observe(container);
  }

  /** The container's content box's size now. */
  contentSize(): [number, number] {
    const { width, height } = this.container.getBoundingClientRect();
    const style = getComputedStyle(this.container);
    const px = (value: string): number => parseFloat(value) || 0;
    return [
      width -
        px(style.paddingLeft) -
        px(style.paddingRight) -
        px(style.borderLeftWidth) -
        px(style.borderRightWidth),
      height -
        px(style.paddingTop) -
        px(style.paddingBottom) -
        px(style.borderTopWidth) -
        px(style.borderBottomWidth),
    ];
  }

  /** An element for a new node. */
  create(node: NodeState): void {
    const element = document.createElement(
      node.type === 'view' ? 'div' : 'span',
    );
    const css = element.style;
    css.position = 'absolute';
    css.boxSizing = 'border-box';
    css.borderStyle = 'solid';
    css.borderWidth = '0';
    css.margin = '0';
    css.padding = '0';
    if (node.type === 'text') {
      css.whiteSpace = 'pre';
      // As the engine measured it (text.ts).
      css.fontKerning = 'normal';
    }
    node.element = element;
    this.style(node);
    if (node.frame) this.frame(node, node.frame);
    if (node.lines) this.lines(node, node.lines);
  }

  insert(parent: NodeState, child: NodeState, before: NodeState | null): void {
    if (parent.element && child.element)
      parent.element.insertBefore(child.element, before?.element ?? null);
  }

  remove(child: NodeState): void {
    child.element?.remove();
  }

  release(node: NodeState): void {
    node.element?.remove();
    node.element = null;
  }

  /** Draws the node's accepted style. */
  style(node: NodeState): void {
    if (node.element) drawStyle(node.element, node.committed);
  }

  frame(node: NodeState, frame: Frame): void {
    const css = node.element?.style;
    if (!css) return;
    if (node !== this.#root) {
      css.left = `${frame.left}px`;
      css.top = `${frame.top}px`;
    }
    css.width = `${frame.width}px`;
    css.height = `${frame.height}px`;
    const [top, right, bottom, left] = frame.border;
    css.borderWidth = `${top}px ${right}px ${bottom}px ${left}px`;
  }

  /** A text node's lines, each a <span>, placed in its padding box. */
  lines(node: NodeState, lines: Lines): void {
    const element = node.element;
    if (!element) return;
    element.style.font = lines.font;
    const [top = 0, , , left = 0] = node.frame?.border ?? [];
    const spans = element.children;
    lines.lines.forEach((line, index) => {
      let span = spans[index] as HTMLElement | undefined;
      if (!span) {
        span = document.createElement('span');
        span.style.position = 'absolute';
        span.style.whiteSpace = 'pre';
        element.append(span);
      }
      const text = node.text.slice(line.start, line.end);
      if (span.textContent !== text) span.textContent = text;
      const css = span.style;
      css.left = `${line.x - left}px`;
      css.top = `${line.y - top}px`;
      css.lineHeight = css.height = `${line.height}px`;
    });
    while (spans.length > lines.lines.length) spans[spans.length - 1]!.remove();
  }

  /** Removes the elements of `nodes` and stops observing the container. */
  dispose(nodes: Iterable<NodeState>): void {
    this.#observer.disconnect();
    for (const node of nodes) this.release(node);
  }
}
