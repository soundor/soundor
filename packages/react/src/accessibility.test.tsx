import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPortalHost,
  createRoot,
  flushSync,
  Image,
  Modal,
  Portal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
} from './index';
import {
  FakeEvent,
  fire,
  overlayRoot,
  reset,
  root,
  type FakeNode,
} from './testing/fake-ui';

let mounted: ReturnType<typeof createRoot> | null = null;

function show(element: ReactNode) {
  mounted ??= createRoot();
  flushSync(() => mounted!.render(element));
}

/** Lets scheduled work (event-driven updates, effects) run. */
async function settle() {
  for (let i = 0; i < 5; ++i)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

const child = (...path: number[]): FakeNode =>
  path.reduce<FakeNode>(
    (node, index) => node.children[index]!,
    root as FakeNode,
  );

/** Assistive technology asking `node` for an action. */
function act(node: FakeNode, actionName: string, value?: number | string) {
  return fire(node, 'accessibilityaction', { actionName, value });
}

afterEach(() => {
  if (mounted) flushSync(() => mounted!.unmount());
  mounted = null;
  reset();
});

describe('accessibility props', () => {
  it('become the node accessibility, by their soundor:ui names', () => {
    show(
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Gain"
        accessibilityHint="Drag to change"
        accessibilityState={{ busy: true }}
        accessibilityValue={{ min: -60, max: 12, now: -3.5, text: '-3.5 dB' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      />,
    );
    expect(child(0).accessibility).toEqual({
      role: 'adjustable',
      label: 'Gain',
      hint: 'Drag to change',
      state: { busy: true },
      value: { min: -60, max: 12, now: -3.5, text: '-3.5 dB' },
      actions: [{ name: 'increment' }, { name: 'decrement' }],
    });
  });

  it('apply to every primitive', () => {
    const asset = 'abc.png' as SoundorAsset;
    show(
      <View>
        <Text accessibilityRole="header">Title</Text>
        <Image source={asset} accessibilityLabel="Logo" />
        <TextInput accessibilityLabel="Name" />
        <ScrollView accessible={false} />
      </View>,
    );
    expect(child(0).children.map((node) => node.accessibility)).toEqual([
      { role: 'header' },
      { label: 'Logo' },
      { label: 'Name' },
      { accessible: false },
    ]);
  });

  it('leave nodes without them alone, and set only what changed', () => {
    const assigned = vi.fn();
    function Gain({ now }: { now: number }) {
      return (
        <View
          ref={(node) => {
            if (node === null) return;
            const fake = node as unknown as FakeNode;
            let value = fake.accessibility;
            Object.defineProperty(fake, 'accessibility', {
              configurable: true,
              get: () => value,
              set: (next: Record<string, unknown>) => {
                assigned(next);
                value = next;
              },
            });
          }}
          accessibilityRole="adjustable"
          accessibilityValue={{ now }}
        />
      );
    }
    show(
      <View>
        <Gain now={1} />
      </View>,
    );
    expect(child(0).accessibility).toEqual({});
    show(
      <View>
        <Gain now={1} />
      </View>,
    );
    expect(assigned).not.toHaveBeenCalled();
    show(
      <View>
        <Gain now={2.5} />
      </View>,
    );
    expect(assigned).toHaveBeenCalledTimes(1);
    expect(child(0, 0).accessibility).toEqual({
      role: 'adjustable',
      value: { now: 2.5 },
    });
  });

  it('call onAccessibilityAction for actions asked of the element itself', () => {
    const outer = vi.fn();
    const inner = vi.fn((event: AccessibilityActionEvent) =>
      event.preventDefault(),
    );
    show(
      <View onAccessibilityAction={outer}>
        <View
          accessibilityActions={[{ name: 'increment' }]}
          onAccessibilityAction={inner}
        />
      </View>,
    );
    const event = act(child(0, 0), 'increment');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner.mock.calls[0]![0]).toBe(event);
    expect(event.defaultPrevented).toBe(true);
    // It bubbled, but the outer element was not asked.
    expect(outer).not.toHaveBeenCalled();
    act(child(0), 'escape');
    expect(outer).toHaveBeenCalledTimes(1);
  });
});

describe('Pressable', () => {
  it('is a button by default, labelled by its text, offering activate', () => {
    show(
      <Pressable onPress={() => {}}>
        <Text>Reset</Text>
      </Pressable>,
    );
    expect(child(0).accessibility).toEqual({
      accessible: true,
      role: 'button',
      actions: [{ name: 'activate' }],
    });
  });

  it('presses on activate, and long-presses on longpress', async () => {
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    show(<Pressable onPress={onPress} onLongPress={onLongPress} />);
    await settle();
    expect(child(0).accessibility['actions']).toEqual([
      { name: 'activate' },
      { name: 'longpress' },
    ]);
    act(child(0), 'activate');
    expect(onPress).toHaveBeenCalledTimes(1);
    act(child(0), 'longpress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('takes another role and more actions without losing its own', async () => {
    const onPress = vi.fn();
    const actions: string[] = [];
    show(
      <Pressable
        onPress={onPress}
        accessibilityRole="adjustable"
        accessibilityLabel="Gain"
        accessibilityValue={{ min: -60, max: 12, now: -3.5, text: '-3.5 dB' }}
        accessibilityActions={[
          { name: 'increment' },
          { name: 'decrement' },
          { name: 'activate', label: 'Reset' },
        ]}
        onAccessibilityAction={(event) => actions.push(event.actionName)}
      />,
    );
    await settle();
    expect(child(0).accessibility).toEqual({
      accessible: true,
      role: 'adjustable',
      label: 'Gain',
      value: { min: -60, max: 12, now: -3.5, text: '-3.5 dB' },
      actions: [
        { name: 'increment' },
        { name: 'decrement' },
        { name: 'activate', label: 'Reset' },
      ],
    });
    act(child(0), 'increment');
    act(child(0), 'activate');
    expect(actions).toEqual(['increment', 'activate']);
    // Not prevented: activate still presses.
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lets onAccessibilityAction take activate over', async () => {
    const onPress = vi.fn();
    show(
      <Pressable
        onPress={onPress}
        onAccessibilityAction={(event) => event.preventDefault()}
      />,
    );
    await settle();
    act(child(0), 'activate');
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is disabled to assistive technology while disabled', async () => {
    const onPress = vi.fn();
    const { rerender } = (() => {
      const rerender = (disabled: boolean) =>
        show(<Pressable onPress={onPress} disabled={disabled} />);
      return { rerender };
    })();
    rerender(true);
    await settle();
    expect(child(0).accessibility).toEqual({
      accessible: true,
      role: 'button',
      state: { disabled: true },
    });
    act(child(0), 'activate');
    expect(onPress).not.toHaveBeenCalled();
    rerender(false);
    await settle();
    expect(child(0).accessibility['state']).toBeUndefined();
    act(child(0), 'activate');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicit disabled state over its own', () => {
    show(<Pressable disabled accessibilityState={{ disabled: false }} />);
    expect(child(0).accessibility['state']).toEqual({ disabled: false });
    show(<Pressable accessible={false} />);
    expect(child(0).accessibility['accessible']).toBe(false);
  });
});

describe('Modal and Portal', () => {
  const entries = () => overlayRoot.children as FakeNode[];

  it('a modal is a modal dialog to assistive technology', () => {
    show(
      <Modal accessibilityLabel="Settings">
        <Text>Inside</Text>
      </Modal>,
    );
    expect(entries()).toHaveLength(1);
    expect(entries()[0]!.accessibility).toEqual({
      role: 'dialog',
      modal: true,
      label: 'Settings',
    });
    expect(entries()[0]!.accessibilityParent).toBe(null);
  });

  it('an overlay opened inside another belongs to it', () => {
    show(
      <View>
        <Portal>
          <Text>Top level</Text>
        </Portal>
        <Modal>
          <View />
          <Portal>
            <Text>Menu</Text>
            <Modal>
              <Text>Nested</Text>
            </Modal>
          </Portal>
        </Modal>
      </View>,
    );
    const [top, modal, menu, nested] = entries();
    expect(top!.accessibilityParent).toBe(null);
    expect(top!.accessibility).toEqual({});
    expect(modal!.accessibilityParent).toBe(null);
    expect(menu!.accessibilityParent).toBe(modal);
    expect(menu!.accessibility).toEqual({});
    expect(nested!.accessibilityParent).toBe(menu);
    expect(nested!.accessibility['modal']).toBe(true);
  });

  it('a hosted portal is read where its host is', () => {
    const host = createPortalHost();
    show(
      <View>
        <Portal.Host host={host} />
        <Modal>
          <Portal host={host}>
            <Text>Hosted</Text>
          </Portal>
        </Modal>
      </View>,
    );
    // Rendered into the host's node, with no accessibility parent of its own.
    const hosted = child(0, 0).children[0]!;
    expect(hosted.text).toBe('Hosted');
    expect(hosted.accessibilityParent).toBe(null);
  });

  it('closing a nested modal leaves the outer one, then nothing', () => {
    function Screen() {
      const [inner, setInner] = useState(true);
      const [outer, setOuter] = useState(true);
      return (
        <View>
          <Modal visible={outer} accessibilityLabel="Outer">
            <Pressable onPress={() => setOuter(false)} />
            <Modal visible={inner} accessibilityLabel="Inner">
              <Pressable onPress={() => setInner(false)} />
            </Modal>
          </Modal>
        </View>
      );
    }
    show(<Screen />);
    expect(entries().map((entry) => entry.accessibility['label'])).toEqual([
      'Outer',
      'Inner',
    ]);
    // The inner modal's close button: entry → content → pressable.
    const closeInner = entries()[1]!.children[1]!.children[0]!;
    flushSync(() => {
      closeInner.dispatchEvent(
        new FakeEvent('accessibilityaction', { actionName: 'activate' }),
      );
    });
    expect(entries().map((entry) => entry.accessibility['label'])).toEqual([
      'Outer',
    ]);
  });
});

describe('cooperation', () => {
  it('a modal closes on assistive technology escape, the topmost first', () => {
    const closed: string[] = [];
    show(
      <Modal onRequestClose={() => closed.push('outer')}>
        <Modal onRequestClose={() => closed.push('inner')}>
          <Text>Inner</Text>
        </Modal>
      </Modal>,
    );
    const [outer, inner] = overlayRoot.children as FakeNode[];
    expect(outer!.accessibility['actions']).toEqual([{ name: 'escape' }]);
    // Asked of something inside the inner dialog, bubbling up.
    const event = act(inner!.children[1]!, 'escape');
    expect(event.defaultPrevented).toBe(true);
    expect(closed).toEqual(['inner']);
    // Other actions are not a dismissal.
    act(inner!, 'activate');
    expect(closed).toEqual(['inner']);
  });

  it('a modal without onRequestClose offers no escape', () => {
    show(<Modal accessibilityLabel="Busy" />);
    expect(
      (overlayRoot.children[0] as FakeNode).accessibility['actions'],
    ).toBeUndefined();
  });

  it('an accessible knob: pointer, keys and assistive technology change one state', async () => {
    function Knob() {
      const [gain, setGain] = useState(-3.5);
      const change = (next: number) =>
        setGain(Math.min(12, Math.max(-60, next)));
      return (
        <View
          focusable
          accessibilityRole="adjustable"
          accessibilityLabel="Gain"
          accessibilityValue={{
            min: -60,
            max: 12,
            now: gain,
            text: `${gain} dB`,
          }}
          accessibilityActions={[
            { name: 'increment' },
            { name: 'decrement' },
            { name: 'setValue' },
          ]}
          onAccessibilityAction={(event) => {
            if (event.actionName === 'increment') change(gain + 0.5);
            if (event.actionName === 'decrement') change(gain - 0.5);
            if (event.actionName === 'setValue') change(Number(event.value));
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') change(gain + 0.5);
          }}
          onWheel={(event) => change(gain - event['deltaY'] / 100)}
        />
      );
    }
    show(<Knob />);
    const value = () => child(0).accessibility['value'];
    expect(value()).toEqual({ min: -60, max: 12, now: -3.5, text: '-3.5 dB' });
    flushSync(() => act(child(0), 'increment'));
    expect(value()).toMatchObject({ now: -3, text: '-3 dB' });
    flushSync(() => fire(child(0), 'keydown', { key: 'ArrowUp' }));
    expect(value()).toMatchObject({ now: -2.5 });
    flushSync(() => fire(child(0), 'wheel', { deltaY: 50 }));
    expect(value()).toMatchObject({ now: -3 });
    flushSync(() => act(child(0), 'setValue', 6.25));
    expect(value()).toMatchObject({ now: 6.25, text: '6.25 dB' });
    flushSync(() => act(child(0), 'decrement'));
    expect(value()).toMatchObject({ now: 5.75 });
    await settle();
  });
});
