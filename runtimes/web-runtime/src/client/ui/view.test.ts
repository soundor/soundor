// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UiNode } from './node';
import { UiView } from './view';

let view: UiView;
afterEach(() => {
  view?.dispose();
  vi.restoreAllMocks();
});

const el = (node: UiNode): HTMLElement => UiNode.elementOf(node);

/**
 * A view whose hit test is a table from x to node: happy-dom has no layout.
 * Returns the nodes and a recorder of the events they see.
 */
function setup() {
  view = new UiView(document);
  view.mount(document.body);
  const { root } = view;
  const panel = view.createNode('view');
  const button = view.createNode('view');
  const label = view.createNode('text');
  const other = view.createNode('view');
  root.appendChild(panel);
  panel.appendChild(button);
  button.appendChild(view.createNode('view'));
  panel.appendChild(other);
  root.appendChild(label);
  const hits = new Map<number, UiNode | null>([
    [10, button],
    [20, other],
    [30, label],
    [40, root],
    [50, null],
  ]);
  vi.spyOn(document, 'elementFromPoint').mockImplementation((x) => {
    const node = hits.get(x);
    return node === undefined || node === null ? document.body : el(node);
  });
  const events: string[] = [];
  const names = new Map<UiNode, string>([
    [root, 'root'],
    [panel, 'panel'],
    [button, 'button'],
    [other, 'other'],
    [label, 'label'],
  ]);
  for (const [node, name] of names) {
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'pointerenter',
      'pointerleave',
      'click',
      'focus',
      'blur',
      'keydown',
      'wheel',
      'scroll',
    ]) {
      node.addEventListener(type, (event) => {
        if (event.currentTarget === event.target)
          events.push(`${type}@${name}`);
      });
    }
  }
  return { root, panel, button, other, label, events };
}

function pointer(type: string, x: number, init: PointerEventInit = {}) {
  view.rootElement.dispatchEvent(
    new window.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: 0,
      pointerId: 1,
      pointerType: 'mouse',
      ...init,
    }),
  );
}

describe('pointer routing', () => {
  it('enters along the tree, presses, captures and clicks', () => {
    const { events } = setup();
    pointer('pointermove', 10);
    expect(events).toEqual([
      'pointerenter@root',
      'pointerenter@panel',
      'pointerenter@button',
      'pointermove@button',
    ]);
    events.length = 0;

    pointer('pointerdown', 10, { button: 0, buttons: 1 });
    // Captured: the move over another node still goes to the button,
    // and hover does not change while pressed.
    pointer('pointermove', 20, { buttons: 1 });
    pointer('pointerup', 10, { button: 0, buttons: 0 });
    expect(events).toEqual([
      'pointerdown@button',
      'pointermove@button',
      'pointerup@button',
      'click@button',
    ]);
  });

  it('clicks the deepest node holding both press and release', () => {
    const { events } = setup();
    pointer('pointerdown', 10, { button: 0, buttons: 1 });
    pointer('pointerup', 20, { button: 0, buttons: 0 });
    expect(events).toContain('click@panel');
    expect(events).not.toContain('click@button');
    expect(events.slice(-2)).toEqual([
      'pointerleave@button',
      'pointerenter@other',
    ]);
  });

  it('does not click for other buttons or outside the view', () => {
    const { events } = setup();
    pointer('pointerdown', 10, { button: 2, buttons: 2 });
    pointer('pointerup', 10, { button: 2, buttons: 0 });
    pointer('pointerdown', 10, { button: 0, buttons: 1 });
    pointer('pointerup', 50, { button: 0, buttons: 0 });
    expect(events.filter((e) => e.startsWith('click'))).toEqual([]);
  });

  it('leaves from the innermost node out, when the pointer leaves the view', () => {
    const { events } = setup();
    pointer('pointermove', 10);
    events.length = 0;
    view.rootElement.dispatchEvent(
      new window.PointerEvent('pointerleave', { pointerId: 1 }),
    );
    expect(events).toEqual([
      'pointerleave@button',
      'pointerleave@panel',
      'pointerleave@root',
    ]);
  });

  it('cancels a press', () => {
    const { events } = setup();
    pointer('pointerdown', 10, { button: 0, buttons: 1 });
    pointer('pointercancel', 10);
    // Then hover is cleared, as in the JUCE runtime.
    expect(events.slice(-4)).toEqual([
      'pointercancel@button',
      'pointerleave@button',
      'pointerleave@panel',
      'pointerleave@root',
    ]);
  });

  it('reports positions in view coordinates', () => {
    const { button } = setup();
    let seen: { x: number; offsetX: number; buttons: number } | undefined;
    button.addEventListener('pointerdown', (event) => {
      const e = event as unknown as {
        clientX: number;
        offsetX: number;
        buttons: number;
      };
      seen = { x: e.clientX, offsetX: e.offsetX, buttons: e.buttons };
    });
    pointer('pointerdown', 10, { button: 0, buttons: 1 });
    expect(seen).toEqual({ x: 10, offsetX: 10, buttons: 1 });
  });
});

describe('focus', () => {
  it('goes to the nearest focusable node on press, or nowhere', () => {
    const { panel, button, events } = setup();
    panel.focusable = true;
    pointer('pointerdown', 10, { button: 0, buttons: 1 });
    expect(view.focusedNode()).toBe(panel);
    expect(events).toContain('focus@panel');
    pointer('pointerup', 10, { button: 0, buttons: 0 });

    pointer('pointerdown', 30, { button: 0, buttons: 1 });
    expect(view.focusedNode()).toBeNull();
    expect(events).toContain('blur@panel');
    expect(button.focused).toBe(false);
  });

  it('is not moved by a press a listener prevented', () => {
    const { panel, button } = setup();
    panel.focusable = true;
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    pointer('pointerdown', 10, { button: 0, buttons: 1 });
    expect(view.focusedNode()).toBeNull();
  });

  it('cycles focusable nodes with Tab, skipping hidden ones', () => {
    const { panel, other, label } = setup();
    panel.focusable = true;
    other.focusable = true;
    label.focusable = true;
    label.style = { display: 'none' };
    const tab = (shiftKey = false) =>
      el(view.focusedNode() ?? view.root).dispatchEvent(
        new window.KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    tab();
    expect(view.focusedNode()).toBe(panel);
    tab();
    expect(view.focusedNode()).toBe(other);
    tab();
    expect(view.focusedNode()).toBe(panel);
    tab(true);
    expect(view.focusedNode()).toBe(other);
  });

  it('sends keys to the focused node, or the root', () => {
    const { other, events } = setup();
    const key = (target: HTMLElement) =>
      target.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }),
      );
    key(view.rootElement);
    other.focusable = true;
    other.focus();
    key(el(other));
    expect(events.filter((e) => e.startsWith('keydown'))).toEqual([
      'keydown@root',
      'keydown@other',
    ]);
  });

  it('ignores nodes that cannot take focus, and blurs on removal', () => {
    const { other } = setup();
    other.focus();
    expect(view.focusedNode()).toBeNull();
    other.focusable = true;
    other.focus();
    expect(other.focused).toBe(true);
    other.remove();
    expect(view.focusedNode()).toBeNull();
  });

  it('blurs the plugin when focus leaves for the host page', () => {
    const { other, events } = setup();
    other.focusable = true;
    other.focus();
    const outside = document.createElement('button');
    document.body.append(outside);
    el(other).dispatchEvent(
      new window.FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: outside,
      }),
    );
    expect(view.focusedNode()).toBeNull();
    expect(events).toContain('blur@other');
  });
});

describe('wheel', () => {
  it('scrolls the nearest scroll view, unless prevented', () => {
    setup();
    const scroll = view.createNode('scroll');
    const content = view.createNode('view');
    view.root.appendChild(scroll);
    scroll.appendChild(content);
    vi.mocked(document.elementFromPoint).mockReturnValue(el(content));
    let top = 0;
    Object.defineProperty(el(scroll), 'scrollTop', {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, 100));
      },
    });
    const scrolled = vi.fn<() => void>();
    scroll.addEventListener('scroll', scrolled);
    const wheel = (deltaY: number, deltaMode = 0) => {
      const event = new window.WheelEvent('wheel', {
        deltaY,
        deltaMode,
        bubbles: true,
        cancelable: true,
      });
      view.rootElement.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(wheel(30)).toBe(true);
    expect(top).toBe(30);
    expect(wheel(1, 1)).toBe(true); // one line: 40 pixels
    expect(top).toBe(70);
    expect(scrolled).toHaveBeenCalledTimes(2);
    wheel(100);
    expect(top).toBe(100);
    // At the end: nothing scrolls, so the page may.
    expect(wheel(10)).toBe(false);

    content.addEventListener('wheel', (event) => event.preventDefault());
    expect(wheel(-50)).toBe(true);
    expect(top).toBe(100);
  });
});

describe('text inputs', () => {
  function input() {
    setup();
    const node = view.createNode('input');
    view.root.appendChild(node);
    const element = el(node) as HTMLInputElement;
    const seen: string[] = [];
    for (const type of ['beforeinput', 'input', 'change'])
      node.addEventListener(type, (event) => {
        const data = (event as unknown as { data?: string | null }).data;
        seen.push(data === undefined ? type : `${type}:${data}`);
      });
    return { node, element, seen };
  }

  it('reports text before it arrives, and lets listeners refuse it', () => {
    const { node, element, seen } = input();
    const refuse = (event: Event) => {
      if ((event as unknown as { data: string }).data === 'x')
        event.preventDefault();
    };
    node.addEventListener('beforeinput', refuse);
    const native = (data: string) => {
      const event = new window.InputEvent('beforeinput', {
        data,
        inputType: 'insertText',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(native('a')).toBe(false);
    expect(native('x')).toBe(true);
    expect(seen).toEqual(['beforeinput:a', 'beforeinput:x']);
  });

  it('reports edits, and commits on Enter and on blur', () => {
    const { node, element, seen } = input();
    node.focus();
    element.value = 'ab';
    element.dispatchEvent(
      new window.InputEvent('input', {
        data: 'b',
        inputType: 'insertText',
        bubbles: true,
      }),
    );
    element.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    element.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    element.value = 'abc';
    node.blur();
    expect(seen).toEqual(['input:b', 'change', 'change']);
  });
});

describe('clipboard', () => {
  it('falls back to the page when the system clipboard is refused', async () => {
    setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: () => Promise.reject(new Error('denied')),
        writeText: () => Promise.reject(new Error('denied')),
      },
    });
    await view.writeClipboard('copied');
    expect(await view.readClipboard()).toBe('copied');
  });
});
