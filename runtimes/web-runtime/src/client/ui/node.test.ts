// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeyboardEvent, PointerEvent } from './events';
import { UiNode } from './node';
import { STYLESHEET } from './style';
import { UiView } from './view';

let view: UiView;
afterEach(() => {
  view?.dispose();
  vi.restoreAllMocks();
});

function setup() {
  view = new UiView(document);
  view.mount(document.body);
  return view;
}

const el = (node: UiNode): HTMLElement => UiNode.elementOf(node);

describe('UiNode tree', () => {
  it('mirrors the tree in DOM elements', () => {
    const { root } = setup();
    const a = view.createNode('view');
    const b = view.createNode('text');
    const c = view.createNode('view');
    root.appendChild(a);
    root.appendChild(c);
    root.insertBefore(b, c);

    expect(root.children).toEqual([a, b, c]);
    expect([...el(root).children]).toEqual([el(a), el(b), el(c)]);
    expect(a.nextSibling).toBe(b);
    expect(c.previousSibling).toBe(b);
    expect(root.firstChild).toBe(a);
    expect(root.lastChild).toBe(c);
    expect(b.parent).toBe(root);
    expect(Object.isFrozen(root.children)).toBe(true);
  });

  it('reparents, removes and tracks connection', () => {
    const { root } = setup();
    const outer = view.createNode('view');
    const inner = view.createNode('view');
    const leaf = view.createNode('text');
    outer.appendChild(leaf);
    expect(leaf.isConnected).toBe(false);
    root.appendChild(outer);
    expect(leaf.isConnected).toBe(true);
    expect(root.contains(leaf)).toBe(true);

    root.appendChild(inner);
    inner.appendChild(leaf);
    expect(outer.children).toEqual([]);
    expect(leaf.parent).toBe(inner);
    expect(el(leaf).parentElement).toBe(el(inner));

    leaf.remove();
    expect(leaf.parent).toBeNull();
    expect(leaf.isConnected).toBe(false);
    expect(el(leaf).isConnected).toBe(false);
    leaf.remove();
    expect(root.contains(null)).toBe(false);
  });

  it('moves a child before a sibling and keeps order', () => {
    const { root } = setup();
    const [a, b, c] = [1, 2, 3].map(() => view.createNode('view'));
    root.appendChild(a!);
    root.appendChild(b!);
    root.appendChild(c!);
    root.insertBefore(c!, a!);
    expect(root.children).toEqual([c, a, b]);
    expect(root.insertBefore(a!, a!)).toBe(a);
    expect([...el(root).children]).toEqual([el(c!), el(a!), el(b!)]);
  });

  it('enforces the tree rules with the JUCE runtime messages', () => {
    const { root } = setup();
    const parent = view.createNode('view');
    const text = view.createNode('text');
    const child = view.createNode('view');
    root.appendChild(parent);
    parent.appendChild(child);
    expect(() => text.appendChild(view.createNode('view'))).toThrow(
      'only views can have children',
    );
    expect(() => child.appendChild(parent)).toThrow(
      'a node cannot contain itself',
    );
    expect(() => parent.appendChild(root)).toThrow(
      'the root node cannot be a child',
    );
    expect(() => root.insertBefore(text, child)).toThrow(
      'the reference node is not a child of this node',
    );
    expect(() => root.removeChild(child)).toThrow(
      'the node is not a child of this node',
    );
    expect(() => root.appendChild({} as UiNode)).toThrow(
      new TypeError('child must be a UiNode, got Object'),
    );
  });

  it('cannot be constructed directly', () => {
    setup();
    expect(() => new (UiNode as unknown as new () => UiNode)()).toThrow(
      TypeError,
    );
  });
});

describe('UiNode content', () => {
  it('applies styles as CSS and replaces them as a whole', () => {
    const { root } = setup();
    const box = view.createNode('view');
    root.appendChild(box);
    box.style = {
      width: 40,
      backgroundColor: 'red',
      pointerEvents: 'box-none',
    };
    expect(el(box).style.width).toBe('40px');
    expect(el(box).style.backgroundColor).toBe('red');
    expect(el(box).classList.contains('sd-pe-box-none')).toBe(true);
    expect(Object.isFrozen(box.style)).toBe(true);

    box.style = { display: 'none' };
    expect(el(box).style.width).toBe('');
    expect(el(box).style.display).toBe('none');
    expect(el(box).classList.contains('sd-pe-box-none')).toBe(false);
    expect(() => {
      box.style = { width: 'wide' } as never;
    }).toThrow(TypeError);
    expect(box.style).toEqual({ display: 'none' });
  });

  it('keeps the root filling the view', () => {
    const { root } = setup();
    root.style = { backgroundColor: 'black', pointerEvents: 'none' };
    expect(el(root).classList.contains('sd-root')).toBe(true);
    expect(el(root).classList.contains('sd-pe-none')).toBe(true);
  });

  it('has an overlay root over the content root, both filling the surface', () => {
    const { root, overlay } = setup();
    expect([...view.rootElement.children]).toEqual([el(root), el(overlay)]);
    expect(view.rootElement.className).toBe('sd-surface');
    overlay.style = { pointerEvents: 'auto', zIndex: -5 };
    // Its layer and pass-through stay, whatever its style says.
    expect(el(overlay).className).toBe('sd-node sd-root sd-overlay');
    expect(STYLESHEET).toMatch(
      /\.sd-overlay \{ z-index: 1 !important; pointer-events: none !important; \}/,
    );
    expect(STYLESHEET).toMatch(/\.sd-root \{[^}]*z-index: 0 !important;/);
    const child = view.createNode('view');
    overlay.appendChild(child);
    expect([overlay.isConnected, child.isConnected, overlay.parent]).toEqual([
      true,
      true,
      null,
    ]);
    expect(root.contains(child)).toBe(false);
    expect(() => root.appendChild(overlay)).toThrow(
      'the root node cannot be a child',
    );
    const seen: string[] = [];
    root.addEventListener('pointerdown', () => seen.push('root'));
    overlay.addEventListener('pointerdown', () => seen.push('overlay'));
    child.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(seen).toEqual(['overlay']);
  });

  it('shows text, and rejects it on nodes without text', () => {
    setup();
    const text = view.createNode('text');
    text.text = 'Gain';
    expect(el(text).textContent).toBe('Gain');
    text.text = 0.5 as unknown as string;
    expect(text.text).toBe('0.5');
    expect(() => {
      view.createNode('view').text = 'x';
    }).toThrow(new TypeError('only text and input nodes have text'));
  });

  it('edits inputs through a native input element', () => {
    setup();
    const input = view.createNode('input');
    const element = el(input) as HTMLInputElement;
    expect(element.tagName).toBe('INPUT');
    expect(input.focusable).toBe(true);
    input.value = 'hello';
    expect(element.value).toBe('hello');
    expect(input.selectionStart).toBe(5);
    expect(input.selectionEnd).toBe(5);
    input.setSelectionRange(4, 1, 'backward');
    expect([input.selectionStart, input.selectionEnd]).toEqual([4, 4]);
    input.setSelectionRange(1, 99, 'backward');
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 5]);
    input.select();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
    expect(input.selectionDirection).toBe('forward');
    element.value = 'typed';
    expect(input.value).toBe('typed');
    expect(input.text).toBe('typed');
    input.placeholder = 'Name';
    expect(element.placeholder).toBe('Name');
    expect(() => view.createNode('view').value).toThrow(
      new TypeError('value belongs to input nodes'),
    );
  });

  it('points images at their asset next to the page', () => {
    setup();
    const image = view.createNode('image');
    const element = el(image) as HTMLImageElement;
    image.source = '0123456789abcdef.png';
    expect(element.getAttribute('src')).toBe(
      new URL('soundor-assets/0123456789abcdef.png', document.baseURI).href,
    );
    image.source = '';
    expect(element.hasAttribute('src')).toBe(false);
    image.source = '../../etc/passwd';
    expect(element.hasAttribute('src')).toBe(false);
    expect(image.source).toBe('../../etc/passwd');
  });

  it('scrolls only scroll views', () => {
    setup();
    const scroll = view.createNode('scroll');
    expect(() => view.createNode('view').scrollTo(0, 10)).toThrow(
      new TypeError('scrollTo() belongs to scroll nodes'),
    );
    expect(() => scroll.scrollTo({ top: 10 })).not.toThrow();
  });
});

describe('UiNode layout', () => {
  /** Lays elements out by hand: happy-dom has no layout engine. */
  function boxes(map: Map<Element, DOMRect>) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return map.get(this) ?? new DOMRect(0, 0, 0, 0);
      },
    );
  }

  it('reports boxes relative to the parent and to the view', () => {
    const { root } = setup();
    const parent = view.createNode('scroll');
    const child = view.createNode('view');
    root.appendChild(parent);
    parent.appendChild(child);
    boxes(
      new Map([
        [view.rootElement, new DOMRect(100, 50, 800, 600)],
        [el(root), new DOMRect(100, 50, 800, 600)],
        [el(parent), new DOMRect(110, 70, 300, 200)],
        [el(child), new DOMRect(120, 60, 50, 40)],
      ]),
    );
    Object.defineProperty(view.rootElement, 'offsetWidth', { value: 800 });
    Object.defineProperty(el(parent), 'scrollTop', { value: 30 });

    expect(child.getBoundingClientRect()).toEqual({
      x: 20,
      y: 10,
      width: 50,
      height: 40,
    });
    // Relative to the parent's box, as if it were not scrolled.
    expect(child.layout).toEqual({ x: 10, y: 20, width: 50, height: 40 });
    expect(root.layout).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('divides by the scale the host shows the view at', () => {
    const { root } = setup();
    const child = view.createNode('view');
    root.appendChild(child);
    boxes(
      new Map([
        [view.rootElement, new DOMRect(0, 0, 400, 300)],
        [el(child), new DOMRect(50, 25, 100, 50)],
      ]),
    );
    Object.defineProperty(view.rootElement, 'offsetWidth', { value: 800 });
    Object.defineProperty(view.rootElement, 'offsetHeight', { value: 600 });
    expect(view.scale()).toBe(0.5);
    expect(child.getBoundingClientRect()).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
    expect(view.size()).toEqual({ width: 800, height: 600, scale: 0.5 });
  });

  it('is zero while not in the tree', () => {
    setup();
    const node = view.createNode('view');
    expect(node.layout).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(node.getBoundingClientRect()).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('UiNode events', () => {
  it('capture, target and bubble along the Soundor tree', () => {
    const { root } = setup();
    const parent = view.createNode('view');
    const child = view.createNode('view');
    root.appendChild(parent);
    parent.appendChild(child);
    const calls: string[] = [];
    const log =
      (name: string) =>
      (event: Event): void => {
        calls.push(
          `${name}:${event.eventPhase}:${event.target === child}:${(event.currentTarget as UiNode).type}`,
        );
      };
    root.addEventListener('x', log('root-capture'), true);
    parent.addEventListener('x', log('parent-bubble'));
    child.addEventListener('x', log('child'));
    child.addEventListener('x', log('child-capture'), { capture: true });
    root.addEventListener('x', log('root-bubble'));

    child.dispatchEvent(new Event('x', { bubbles: true }));
    expect(calls).toEqual([
      'root-capture:1:true:view',
      'child-capture:2:true:view',
      'child:2:true:view',
      'parent-bubble:3:true:view',
      'root-bubble:3:true:view',
    ]);
  });

  it('stops propagation, runs once, removes by signal', () => {
    const { root } = setup();
    const child = view.createNode('view');
    root.appendChild(child);
    const calls: string[] = [];
    const controller = new AbortController();
    child.addEventListener('x', (event) => {
      calls.push('a');
      event.stopImmediatePropagation();
    });
    child.addEventListener('x', () => calls.push('b'));
    root.addEventListener('x', () => calls.push('root'));
    child.addEventListener('y', () => calls.push('once'), { once: true });
    child.addEventListener('z', () => calls.push('signal'), {
      signal: controller.signal,
    });

    child.dispatchEvent(new Event('x', { bubbles: true }));
    child.dispatchEvent(new Event('y'));
    child.dispatchEvent(new Event('y'));
    controller.abort();
    child.dispatchEvent(new Event('z'));
    expect(calls).toEqual(['a', 'once']);
  });

  it('honors preventDefault except in passive listeners', () => {
    setup();
    const node = view.createNode('view');
    node.addEventListener('x', (event) => event.preventDefault(), {
      passive: true,
    });
    expect(node.dispatchEvent(new Event('x', { cancelable: true }))).toBe(true);
    node.addEventListener('y', (event) => event.preventDefault());
    expect(node.dispatchEvent(new Event('y', { cancelable: true }))).toBe(
      false,
    );
  });

  it('reports a throwing listener and goes on', () => {
    setup();
    const node = view.createNode('view');
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn<() => void>();
    node.addEventListener('x', () => {
      throw new Error('boom');
    });
    node.addEventListener('x', after);
    node.dispatchEvent(new Event('x'));
    expect(after).toHaveBeenCalled();
    expect(reported).toHaveBeenCalled();
  });

  it('carries Soundor event data and resets after dispatch', () => {
    setup();
    const node = view.createNode('view');
    let seen: { path: number; target: unknown } | undefined;
    node.addEventListener('keydown', (event) => {
      seen = { path: event.composedPath().length, target: event.target };
    });
    const event = new KeyboardEvent('keydown', { key: 'a', shiftKey: true });
    node.dispatchEvent(event);
    expect(seen).toEqual({ path: 1, target: node });
    expect(event.currentTarget).toBeNull();
    expect(event.eventPhase).toBe(0);
    expect(event.getModifierState('Shift')).toBe(true);
    const pointer = new PointerEvent('pointerdown', { clientX: 3, buttons: 1 });
    expect([pointer.x, pointer.buttons, pointer.relatedTarget]).toEqual([
      3,
      1,
      null,
    ]);
  });
});

describe('UiNode canvases', () => {
  it('is a real <canvas>, 300 by 150 until sized', () => {
    setup();
    const canvas = view.createNode('canvas');
    expect(canvas.type).toBe('canvas');
    expect(el(canvas).tagName).toBe('CANVAS');
    expect([canvas.width, canvas.height]).toEqual([300, 150]);
    canvas.width = 64;
    canvas.height = 32;
    expect([canvas.width, canvas.height]).toEqual([64, 32]);
    expect((el(canvas) as HTMLCanvasElement).width).toBe(64);
    // Negative sizes are the defaults, as in the JUCE runtime.
    canvas.width = -5;
    expect(canvas.width).toBe(300);
  });

  it("gives the element's own context", () => {
    setup();
    const canvas = view.createNode('canvas');
    const element = el(canvas) as HTMLCanvasElement;
    const context = {};
    const getContext = vi
      .spyOn(element, 'getContext')
      .mockReturnValue(context as never);
    expect(canvas.getContext('2d', { alpha: true })).toBe(context);
    expect(getContext).toHaveBeenCalledWith('2d', { alpha: true });
  });

  it('has canvas members only on canvases', () => {
    setup();
    const node = view.createNode('view');
    expect(() => node.width).toThrow('belongs to canvas nodes');
    expect(() => node.getContext('2d')).toThrow('belongs to canvas nodes');
  });
});
