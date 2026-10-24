import { createRoot, flushSync } from '@soundor/react';
import {
  Canvas,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useParameter,
  View,
  type ParameterLike,
} from '@soundor/react';
import { print as printNode, type TestNode } from '@soundor/test-runtime';
import { getTestRuntime } from '@soundor/test-runtime';
import {
  render,
  act as reactAct,
  fireEvent as fire,
  screen,
  userEvent,
  advanceTime,
} from '@soundor/testing-library/react';
import { useState, type ReactNode } from 'react';
import { root } from 'soundor:ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
const print = (node = root) => printNode(node as unknown as TestNode);

let mounted: Awaited<ReturnType<typeof render>> | null = null;

async function show(element: ReactNode) {
  if (mounted) await mounted.rerender(element);
  else mounted = await render(element, { container: root });
}

const child = (...path: number[]): TestNode =>
  path.reduce<TestNode>(
    (node, index) => node.children[index]!,
    root as unknown as TestNode,
  );

afterEach(() => {
  mounted = null;
});

describe('rendering', () => {
  it('sets, changes and clears the debugId developer tools find a node by', async () => {
    await show(
      <View debugId="panel">
        <Pressable debugId="reset" />
        <Text debugId="label">Gain</Text>
      </View>,
    );
    expect(child(0).debugId).toBe('panel');
    expect(child(0, 0).debugId).toBe('reset');
    expect(child(0, 1).debugId).toBe('label');
    await show(
      <View>
        <Pressable debugId="restore" />
        <Text>Gain</Text>
      </View>,
    );
    expect(child(0).debugId).toBe('');
    expect(child(0, 0).debugId).toBe('restore');
    expect(child(0, 1).debugId).toBe('');
  });

  it('builds soundor:ui nodes with merged styles', async () => {
    const styles = StyleSheet.create({
      row: { flexDirection: 'row' },
      gap: { gap: 4 },
    });
    await show(
      <View style={[styles.row, false, [styles.gap, { padding: 2 }]]}>
        <View style={{ width: 10 }} />
        <Text style={{ fontSize: 12 }}>Hello</Text>
      </View>,
    );
    expect(print()).toBe(
      'view[view{flexDirection:row,gap:4,padding:2}[view{width:10} text{fontSize:12}"Hello"]]',
    );
  });

  it('flattens strings, numbers and nested <Text> into one text node', async () => {
    const name = 'world';
    await show(
      <Text numberOfLines={2}>
        Hello, <Text style={{ color: 'red' }}>{name}</Text>! {3}
      </Text>,
    );
    expect(print()).toBe('view[text{numberOfLines:2}"Hello, world! 3"]');
    expect(screen.getByRole('text', { name: 'Hello, world! 3' })).toBeDefined();
  });

  it('applies updates, reorders by key and removes', async () => {
    const List = ({ items }: { items: string[] }) => (
      <View>
        {items.map((item) => (
          <Text key={item}>{item}</Text>
        ))}
      </View>
    );
    await show(<List items={['a', 'b', 'c']} />);
    const b = child(0, 1);
    await show(<List items={['c', 'b']} />);
    expect(print()).toBe('view[view[text"c" text"b"]]');
    expect(child(0, 1)).toBe(b); // moved, not recreated
  });

  it('updates nested text in place', async () => {
    const Counter = ({ count }: { count: number }) => (
      <Text>
        Count: <Text>{count}</Text>
      </Text>
    );
    await show(<Counter count={1} />);
    const node = child(0);
    await show(<Counter count={2} />);
    expect(print()).toBe('view[text"Count: 2"]');
    expect(child(0)).toBe(node);
  });

  it('refuses strings outside <Text> and views inside it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reported = vi.fn();
    vi.stubGlobal('reportError', reported);
    const raw = createRoot(root);
    const show = (element: ReactNode) => flushSync(() => raw.render(element));
    await show(<View>loose</View>);
    expect(reported.mock.calls[0]?.[0]).toMatchObject({
      message:
        'Text strings must be rendered within a <Text> component: "loose"',
    });
    await show(
      <Text>
        <View />
      </Text>,
    );
    expect(reported.mock.calls.at(-1)?.[0]).toMatchObject({
      message: '<View> cannot be inside <Text>',
    });
    flushSync(() => raw.unmount());
    vi.unstubAllGlobals();
    errors.mockRestore();
  });

  it('shows images and scroll views with a content container', async () => {
    await show(
      <ScrollView style={{ height: 50 }} contentContainerStyle={{ padding: 4 }}>
        <Image source={'logo.png' as SoundorAsset} style={{ width: 8 }} />
      </ScrollView>,
    );
    expect(print()).toBe(
      'view[scroll{height:50}[view{padding:4}[image{width:8}<logo.png>]]]',
    );
  });

  it('gives refs the soundor:ui node', async () => {
    let node: unknown = null;
    await show(<View ref={(value) => void (node = value)} />);
    expect(node).toBe(child(0));
  });

  it('unmounting empties the root', async () => {
    await show(<View />);
    await mounted!.unmount();
    expect(print()).toBe('view');
  });
});

describe('updates do only what changed', () => {
  /** Counts assignments to a runtime node's property from now on. */
  function countSets(node: TestNode, property: 'style' | 'accessibility') {
    let value: unknown = node[property];
    let sets = 0;
    Object.defineProperty(node, property, {
      configurable: true,
      get: () => value,
      set: (next: unknown) => {
        sets++;
        value = next;
      },
    });
    return () => sets;
  }

  it('re-rendering equal props sets no style or accessibility, and keeps listeners', async () => {
    const onClick = vi.fn();
    // New style objects and a new handler every render, with the same content.
    const Cell = ({ opacity }: { opacity: number }) => (
      <View
        style={[{ width: 10 }, { opacity }]}
        accessibilityLabel="cell"
        onClick={() => onClick(opacity)}
      />
    );
    await show(<Cell opacity={0.5} />);
    const styles = countSets(child(0), 'style');
    const accessibility = countSets(child(0), 'accessibility');
    const listener = child(0).listeners.get('click')![0];

    await show(<Cell opacity={0.5} />);
    expect(styles()).toBe(0);
    expect(accessibility()).toBe(0);
    expect(child(0).listeners.get('click')![0]).toBe(listener);

    await show(<Cell opacity={0.25} />);
    expect(styles()).toBe(1);
    expect(child(0).style).toEqual({ width: 10, opacity: 0.25 });
    fire(child(0), 'click');
    expect(onClick).toHaveBeenCalledWith(0.25);
  });

  it('accessibility objects are compared by what they say', async () => {
    const state = { checked: false };
    await show(
      <View accessibilityRole="checkbox" accessibilityState={state} />,
    );
    const accessibility = countSets(child(0), 'accessibility');
    await show(
      <View accessibilityRole="checkbox" accessibilityState={state} />,
    );
    expect(accessibility()).toBe(0);
    state.checked = true; // changed in place
    await show(
      <View accessibilityRole="checkbox" accessibilityState={state} />,
    );
    expect(accessibility()).toBe(1);
  });

  it('a handler that appears gets a listener', async () => {
    const onClick = vi.fn<() => void>();
    await show(<View />);
    await show(<View onClick={onClick} />);
    fire(child(0), 'click');
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('events', () => {
  it('calls the latest handler, in capture and bubble phases', async () => {
    const log: string[] = [];
    const App = ({ tag }: { tag: string }) => (
      <View
        onClickCapture={() => log.push(`capture ${tag}`)}
        onClick={() => log.push(`bubble ${tag}`)}
      >
        <View onClick={() => log.push(`inner ${tag}`)} />
      </View>
    );
    await show(<App tag="1" />);
    await show(<App tag="2" />);
    fire(child(0, 0), 'click');
    expect(log).toEqual(['capture 2', 'inner 2', 'bubble 2']);
  });

  it('removes listeners whose props go away', async () => {
    const onClick = vi.fn();
    await show(<View onClick={onClick} />);
    await show(<View />);
    fire(child(0), 'click');
    expect(onClick).not.toHaveBeenCalled();
    expect(child(0).listeners.get('click')).toEqual([]);
  });

  it('onContextMenu captures and bubbles with the pointer event', async () => {
    const log: string[] = [];
    await show(
      <View
        onContextMenuCapture={() => log.push('capture')}
        onContextMenu={(event) => log.push(`outer ${event.pageX}`)}
      >
        <View onContextMenu={(event) => log.push(`inner ${event.button}`)} />
      </View>,
    );
    fire(child(0, 0), 'contextmenu', { button: 2, pageX: 12 });
    expect(log).toEqual(['capture', 'inner 2', 'outer 12']);
  });

  it('re-renders from state set in a handler', async () => {
    function Toggle() {
      const [on, setOn] = useState(false);
      return (
        <View onClick={() => setOn((value) => !value)}>
          <Text>{on ? 'on' : 'off'}</Text>
        </View>
      );
    }
    await show(<Toggle />);
    fire(child(0), 'click');

    expect(print()).toBe('view[view[text"on"]]');
  });
});

describe('TextInput', () => {
  it('reports edits and Enter, and follows a controlled value', async () => {
    const submitted = vi.fn();
    function Field() {
      const [text, setText] = useState('ab');
      return (
        <TextInput
          value={text.toUpperCase()}
          onChangeText={setText}
          onSubmitEditing={submitted}
          placeholder="Name"
        />
      );
    }
    await show(<Field />);
    const input = child(0);
    expect([input.text, input.placeholder]).toEqual(['AB', 'Name']);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textinput'), 'c');

    expect(input.text).toBe('ABC');
    await user.keyboard('{Enter}');
    expect(submitted).toHaveBeenCalledWith('ABC');
  });

  it('starts an uncontrolled input with defaultValue only', async () => {
    await show(<TextInput defaultValue="start" />);
    const input = screen.getByRole('textinput'),
      user = userEvent.setup();
    await user.clear(input);
    await user.type(input, 'typed');
    await show(<TextInput defaultValue="other" />);
    expect(input.text).toBe('typed');
  });
});

describe('Pressable', () => {
  it('presses, and styles and renders by its state', async () => {
    const onPress = vi.fn();
    await show(
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        {({ pressed }) => <Text>{pressed ? 'down' : 'up'}</Text>}
      </Pressable>,
    );

    const user = userEvent.setup(),
      button = screen.getByRole('button');
    expect(button.focusable).toBe(true);
    await user.pointer({ target: button, keys: '[MouseLeft>]' });

    expect(print()).toBe('view[view{opacity:0.5}[text"down"]]');
    expect(screen.getByText('down')).toBeDefined();
    await user.pointer({ target: button, keys: '[/MouseLeft]' });

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(print()).toBe('view[view{opacity:1}[text"up"]]');
  });
});

describe('Pressable state and long presses', () => {
  it('renders a press before the next task, as event props do', async () => {
    function Toggle() {
      const [on, setOn] = useState(false);
      return (
        <Pressable onPress={() => setOn(true)}>
          <Text>{on ? 'on' : 'off'}</Text>
        </Pressable>
      );
    }
    await show(<Toggle />);

    fire(child(0), 'click');
    // Microtasks only: no timer has run.
    for (let i = 0; i < 3; ++i) await Promise.resolve();
    expect(print()).toBe('view[view[text"on"]]');
  });

  it('styles by focus, from focus and blur', async () => {
    await show(
      <Pressable style={({ focused }) => ({ opacity: focused ? 0.5 : 1 })} />,
    );

    const button = child(0);
    fire(button, 'focus');

    expect(print()).toBe('view[view{opacity:0.5}]');
    fire(button, 'blur');

    expect(print()).toBe('view[view{opacity:1}]');
  });

  it('passes updated long-press callbacks and respects their delay', async () => {
    const first = vi.fn<(event: unknown) => void>(),
      latest = vi.fn<(event: unknown) => void>();
    await show(<Pressable onPress={() => {}} />);
    const user = userEvent.setup(),
      button = screen.getByRole('button');
    await user.pointer({ target: button, keys: '[MouseLeft>]' });
    await advanceTime(400);
    expect(first).not.toHaveBeenCalled();
    await user.pointer({ target: button, keys: '[/MouseLeft]' });
    await show(<Pressable onLongPress={first} delayLongPress={300} />);
    await show(<Pressable onLongPress={latest} delayLongPress={300} />);
    await user.pointer({ target: button, keys: '[MouseLeft>]' });
    await advanceTime(299);
    expect(latest).not.toHaveBeenCalled();
    await advanceTime(1);
    expect(latest).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pointerdown' }),
    );
    expect(first).not.toHaveBeenCalled();
    await user.pointer({ target: button, keys: '[/MouseLeft]' });
  });

  it('disabling stops pressing and resets the state', async () => {
    const App = ({ disabled }: { disabled: boolean }) => (
      <Pressable
        disabled={disabled}
        onLongPress={() => {}}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      />
    );
    await show(<App disabled={false} />);

    const button = child(0);
    fire(button, 'pointerdown', { button: 0 });

    expect(print()).toBe('view[view{opacity:0.5}]');
    await show(<App disabled />);

    expect(getTestRuntime().pressables.has(button)).toBe(false);
    expect(button.focusable).toBe(false);
    expect(print()).toBe('view[view{opacity:1}]');
  });
});

describe('useParameter', () => {
  it('re-renders when the parameter changes', async () => {
    let value = 0.5;
    const listeners = new Set<(value: number) => void>();
    const gain: ParameterLike<number> = {
      get: () => value,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    function Readout() {
      return <Text>{useParameter(gain).toFixed(2)}</Text>;
    }
    await show(<Readout />);
    expect(print()).toBe('view[text"0.50"]');
    await reactAct(() => {
      value = 0.75;
      for (const listener of listeners) listener(value);
    });

    expect(print()).toBe('view[text"0.75"]');
    expect(screen.getByText('0.75')).toBeDefined();
    await mounted!.unmount();
    expect(listeners.size).toBe(0);
  });
});

describe('Canvas', () => {
  it('sizes its drawing buffer, and leaves it alone while the size stays', async () => {
    let refNode: unknown = null;
    await show(
      <Canvas width={64} height={32} ref={(node) => void (refNode = node)} />,
    );
    const canvas = child(0);
    expect(canvas.type).toBe('canvas');
    expect([canvas.width, canvas.height]).toEqual([64, 32]);
    expect(refNode).toBe(canvas);

    // Something drew: the same size again must not clear it.
    canvas.width = 64;
    const sizes: number[] = [];
    Object.defineProperty(canvas, 'width', {
      get: () => 64,
      set: (value: number) => {
        sizes.push(value);
      },
      configurable: true,
    });
    await show(<Canvas width={64} height={32} style={{ opacity: 0.5 }} />);
    expect(sizes).toEqual([]);
    await show(<Canvas width={128} height={32} />);
    expect(sizes).toEqual([128]);
  });
});
