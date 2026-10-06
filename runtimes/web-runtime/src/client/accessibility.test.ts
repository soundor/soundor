// @vitest-environment happy-dom
// Soundor's accessibility semantics as ARIA on the plugin view's elements:
// low-level nodes, then @soundor/react's components.

import {
  createPortalHost,
  createRoot,
  flushSync,
  Image,
  Modal,
  Portal,
  Pressable,
  Text,
  TextInput,
  View,
} from '@soundor/react';
import { createElement as h, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { uiView } from './context';
import { UiNode } from './ui/node';

const view = uiView();
document.body.append(view.rootElement);

/** The element drawing a node (plugin code sees the contract's UiNode). */
const element = (node: object): HTMLElement => UiNode.elementOf(node as UiNode);

/** Each ARIA attribute (and role, alt) an element has. */
function aria(node: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, value } of element(node).attributes)
    if (name === 'role' || name === 'alt' || name.startsWith('aria-'))
      out[name] = value;
  return out;
}

let mounted: ReturnType<typeof createRoot> | null = null;

function render(tree: ReactNode) {
  mounted ??= createRoot();
  flushSync(() => mounted!.render(tree));
  view.updateSemantics();
}

afterEach(() => {
  if (mounted) flushSync(() => mounted!.unmount());
  mounted = null;
  for (const child of view.overlay.children) child.remove();
  view.updateSemantics();
  vi.restoreAllMocks();
});

const first = (): UiNode => view.root.children[0]!;

describe('ARIA', () => {
  it('a button labelled by its text', () => {
    render(h(Pressable, { onPress: () => {} }, h(Text, null, 'Reset')));
    expect(aria(first())).toEqual({ role: 'button', 'aria-label': 'Reset' });
    // The text inside is plain text: no role, nothing hidden.
    expect(aria(first().children[0]!)).toEqual({});
  });

  it('an adjustable control: a slider with its range and text', () => {
    render(
      h(View, {
        accessibilityRole: 'adjustable',
        accessibilityLabel: 'Gain',
        accessibilityHint: 'Drag up or down',
        accessibilityValue: { min: -60, max: 12, now: -3.5, text: '-3.5 dB' },
      }),
    );
    expect(aria(first())).toEqual({
      role: 'slider',
      'aria-label': 'Gain',
      'aria-description': 'Drag up or down',
      'aria-valuemin': '-60',
      'aria-valuemax': '12',
      'aria-valuenow': '-3.5',
      'aria-valuetext': '-3.5 dB',
    });
  });

  it('checkboxes, switches and toggle buttons', () => {
    render(
      h(
        View,
        null,
        h(View, {
          accessibilityRole: 'checkbox',
          accessibilityLabel: 'Sync',
          accessibilityState: { checked: 'mixed' },
        }),
        h(View, {
          accessibilityRole: 'switch',
          accessibilityLabel: 'Bypass',
          accessibilityState: { checked: false, disabled: true },
        }),
        h(View, {
          accessibilityRole: 'togglebutton',
          accessibilityLabel: 'Solo',
          accessibilityState: { checked: true },
        }),
      ),
    );
    const [box, toggle, solo] = first().children;
    expect(aria(box!)).toEqual({
      role: 'checkbox',
      'aria-label': 'Sync',
      'aria-checked': 'mixed',
    });
    expect(aria(toggle!)).toEqual({
      role: 'switch',
      'aria-label': 'Bypass',
      'aria-checked': 'false',
      'aria-disabled': 'true',
    });
    expect(aria(solo!)).toEqual({
      role: 'button',
      'aria-label': 'Solo',
      'aria-pressed': 'true',
    });
  });

  it('follows changes of state and value', async () => {
    let set!: (value: number) => void;
    function Knob() {
      const [value, setValue] = useState(0.25);
      set = setValue;
      return h(View, {
        accessibilityRole: 'adjustable',
        accessibilityLabel: 'Mix',
        accessibilityValue: { min: 0, max: 1, now: value },
        accessibilityState: { disabled: value > 0.9 },
      });
    }
    render(h(Knob));
    expect(aria(first())['aria-valuenow']).toBe('0.25');
    flushSync(() => set(0.95));
    // Updated by itself once the task's changes are done.
    await Promise.resolve();
    expect(aria(first())).toEqual({
      role: 'slider',
      'aria-label': 'Mix',
      'aria-valuemin': '0',
      'aria-valuemax': '1',
      'aria-valuenow': '0.95',
      'aria-disabled': 'true',
    });
  });

  it('text inputs keep the native input, labelled', () => {
    render(
      h(TextInput, {
        accessibilityLabel: 'Preset name',
        placeholder: 'Untitled',
        defaultValue: 'Init',
      }),
    );
    const input = element(first()) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(aria(first())).toEqual({ 'aria-label': 'Preset name' });
    expect(input.placeholder).toBe('Untitled');
    expect(input.value).toBe('Init');
  });

  it('images are decorative unless labelled', () => {
    const asset = '0123456789abcdef.png' as SoundorAsset;
    render(
      h(
        View,
        null,
        h(Image, { source: asset }),
        h(Image, { source: asset, accessibilityLabel: 'Logo' }),
      ),
    );
    const [decorative, logo] = first().children;
    expect(aria(decorative!)).toEqual({ alt: '' });
    expect(aria(logo!)).toEqual({ alt: 'Logo' });
  });

  it('accessible={false} takes out the node, not what it holds', () => {
    render(
      h(
        View,
        null,
        h(
          Pressable,
          { accessible: false, onPress: () => {} },
          h(Text, null, 'Still read'),
        ),
        h(Text, { accessible: false }, 'Not read'),
      ),
    );
    const [pressable, text] = first().children;
    expect(aria(pressable!)).toEqual({});
    expect(aria(pressable!.children[0]!)).toEqual({});
    expect(aria(text!)).toEqual({ 'aria-hidden': 'true' });
  });

  it('labels from descendants for roles the browser would not name', () => {
    render(
      h(
        View,
        { accessibilityRole: 'adjustable' },
        h(Text, null, 'Cutoff'),
        h(View, null, h(Text, null, '1.2 kHz')),
      ),
    );
    expect(aria(first())['aria-label']).toBe('Cutoff 1.2 kHz');
  });

  it('hidden nodes are hidden by the browser', () => {
    render(h(View, { style: { display: 'none' } }, h(Text, null, 'Hidden')));
    expect(element(first()).style.display).toBe('none');
  });
});

describe('Modal and Portal', () => {
  const entries = () => view.overlay.children;
  const hidden = (node: UiNode) => aria(node)['aria-hidden'] === 'true';

  it('a modal is a modal dialog; the content behind it is hidden', () => {
    function Screen({ open }: { open: boolean }) {
      return h(
        View,
        null,
        h(Text, null, 'Background'),
        h(
          Modal,
          { visible: open, accessibilityLabel: 'Settings' },
          h(Text, null, 'Inside'),
        ),
      );
    }
    render(h(Screen, { open: true }));
    const [modal] = entries();
    expect(aria(modal!)).toEqual({
      role: 'dialog',
      'aria-label': 'Settings',
      'aria-modal': 'true',
    });
    expect(hidden(view.root)).toBe(true);
    expect(hidden(view.overlay)).toBe(false);

    render(h(Screen, { open: false }));
    expect(entries()).toHaveLength(0);
    expect(hidden(view.root)).toBe(false);
  });

  it('a nested modal supersedes the outer one until it closes', () => {
    function Screen({ inner }: { inner: boolean }) {
      return h(
        Modal,
        { accessibilityLabel: 'Outer' },
        h(Text, null, 'Outer content'),
        h(
          Modal,
          { visible: inner, accessibilityLabel: 'Inner' },
          h(Text, null, 'Inner content'),
        ),
      );
    }
    render(h(Screen, { inner: true }));
    const [outer, inner] = entries();
    expect(hidden(outer!)).toBe(true);
    expect(hidden(inner!)).toBe(false);
    expect(hidden(view.root)).toBe(true);
    // The inner modal is read as part of the outer one.
    expect(aria(outer!)['aria-owns']).toBe(element(inner!).id);

    render(h(Screen, { inner: false }));
    expect(entries()).toHaveLength(1);
    expect(hidden(entries()[0]!)).toBe(false);
    expect(aria(entries()[0]!)['aria-owns']).toBeUndefined();
    expect(hidden(view.root)).toBe(true);
  });

  it('a portal opened inside a modal stays reachable', () => {
    render(
      h(
        View,
        null,
        h(Text, null, 'Background'),
        h(
          Modal,
          { accessibilityLabel: 'Preset' },
          h(View),
          h(
            Portal,
            null,
            h(
              View,
              { accessibilityRole: 'menu' },
              h(
                Pressable,
                { accessibilityRole: 'menuitem' },
                h(Text, null, 'Save'),
              ),
            ),
          ),
        ),
      ),
    );
    const [modal, menu] = entries();
    expect(hidden(modal!)).toBe(false);
    expect(hidden(menu!)).toBe(false);
    expect(aria(modal!)['aria-owns']).toBe(element(menu!).id);
    expect(aria(menu!.children[0]!)).toEqual({ role: 'menu' });
    expect(aria(menu!.children[0]!.children[0]!)).toEqual({
      role: 'menuitem',
      'aria-label': 'Save',
    });
    expect(hidden(view.root)).toBe(true);
  });

  it('a custom Portal.Host shows its content where the host is', () => {
    const host = createPortalHost();
    render(
      h(
        View,
        null,
        h(Portal.Host, { host }),
        h(Portal, { host }, h(Text, null, 'Hosted')),
      ),
    );
    const hostNode = first().children[0]!;
    expect(hostNode.children[0]!.text).toBe('Hosted');
    expect(aria(hostNode)).toEqual({});
    expect(aria(hostNode.children[0]!)).toEqual({});
    expect(hidden(view.root)).toBe(false);
  });

  it('a custom host outside a modal is hidden with the background', () => {
    const host = createPortalHost();
    render(
      h(
        View,
        null,
        h(Portal.Host, { host }),
        h(Modal, null, h(Portal, { host }, h(Text, null, 'Hosted'))),
      ),
    );
    expect(hidden(view.root)).toBe(true);
  });
});

describe('activation', () => {
  /** A click as assistive technology sends it: no pointer, detail 0. */
  const atClick = (node: UiNode) =>
    element(node).dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

  it('assistive technology presses a Pressable once', () => {
    const onPress = vi.fn();
    render(h(Pressable, { onPress }, h(Text, null, 'Go')));
    // On the text inside, as a screen reader may click.
    atClick(first().children[0]!);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0]![0].type).toBe('accessibilityaction');
  });

  it('a pointer click is not delivered twice', () => {
    const onPress = vi.fn();
    render(h(Pressable, { onPress, style: { width: 50, height: 50 } }));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(element(first()));
    const pointer = (type: string, buttons: number) =>
      view.rootElement.dispatchEvent(
        new window.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
          button: 0,
          buttons,
          pointerId: 1,
        }),
      );
    pointer('pointerdown', 1);
    pointer('pointerup', 0);
    // The browser's own click after the release.
    element(first()).dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, detail: 1 }),
    );
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0]![0].type).toBe('click');
  });

  it('a disabled Pressable is not pressed', () => {
    const onPress = vi.fn();
    render(h(Pressable, { onPress, disabled: true }));
    atClick(first());
    expect(onPress).not.toHaveBeenCalled();
  });

  it('onAccessibilityAction can take activate over', () => {
    const onPress = vi.fn();
    const actions: string[] = [];
    render(
      h(Pressable, {
        onPress,
        onAccessibilityAction: (event) => {
          actions.push(event.actionName);
          event.preventDefault();
        },
      }),
    );
    atClick(first());
    expect(actions).toEqual(['activate']);
    expect(onPress).not.toHaveBeenCalled();
  });
});
