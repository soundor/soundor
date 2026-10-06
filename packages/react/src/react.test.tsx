import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRoot,
  flushSync,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useParameter,
  View,
  type ParameterLike,
} from './index';
import {
  fire,
  pressables,
  print,
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

afterEach(() => {
  if (mounted) flushSync(() => mounted!.unmount());
  mounted = null;
  reset();
});

describe('rendering', () => {
  it('builds soundor:ui nodes with merged styles', () => {
    const styles = StyleSheet.create({
      row: { flexDirection: 'row' },
      gap: { gap: 4 },
    });
    show(
      <View style={[styles.row, false, [styles.gap, { padding: 2 }]]}>
        <View style={{ width: 10 }} />
        <Text style={{ fontSize: 12 }}>Hello</Text>
      </View>,
    );
    expect(print()).toBe(
      'view[view{flexDirection:row,gap:4,padding:2}[view{width:10} text{fontSize:12}"Hello"]]',
    );
  });

  it('flattens strings, numbers and nested <Text> into one text node', () => {
    const name = 'world';
    show(
      <Text numberOfLines={2}>
        Hello, <Text style={{ color: 'red' }}>{name}</Text>! {3}
      </Text>,
    );
    expect(print()).toBe('view[text{numberOfLines:2}"Hello, world! 3"]');
  });

  it('applies updates, reorders by key and removes', () => {
    const List = ({ items }: { items: string[] }) => (
      <View>
        {items.map((item) => (
          <Text key={item}>{item}</Text>
        ))}
      </View>
    );
    show(<List items={['a', 'b', 'c']} />);
    const b = child(0, 1);
    show(<List items={['c', 'b']} />);
    expect(print()).toBe('view[view[text"c" text"b"]]');
    expect(child(0, 1)).toBe(b); // moved, not recreated
  });

  it('updates nested text in place', () => {
    const Counter = ({ count }: { count: number }) => (
      <Text>
        Count: <Text>{count}</Text>
      </Text>
    );
    show(<Counter count={1} />);
    const node = child(0);
    show(<Counter count={2} />);
    expect(print()).toBe('view[text"Count: 2"]');
    expect(child(0)).toBe(node);
  });

  it('refuses strings outside <Text> and views inside it', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reported = vi.fn();
    vi.stubGlobal('reportError', reported);
    show(<View>loose</View>);
    expect(reported.mock.calls[0]?.[0]).toMatchObject({
      message:
        'Text strings must be rendered within a <Text> component: "loose"',
    });
    show(
      <Text>
        <View />
      </Text>,
    );
    expect(reported.mock.calls.at(-1)?.[0]).toMatchObject({
      message: '<View> cannot be inside <Text>',
    });
    vi.unstubAllGlobals();
    errors.mockRestore();
  });

  it('shows images and scroll views with a content container', () => {
    show(
      <ScrollView style={{ height: 50 }} contentContainerStyle={{ padding: 4 }}>
        <Image source={'logo.png' as SoundorAsset} style={{ width: 8 }} />
      </ScrollView>,
    );
    expect(print()).toBe(
      'view[scroll{height:50}[view{padding:4}[image{width:8}<logo.png>]]]',
    );
  });

  it('gives refs the soundor:ui node', () => {
    let node: unknown = null;
    show(<View ref={(value) => void (node = value)} />);
    expect(node).toBe(child(0));
  });

  it('unmounting empties the root', () => {
    show(<View />);
    flushSync(() => mounted!.unmount());
    expect(print()).toBe('view');
  });
});

describe('events', () => {
  it('calls the latest handler, in capture and bubble phases', () => {
    const log: string[] = [];
    const App = ({ tag }: { tag: string }) => (
      <View
        onClickCapture={() => log.push(`capture ${tag}`)}
        onClick={() => log.push(`bubble ${tag}`)}
      >
        <View onClick={() => log.push(`inner ${tag}`)} />
      </View>
    );
    show(<App tag="1" />);
    show(<App tag="2" />);
    fire(child(0, 0), 'click');
    expect(log).toEqual(['capture 2', 'inner 2', 'bubble 2']);
  });

  it('removes listeners whose props go away', () => {
    const onClick = vi.fn();
    show(<View onClick={onClick} />);
    show(<View />);
    fire(child(0), 'click');
    expect(onClick).not.toHaveBeenCalled();
    expect(child(0).listeners.get('click')).toEqual([]);
  });

  it('onContextMenu captures and bubbles with the pointer event', () => {
    const log: string[] = [];
    show(
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
    show(<Toggle />);
    fire(child(0), 'click');
    await settle();
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
    show(<Field />);
    const input = child(0);
    expect([input.text, input.placeholder]).toEqual(['AB', 'Name']);
    input.value = 'ABc';
    fire(input, 'input');
    await settle();
    expect(input.text).toBe('ABC');
    fire(input, 'keydown', { key: 'Enter' });
    expect(submitted).toHaveBeenCalledWith('ABC');
  });

  it('starts an uncontrolled input with defaultValue only', () => {
    show(<TextInput defaultValue="start" />);
    const input = child(0);
    input.value = 'typed';
    show(<TextInput defaultValue="other" />);
    expect(input.text).toBe('typed');
  });
});

describe('Pressable', () => {
  it('presses, and styles and renders by its state', async () => {
    const onPress = vi.fn();
    show(
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        {({ pressed }) => <Text>{pressed ? 'down' : 'up'}</Text>}
      </Pressable>,
    );
    await settle(); // the effect installs pressable()
    const button = child(0);
    expect(button.focusable).toBe(true);
    fire(button, 'pointerdown', { button: 0 });
    await settle();
    expect(print()).toBe('view[view{opacity:0.5}[text"down"]]');
    fire(button, 'pointerup');
    fire(button, 'click');
    await settle();
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
    show(<Toggle />);
    await settle();
    fire(child(0), 'click');
    // Microtasks only: no timer has run.
    for (let i = 0; i < 3; ++i) await Promise.resolve();
    expect(print()).toBe('view[view[text"on"]]');
  });

  it('styles by focus, from focus and blur', async () => {
    show(
      <Pressable style={({ focused }) => ({ opacity: focused ? 0.5 : 1 })} />,
    );
    await settle();
    const button = child(0);
    fire(button, 'focus');
    await settle();
    expect(print()).toBe('view[view{opacity:0.5}]');
    fire(button, 'blur');
    await settle();
    expect(print()).toBe('view[view{opacity:1}]');
  });

  it('passes onLongPress and its delay only when given', async () => {
    const first = vi.fn<(event: unknown) => void>();
    const latest = vi.fn<(event: unknown) => void>();
    show(<Pressable onPress={() => {}} />);
    await settle();
    expect(pressables.get(child(0))).not.toHaveProperty('onLongPress');

    show(<Pressable onLongPress={first} delayLongPress={300} />);
    await settle();
    show(<Pressable onLongPress={latest} delayLongPress={300} />);
    await settle();
    const handlers = pressables.get(child(0))!;
    expect(handlers['delayLongPress']).toBe(300);
    (handlers['onLongPress'] as (event: unknown) => void)({ type: 'x' });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith({ type: 'x' });
  });

  it('disabling stops pressing and resets the state', async () => {
    const App = ({ disabled }: { disabled: boolean }) => (
      <Pressable
        disabled={disabled}
        onLongPress={() => {}}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      />
    );
    show(<App disabled={false} />);
    await settle();
    const button = child(0);
    fire(button, 'pointerdown', { button: 0 });
    await settle();
    expect(print()).toBe('view[view{opacity:0.5}]');
    show(<App disabled />);
    await settle();
    expect(pressables.has(button)).toBe(false);
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
    show(<Readout />);
    expect(print()).toBe('view[text"0.50"]');
    value = 0.75;
    for (const listener of listeners) listener(value);
    await settle();
    expect(print()).toBe('view[text"0.75"]');
  });
});
