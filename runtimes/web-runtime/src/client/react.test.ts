// @vitest-environment happy-dom
// The real @soundor/react renderer on the browser's soundor:ui: the same
// components a plugin renders in the JUCE runtime, with no ReactDOM.

import {
  createPortalHost,
  createRoot,
  FocusScope,
  flushSync,
  Modal,
  Portal,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from '@soundor/react';
import { createElement as h, useState } from 'react';
import {
  overlayRoot,
  root,
  type LayoutRect,
  type UiNode as PluginNode,
} from 'soundor:ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { uiView } from './context';
import { UiNode } from './ui/node';

/** The element drawing a node (plugin code sees the contract's UiNode). */
const element = (node: object): HTMLElement => UiNode.elementOf(node as UiNode);
const view = uiView();
document.body.append(view.rootElement);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Renders `tree` into the view's root, synchronously. */
function render(tree: Parameters<ReturnType<typeof createRoot>['render']>[0]) {
  const reactRoot = createRoot();
  flushSync(() => reactRoot.render(tree));
  return reactRoot;
}

describe('@soundor/react on the DOM soundor:ui', () => {
  it('renders View and Text into the plugin view', () => {
    const reactRoot = render(
      h(
        View,
        { style: { padding: 8, flexDirection: 'row', gap: 4 } },
        h(
          Text,
          { style: { color: 'red', fontSize: 20 } },
          'Gain ',
          h(Text, null, '0.5'),
        ),
      ),
    );
    const [box] = root.children;
    expect(box?.type).toBe('view');
    const html = element(box!);
    expect(html.style.flexDirection).toBe('row');
    expect(html.style.paddingTop).toBe('8px');
    const [text] = box!.children;
    expect(text?.text).toBe('Gain 0.5');
    expect(element(text!).style.color).toBe('red');
    expect(element(text!).style.lineHeight).toBe('24px');
    flushSync(() => reactRoot.unmount());
    expect(root.children).toEqual([]);
  });

  it('reconciles updates, reordering and removal', () => {
    let setItems: (items: string[]) => void = () => {};
    function List() {
      const [items, set] = useState(['a', 'b', 'c']);
      setItems = set;
      return h(
        View,
        null,
        items.map((item) => h(Text, { key: item }, item)),
      );
    }
    const reactRoot = render(h(List));
    const list = root.children[0]!;
    const texts = () => list.children.map((node) => node.text);
    expect(texts()).toEqual(['a', 'b', 'c']);
    const b = list.children[1];

    flushSync(() => setItems(['c', 'b']));
    expect(texts()).toEqual(['c', 'b']);
    expect(list.children[1]).toBe(b);
    expect([...element(list).children].map((e) => e.textContent)).toEqual([
      'c',
      'b',
    ]);
    flushSync(() => reactRoot.unmount());
  });

  it('presses a Pressable through the browser input', () => {
    const onPress = vi.fn<() => void>();
    const reactRoot = render(
      h(
        Pressable,
        {
          onPress,
          style: ({ pressed }: { pressed: boolean }) => ({
            backgroundColor: pressed ? 'blue' : 'gray',
          }),
        },
        h(Text, null, 'Reset'),
      ),
    );
    const button = root.children[0]!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(element(button));
    const pointer = (type: string, buttons: number) =>
      view.rootElement.dispatchEvent(
        new window.PointerEvent(type, {
          bubbles: true,
          clientX: 5,
          clientY: 5,
          button: 0,
          buttons,
          pointerId: 1,
        }),
      );

    flushSync(() => pointer('pointerdown', 1));
    expect(element(button).style.backgroundColor).toBe('blue');
    flushSync(() => pointer('pointerup', 0));
    expect(onPress).toHaveBeenCalledOnce();
    expect(element(button).style.backgroundColor).toBe('gray');
    expect(button.focused).toBe(true);
    flushSync(() => reactRoot.unmount());
  });

  it('edits a controlled TextInput natively', () => {
    const changes: string[] = [];
    function Field() {
      const [value, setValue] = useState('Init');
      return h(TextInput, {
        value,
        onChangeText: (text: string) => {
          changes.push(text);
          setValue(text.toUpperCase());
        },
      });
    }
    const reactRoot = render(h(Field));
    const input = root.children[0]!;
    const native = element(input) as HTMLInputElement;
    expect(native.value).toBe('Init');
    native.value = 'Init pad';
    flushSync(() =>
      native.dispatchEvent(
        new window.InputEvent('input', {
          bubbles: true,
          data: 'd',
          inputType: 'insertText',
        }),
      ),
    );
    expect(changes).toEqual(['Init pad']);
    expect(native.value).toBe('INIT PAD');
    flushSync(() => reactRoot.unmount());
  });

  it('renders Image and ScrollView primitives', () => {
    const reactRoot = render(
      h(
        ScrollView,
        { style: { height: 100 }, contentContainerStyle: { padding: 4 } },
        h(Image, {
          source: '0123456789abcdef.png' as never,
          style: { width: 32 },
        }),
      ),
    );
    const scroll = root.children[0]!;
    expect(scroll.type).toBe('scroll');
    const content = scroll.children[0]!;
    const image = content.children[0]!;
    expect(image.type).toBe('image');
    expect((element(image) as HTMLImageElement).src).toContain(
      'soundor-assets/0123456789abcdef.png',
    );
    expect(element(image).style.width).toBe('32px');
    flushSync(() => reactRoot.unmount());
  });

  it('traps Tab in a FocusScope over the browser keyboard, and restores focus', () => {
    const field = (name: string) =>
      h(View, { focusable: true, key: name, onFocus: () => seen.push(name) });
    const seen: string[] = [];
    const app = (open: boolean) =>
      h(View, null, [
        field('a'),
        open &&
          h(
            FocusScope,
            {
              trapped: true,
              autoFocus: true,
              restoreFocus: true,
              key: 'scope',
            },
            field('b'),
            field('c'),
          ),
        field('d'),
      ]);
    const tab = (shiftKey = false) => {
      const event = new window.KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      view.rootElement.dispatchEvent(event);
      return event;
    };

    const reactRoot = render(app(false));
    root.children[0]!.children[0]!.focus();
    flushSync(() => reactRoot.render(app(true)));
    const tabbed = tab();
    tab();
    tab(true);
    // Default prevented: the browser's own Tab does not run either.
    expect(tabbed.defaultPrevented).toBe(true);
    expect(seen).toEqual(['a', 'b', 'c', 'b', 'c']);
    flushSync(() => reactRoot.render(app(false)));
    expect(seen.at(-1)).toBe('a');
    tab();
    expect(seen.at(-1)).toBe('d');
    flushSync(() => reactRoot.unmount());
  });

  it('portals into the overlay layer over all content, and into custom hosts', () => {
    const host = createPortalHost();
    const reactRoot = render(
      h(
        View,
        { style: { overflow: 'hidden' } },
        h(View, { style: { zIndex: 2147483647 } }),
        h(Portal, null, h(Text, null, 'menu')),
        h(Portal.Host, { host }),
        h(Portal, { host }, h(Text, null, 'hosted')),
      ),
    );
    const overlay = element(overlayRoot);
    const entry = overlayRoot.children[0]!;
    expect(entry.children[0]!.text).toBe('menu');
    expect(overlay.contains(element(entry))).toBe(true);
    // After the content in the surface, in a layer CSS keeps above it.
    expect(overlay.previousElementSibling).toBe(element(root));
    expect(overlay.className).toContain('sd-overlay');
    const [box] = root.children;
    expect(box!.children[1]!.children[0]!.text).toBe('hosted');
    flushSync(() => reactRoot.unmount());
    expect(overlayRoot.children).toEqual([]);
  });

  it('traps Tab across a portal over the browser keyboard', () => {
    const seen: string[] = [];
    const field = (name: string) =>
      h(View, { focusable: true, key: name, onFocus: () => seen.push(name) });
    const reactRoot = render(
      h(View, null, [
        field('background'),
        h(
          FocusScope,
          { trapped: true, autoFocus: true, key: 'scope' },
          field('a'),
          h(Portal, { key: 'portal' }, field('menu')),
        ),
      ]),
    );
    const tab = () =>
      view.rootElement.dispatchEvent(
        new window.KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      );
    tab();
    tab();
    expect(seen).toEqual(['a', 'menu', 'a']);
    flushSync(() => reactRoot.unmount());
  });

  describe('building overlays', () => {
    /** Lays elements out by hand (happy-dom has none); the view at (0, 0). */
    function layout(rects: Map<Element, DOMRect>) {
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect',
      ).mockImplementation(function (this: HTMLElement) {
        if (this === view.rootElement) return new DOMRect(0, 0, 800, 600);
        return rects.get(this) ?? new DOMRect();
      });
    }
    const at = (node: object) => {
      vi.spyOn(document, 'elementFromPoint').mockReturnValue(element(node));
    };

    it('a custom context menu at the pointer: onContextMenu, pageX/Y and Portal', () => {
      layout(new Map());
      function Track() {
        const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
        return h(
          View,
          {
            style: { overflow: 'hidden' },
            onContextMenu: (event: {
              pageX: number;
              pageY: number;
              preventDefault(): void;
            }) => {
              event.preventDefault();
              setMenu({ x: event.pageX, y: event.pageY });
            },
          },
          menu &&
            h(
              Portal,
              null,
              h(View, {
                style: { position: 'absolute', left: menu.x, top: menu.y },
              }),
            ),
        );
      }
      const reactRoot = render(h(Track));
      at(root.children[0]!);
      const native = new window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 45,
        button: 2,
      });
      flushSync(() => view.rootElement.dispatchEvent(native));
      expect(native.defaultPrevented).toBe(true);
      const menu = overlayRoot.children[0]!.children[0]!;
      expect(element(menu).style.left).toBe('120px');
      expect(element(menu).style.top).toBe('45px');
      flushSync(() => reactRoot.unmount());
    });

    it('a tooltip and a dropdown placed from getBoundingClientRect, out of clipping', () => {
      function Picker() {
        const [trigger, setTrigger] = useState<PluginNode | null>(null);
        const [box, setBox] = useState<LayoutRect | null>(null);
        return h(
          View,
          { style: { overflow: 'hidden', height: 50 } },
          h(
            ScrollView,
            null,
            h(Pressable, {
              ref: setTrigger,
              onPress: () => setBox(trigger!.getBoundingClientRect()),
            }),
          ),
          box &&
            h(
              Portal,
              null,
              h(View, {
                style: {
                  position: 'absolute',
                  left: box.x,
                  top: box.y + box.height,
                },
              }),
            ),
        );
      }
      const reactRoot = render(h(Picker));
      const pressable =
        root.children[0]!.children[0]!.children[0]!.children[0]!;
      layout(new Map([[element(pressable), new DOMRect(30, 40, 100, 20)]]));
      at(pressable);
      const pointer = (type: string, buttons: number) =>
        view.rootElement.dispatchEvent(
          new window.PointerEvent(type, {
            bubbles: true,
            clientX: 35,
            clientY: 45,
            button: 0,
            buttons,
            pointerId: 1,
          }),
        );
      flushSync(() => pointer('pointerdown', 1));
      flushSync(() => pointer('pointerup', 0));
      const dropdown = overlayRoot.children[0]!.children[0]!;
      expect(element(dropdown).style.left).toBe('30px');
      expect(element(dropdown).style.top).toBe('60px');
      // Out of the clipping view and the scroll view.
      expect(element(root).contains(element(dropdown))).toBe(false);
      flushSync(() => reactRoot.unmount());
    });

    it('a Modal over the browser input: Escape, Tab, backdrop press', () => {
      const requests: string[] = [];
      const app = (open: boolean) =>
        h(View, null, [
          h(View, { focusable: true, key: 'button' }),
          open &&
            h(
              Modal,
              {
                key: 'modal',
                dismissOnBackdropPress: true,
                onRequestClose: () => requests.push('close'),
              },
              h(View, { focusable: true }),
              h(View, { focusable: true }),
            ),
        ]);
      const reactRoot = render(app(false));
      const button = root.children[0]!.children[0]!;
      button.focus();
      flushSync(() => reactRoot.render(app(true)));
      const [backdrop, content] = overlayRoot.children[0]!.children;
      const [first, second] = content!.children;
      expect(first!.focused).toBe(true);
      const key = (name: string) =>
        view.rootElement.dispatchEvent(
          new window.KeyboardEvent('keydown', {
            key: name,
            bubbles: true,
            cancelable: true,
          }),
        );
      key('Tab');
      key('Tab');
      expect(first!.focused).toBe(true);
      key('Tab');
      expect(second!.focused).toBe(true);
      key('Escape');
      expect(requests).toEqual(['close']);

      at(backdrop!);
      for (const [type, buttons] of [
        ['pointerdown', 1],
        ['pointerup', 0],
      ] as const) {
        view.rootElement.dispatchEvent(
          new window.PointerEvent(type, {
            bubbles: true,
            clientX: 5,
            clientY: 5,
            button: 0,
            buttons,
            pointerId: 1,
          }),
        );
      }
      expect(requests).toEqual(['close', 'close']);
      // The press kept focus in the dialog.
      expect(second!.focused).toBe(true);
      flushSync(() => reactRoot.render(app(false)));
      expect(button.focused).toBe(true);
      flushSync(() => reactRoot.unmount());
    });
  });
});
