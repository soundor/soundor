import {
  Text,
  useEditorFocus,
  useEditorSize,
  useEditorVisibility,
  useHostState,
  useNativeStream,
  useParameter,
  usePresetSelection,
  useStateValue,
} from '@soundor/react';
import { getTestRuntime } from '@soundor/test-runtime';
import {
  act,
  publishStream,
  render,
  screen,
  testEditor,
  testHost,
} from '@soundor/testing-library/react';
import { StrictMode } from 'react';
import { streams } from 'soundor:native';
import { presets } from 'soundor:presets';
import { state } from 'soundor:state';
import { describe, expect, it, vi } from 'vitest';

type Counted = Record<
  | 'hostListeners'
  | 'editorListeners'
  | 'visibilityListeners'
  | 'focusListeners',
  { size: number }
>;

/** How many subscribers the simulated runtime has of one signal. */
function subscribers(signal: keyof Counted): number {
  return (getTestRuntime() as unknown as Counted)[signal].size;
}

function streamSubscribers(name: string): number {
  return (
    getTestRuntime() as unknown as {
      nativeStream(name: string): { listeners: { size: number } };
    }
  ).nativeStream(name).listeners.size;
}

describe('useEditorVisibility', () => {
  function Visible({ renders }: { renders: () => void }) {
    renders();
    return <Text>{useEditorVisibility() ? 'shown' : 'hidden'}</Text>;
  }

  it('starts visible, follows the editor and re-renders once per change', async () => {
    const renders = vi.fn<() => void>();
    await render(<Visible renders={renders} />);
    expect(screen.getByText('shown')).toBeDefined();
    testEditor.setVisible(false);
    expect(screen.getByText('hidden')).toBeDefined();
    testEditor.setVisible(true);
    expect(screen.getByText('shown')).toBeDefined();
    expect(renders).toHaveBeenCalledTimes(3);
  });

  it('does not re-render for an unchanged visibility, or for focus', async () => {
    const renders = vi.fn<() => void>();
    await render(<Visible renders={renders} />);
    testEditor.setVisible(true);
    testEditor.setFocused(true);
    testEditor.setFocused(false);
    expect(renders).toHaveBeenCalledOnce();
  });

  it('serves several components and unsubscribes with each', async () => {
    const first = await render(<Visible renders={() => {}} />);
    const second = await render(<Visible renders={() => {}} />);
    expect(subscribers('visibilityListeners')).toBe(2);
    testEditor.setVisible(false);
    expect(screen.getAllByText('hidden')).toHaveLength(2);
    await first.unmount();
    expect(subscribers('visibilityListeners')).toBe(1);
    await second.unmount();
    expect(subscribers('visibilityListeners')).toBe(0);
  });

  it('subscribes once under StrictMode and leaves none after it', async () => {
    const view = await render(
      <StrictMode>
        <Visible renders={() => {}} />
      </StrictMode>,
    );
    expect(subscribers('visibilityListeners')).toBe(1);
    await view.unmount();
    expect(subscribers('visibilityListeners')).toBe(0);
  });
});

describe('useEditorFocus', () => {
  function Focus({ renders }: { renders: () => void }) {
    renders();
    return <Text>{useEditorFocus() ? 'focused' : 'unfocused'}</Text>;
  }

  it('starts unfocused, follows the editor and ignores visibility', async () => {
    const renders = vi.fn<() => void>();
    await render(<Focus renders={renders} />);
    expect(screen.getByText('unfocused')).toBeDefined();
    testEditor.setFocused(true);
    expect(screen.getByText('focused')).toBeDefined();
    testEditor.setFocused(true);
    testEditor.setVisible(false);
    expect(screen.getByText('focused')).toBeDefined();
    testEditor.setFocused(false);
    expect(screen.getByText('unfocused')).toBeDefined();
    expect(renders).toHaveBeenCalledTimes(3);
  });

  it('unsubscribes on unmount', async () => {
    const view = await render(<Focus renders={() => {}} />);
    expect(subscribers('focusListeners')).toBe(1);
    await view.unmount();
    expect(subscribers('focusListeners')).toBe(0);
  });
});

describe('useEditorSize', () => {
  function Editor({ renders }: { renders: () => void }) {
    renders();
    const { width, height, resizable } = useEditorSize();
    return (
      <Text>{`${width} × ${height} ${resizable ? 'grip' : 'fixed'}`}</Text>
    );
  }

  it('reads the editor, once per change', async () => {
    const renders = vi.fn<() => void>();
    await render(<Editor renders={renders} />);
    expect(screen.getByText('800 × 600 fixed')).toBeDefined();
    testEditor.resize({ width: 900, height: 650 });
    expect(screen.getByText('900 × 650 fixed')).toBeDefined();
    testEditor.resize({ resizable: true });
    expect(screen.getByText('900 × 650 grip')).toBeDefined();
    testEditor.resize({ width: 900 });
    expect(renders).toHaveBeenCalledTimes(3);
  });

  it('serves several components and unsubscribes on unmount', async () => {
    const first = await render(<Editor renders={() => {}} />);
    const second = await render(<Editor renders={() => {}} />);
    expect(subscribers('editorListeners')).toBe(2);
    testEditor.resize({ width: 1000 });
    expect(screen.getAllByText('1000 × 600 fixed')).toHaveLength(2);
    await first.unmount();
    await second.unmount();
    expect(subscribers('editorListeners')).toBe(0);
  });
});

describe('useHostState', () => {
  function Host({ renders }: { renders: () => void }) {
    renders();
    const host = useHostState();
    return (
      <Text>{`${host.hostName} ${host.transport?.playing ? '▶' : '■'}`}</Text>
    );
  }

  it('reads the host and follows it', async () => {
    const renders = vi.fn<() => void>();
    testHost.set({ hostName: 'Before' });
    await render(<Host renders={renders} />);
    expect(screen.getByText('Before ■')).toBeDefined();
    testHost.set({ hostName: 'After' });
    expect(screen.getByText('After ■')).toBeDefined();
    expect(renders).toHaveBeenCalledTimes(2);
  });

  it('does not re-render for what is not the host', async () => {
    const renders = vi.fn<() => void>();
    await render(<Host renders={renders} />);
    testEditor.setVisible(false);
    testEditor.resize({ width: 900 });
    expect(renders).toHaveBeenCalledOnce();
  });

  it('unsubscribes on unmount', async () => {
    const first = await render(<Host renders={() => {}} />);
    const second = await render(<Host renders={() => {}} />);
    expect(subscribers('hostListeners')).toBe(2);
    await first.unmount();
    await second.unmount();
    expect(subscribers('hostListeners')).toBe(0);
  });
});

describe('usePresetSelection', () => {
  function Selection({ renders }: { renders: () => void }) {
    renders();
    const { factoryId, modified } = usePresetSelection(presets);
    return <Text>{`${factoryId ?? 'custom'}${modified ? ' *' : ''}`}</Text>;
  }

  it('follows the selected factory preset and its modification', async () => {
    const renders = vi.fn<() => void>();
    await render(<Selection renders={renders} />);
    expect(screen.getByText('custom')).toBeDefined();
    await act(() => presets.factory.load('warm'));
    expect(screen.getByText('warm')).toBeDefined();
    await act(() => state.historyCounter.set(7));
    expect(screen.getByText('warm *')).toBeDefined();
    await act(() => presets.factory.load('bright'));
    expect(screen.getByText('bright')).toBeDefined();
    expect(renders).toHaveBeenCalledTimes(4);
  });

  it('returns the snapshot the module does', async () => {
    const seen = vi.fn<(selection: unknown) => void>();
    function Probe() {
      seen(usePresetSelection(presets));
      return null;
    }
    await act(() => presets.factory.load('warm'));
    await render(<Probe />);
    expect(seen).toHaveBeenLastCalledWith(presets.getSnapshot());
    expect(seen.mock.calls.at(-1)![0]).toBe(presets.getSnapshot());
  });
});

describe('useNativeStream', () => {
  function Level({ renders }: { renders: () => void }) {
    renders();
    const level = useNativeStream(streams.level);
    return <Text>{level === undefined ? 'silent' : `level ${level}`}</Text>;
  }

  it('is undefined until native code publishes, then the latest value', async () => {
    const renders = vi.fn<() => void>();
    await render(<Level renders={renders} />);
    expect(screen.getByText('silent')).toBeDefined();
    publishStream('level', 0.5);
    expect(screen.getByText('level 0.5')).toBeDefined();
    publishStream('level', 0.75);
    expect(screen.getByText('level 0.75')).toBeDefined();
    expect(renders).toHaveBeenCalledTimes(3);
  });

  it('starts with the value published last when the UI opens later', async () => {
    publishStream('level', 0.25);
    await render(<Level renders={() => {}} />);
    expect(screen.getByText('level 0.25')).toBeDefined();
  });

  it('does not re-render for a value it already shows', async () => {
    const renders = vi.fn<() => void>();
    await render(<Level renders={renders} />);
    publishStream('level', 0.5);
    publishStream('level', 0.5);
    expect(renders).toHaveBeenCalledTimes(2);
  });

  it('serves several components and unsubscribes on unmount', async () => {
    const first = await render(<Level renders={() => {}} />);
    const second = await render(<Level renders={() => {}} />);
    expect(streamSubscribers('level')).toBe(2);
    publishStream('level', 1);
    expect(screen.getAllByText('level 1')).toHaveLength(2);
    await first.unmount();
    expect(streamSubscribers('level')).toBe(1);
    await second.unmount();
    expect(streamSubscribers('level')).toBe(0);
  });
});

describe('subscriptions follow the source, not the render', () => {
  /** A source that counts how often it is subscribed and unsubscribed. */
  function counted(initial: number) {
    let value = initial;
    const listeners = new Set<(value: number) => void>();
    const calls = { subscribed: 0, unsubscribed: 0 };
    return {
      calls,
      set(next: number) {
        value = next;
        listeners.forEach((listener) => listener(value));
      },
      source: {
        get: () => value,
        subscribe(listener: (value: number) => void) {
          calls.subscribed++;
          listeners.add(listener);
          return () => {
            calls.unsubscribed++;
            listeners.delete(listener);
          };
        },
      },
    };
  }

  it.each([
    ['useParameter', useParameter],
    ['useStateValue', useStateValue],
    ['useNativeStream', useNativeStream],
  ])(
    '%s subscribes once however often the component renders',
    async (_name, hook) => {
      const store = counted(1);
      function Value() {
        return <Text>{`value ${hook(store.source as never)}`}</Text>;
      }
      const view = await render(<Value />);
      for (const next of [2, 3, 4]) {
        await act(() => store.set(next));
        expect(screen.getByText(`value ${next}`)).toBeDefined();
      }
      expect(store.calls).toEqual({ subscribed: 1, unsubscribed: 0 });
      await view.unmount();
      expect(store.calls).toEqual({ subscribed: 1, unsubscribed: 1 });
    },
  );

  it('moves to another source when the component is given one', async () => {
    const a = counted(1);
    const b = counted(10);
    function Value({ source }: { source: typeof a.source }) {
      return <Text>{`value ${useParameter(source)}`}</Text>;
    }
    const view = await render(<Value source={a.source} />);
    expect(screen.getByText('value 1')).toBeDefined();
    await view.rerender(<Value source={b.source} />);
    expect(screen.getByText('value 10')).toBeDefined();
    expect(a.calls).toEqual({ subscribed: 1, unsubscribed: 1 });
    expect(b.calls).toEqual({ subscribed: 1, unsubscribed: 0 });
    await act(() => b.set(11));
    expect(screen.getByText('value 11')).toBeDefined();
  });
});
