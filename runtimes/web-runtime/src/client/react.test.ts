// @vitest-environment happy-dom
// The real @soundor/react renderer on the browser's soundor:ui: the same
// components a plugin renders in the JUCE runtime, with no ReactDOM.

import {
  createRoot,
  flushSync,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from '@soundor/react';
import { createElement as h, useState } from 'react';
import { root } from 'soundor:ui';
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
});
