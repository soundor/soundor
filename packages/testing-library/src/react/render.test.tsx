import {
  Pressable,
  Text,
  TextInput,
  View,
  Modal,
  Portal,
  FocusScope,
  useAnimationFrame,
  useParameter,
} from '@soundor/react';
import { getTestRuntime } from '@soundor/test-runtime';
import type {} from '@soundor/vitest';
import {
  createContext,
  createRef,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { snapshot, subscribe } from 'soundor:host';
import { parameters } from 'soundor:parameters';
import { expect, test, vi } from 'vitest';

import {
  render,
  screen,
  userEvent,
  cleanup,
  advanceTime,
  waitFor,
  fireEvent,
  act,
  testParameters,
  testHost,
} from './index';

test('renders with the real reconciler and stateful pointer activation', async () => {
  const onChange = vi.fn<(count: number) => void>();
  function Counter() {
    const [count, set] = useState(0);
    return (
      <View>
        <Text>Count: {count}</Text>
        <Pressable
          accessibilityLabel="Increment"
          onPress={() => {
            set(count + 1);
            onChange(count + 1);
          }}
        >
          <Text>+</Text>
        </Pressable>
      </View>
    );
  }
  const result = await render(<Counter />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Increment' }));
  expect(screen.getByText('Count: 1')).toBeDefined();
  expect(onChange).toHaveBeenCalledWith(1);
  await result.unmount();
  expect(screen.queryByRole('button')).toBeNull();
});
test('supports context wrappers, refs, effects, rerender and idempotent cleanup', async () => {
  const Context = createContext('default'),
    ref = createRef<import('soundor:ui').UiNode>();
  const disposed = vi.fn<() => void>();
  function Component({ suffix }: { suffix: string }) {
    const value = useContext(Context);
    useEffect(() => disposed, []);
    return (
      <View ref={ref}>
        <Text>
          {value}
          {suffix}
        </Text>
      </View>
    );
  }
  const wrapper = ({ children }: { children?: import('react').ReactNode }) => (
    <Context.Provider value="context">{children}</Context.Provider>
  );
  const result = await render(<Component suffix="1" />, { wrapper });
  expect(ref.current).not.toBeNull();
  expect(screen.getByText('context1')).toBeDefined();
  await result.rerender(<Component suffix="2" />);
  expect(screen.getByText('context2')).toBeDefined();
  await cleanup();
  await cleanup();
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(ref.current).toBeNull();
});
test('sequential typing, clearing, modifiers and focus traversal preserve input state', async () => {
  function Inputs() {
    const [value, set] = useState('');
    return (
      <View>
        <TextInput accessibilityLabel="Name" value={value} onChangeText={set} />
        <Pressable accessibilityLabel="Save" onPress={() => set('saved')}>
          <Text>Save</Text>
        </Pressable>
        <Text>Value: {value}</Text>
      </View>
    );
  }
  await render(<Inputs />);
  const user = userEvent.setup();
  const input = screen.getByRole('textinput', { name: 'Name' });
  await user.type(input, 'ab');
  await user.keyboard('{ArrowLeft}X');
  expect(input.value).toBe('aXb');
  await user.clear(input);
  expect(input.value).toBe('');
  await user.type(input, 'test');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(input.value).toBe('saved');
  await user.tab({ shift: true });
  expect(input).toHaveFocus();
});
test('modal overlays, portals, focus traps and dismissal are testable semantically', async () => {
  function App() {
    const [open, set] = useState(true);
    return (
      <View>
        <TextInput accessibilityLabel="Background" />
        <Modal visible={open} onRequestClose={() => set(false)}>
          <TextInput accessibilityLabel="First" />
          <Portal>
            <TextInput accessibilityLabel="Portaled" />
          </Portal>
          <TextInput accessibilityLabel="Last" />
        </Modal>
      </View>
    );
  }
  await render(<App />);
  const user = userEvent.setup();
  expect(screen.queryByLabelText('Background')).toBeNull();
  expect(screen.getByRole('dialog')).toBeDefined();
  await user.tab();
  expect(
    screen.queryByLabelText('Background', { hidden: true }),
  ).not.toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Background')).toBeDefined();
});
test('effects and frame work are cleaned automatically between tests', async () => {
  await render(<Frames />);
  await advanceTime(34);
  expect(getTestRuntime().clock.pending).toBe(1);
  function Frames() {
    useAnimationFrame(() => {});
    return <Text>Frame</Text>;
  }
});
test('a subsequent test starts with no rendered roots or frames', () => {
  expect(getTestRuntime().root.children).toEqual([]);
  expect(getTestRuntime().clock.pending).toBe(0);
  expect(screen.queryByText('Frame')).toBeNull();
});
test('disabled controls are skipped and low-level events remain available', async () => {
  const press = vi.fn<() => void>();
  await render(
    <Pressable disabled accessibilityLabel="Disabled" onPress={press}>
      <Text>Off</Text>
    </Pressable>,
  );
  const user = userEvent.setup();
  const node = screen.getByRole('button', { disabled: true });
  await user.click(node);
  await user.press(node);
  expect(press).not.toHaveBeenCalled();
});
test('waitFor and find queries flush async state and coordinate fake timers', async () => {
  vi.useFakeTimers();
  try {
    function App() {
      const [ready, set] = useState(false);
      useEffect(() => {
        const id = setTimeout(() => set(true), 40);
        return () => clearTimeout(id);
      }, []);
      return <Text>{ready ? 'Ready' : 'Waiting'}</Text>;
    }
    await render(<App />);
    expect(
      await screen.findByText('Ready', {}, { timeout: 100 }),
    ).toBeDefined();
    await waitFor(() => expect(screen.queryByText('Waiting')).toBeNull());
  } finally {
    vi.useRealTimers();
  }
});
test('virtual animation and React frame updates are observed through act', async () => {
  function Frames() {
    const [time, set] = useState(0);
    useAnimationFrame((t) => set(Math.round(t)));
    return <Text>Time: {time}</Text>;
  }
  await render(<Frames />);
  await advanceTime(34);
  expect(screen.getByText('Time: 33')).toBeDefined();
  const node = screen.getByRole('text');
  const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 100,
    fill: 'forwards',
  });
  await advanceTime(100);
  expect(animation.playState).toBe('finished');
  expect(node.presentation.opacity).toBe(1);
});
test('fireEvent allows precise native key events within act', async () => {
  await render(<TextInput accessibilityLabel="Input" defaultValue="abc" />);
  const input = screen.getByLabelText('Input');
  await act(() => {
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Backspace' });
  });
  expect(input.value).toBe('ab');
});

test('multiple roots are independently owned and queries can be scoped', async () => {
  const a = await render(<Text>One</Text>),
    b = await render(<Text>Two</Text>);
  expect(a.container).not.toBe(b.container);
  await a.unmount();
  expect(screen.queryByText('One')).toBeNull();
  expect(screen.getByText('Two')).toBeDefined();
  await b.unmount();
});
test('parameter hooks and low-level React fireEvent updates use public APIs', async () => {
  function Gain() {
    const value = useParameter(parameters.gain);
    return <Text>Gain: {String(value)}</Text>;
  }
  await render(<Gain />);
  testParameters.set('gain', 0.25);
  expect(screen.getByText('Gain: 0.25')).toBeDefined();
  function Button() {
    const [value, set] = useState(0);
    return (
      <Pressable accessibilityLabel="Button" onPress={() => set(value + 1)}>
        <Text>{value}</Text>
      </Pressable>
    );
  }
  await render(<Button />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('1')).toBeDefined();
});
test('trapped focus moves forward and backward with portal content', async () => {
  await render(
    <FocusScope trapped autoFocus>
      <TextInput accessibilityLabel="A" />
      <Portal>
        <TextInput accessibilityLabel="B" />
      </Portal>
    </FocusScope>,
  );
  const user = userEvent.setup();
  expect(screen.getByLabelText('A')).toHaveFocus();
  await user.tab();
  expect(screen.getByLabelText('B')).toHaveFocus();
  await user.tab();
  expect(screen.getByLabelText('A')).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByLabelText('B')).toHaveFocus();
});

test('setup helpers work before rendering and commit subscribed React updates synchronously', async () => {
  const errors = vi.spyOn(console, 'error');
  try {
    testParameters.set('gain', 0.75);
    testHost.set({ hostName: 'Before render' });
    function Status() {
      const gain = useParameter(parameters.gain);
      const host = useSyncExternalStore(subscribe, snapshot);
      return (
        <Text>
          {host.hostName}: {gain}
        </Text>
      );
    }
    await render(<Status />);
    expect(screen.getByText('Before render: 0.75')).toBeDefined();
    testHost.set({ hostName: 'After render' });
    testParameters.set('gain', 0.25);
    expect(screen.getByText('After render: 0.25')).toBeDefined();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});
