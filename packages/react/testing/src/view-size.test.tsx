import { Modal, Pressable, Text, useViewSize, View } from '@soundor/react';
import { getTestRuntime, type TestRuntime } from '@soundor/test-runtime';
import {
  render,
  screen,
  testView,
  userEvent,
} from '@soundor/testing-library/react';
import { useState } from 'react';
import { viewSize } from 'soundor:ui';
import { describe, expect, it, vi } from 'vitest';

/** Counts its renders, and shows the size it sees. */
function Size({ renders }: { renders: () => void }) {
  renders();
  const { width, height, scale } = useViewSize();
  return <Text>{`${width} × ${height} @${scale}`}</Text>;
}

/** The responsive layout the docs show: a row, stacked below 640. */
function Controls() {
  const { width } = useViewSize();
  const compact = width < 640;
  return (
    <View
      accessibilityLabel={compact ? 'stacked' : 'row'}
      style={{ flex: 1, flexDirection: compact ? 'column' : 'row' }}
    >
      <Text>Gain</Text>
      <Text>Tone</Text>
    </View>
  );
}

function subscribers(): number {
  return (
    getTestRuntime() as unknown as {
      sizeListeners: { size: number };
    }
  ).sizeListeners.size;
}

describe('useViewSize', () => {
  it("starts at the view's size and re-renders when it changes", async () => {
    const renders = vi.fn<() => void>();
    await render(<Size renders={renders} />);
    expect(screen.getByText('800 × 600 @1')).toBeDefined();
    expect(renders).toHaveBeenCalledOnce();

    await testView.resize({ width: 1000 });
    expect(screen.getByText('1000 × 600 @1')).toBeDefined();
    await testView.resize({ height: 700 });
    expect(screen.getByText('1000 × 700 @1')).toBeDefined();
    await testView.resize({ scale: 2 });
    expect(screen.getByText('1000 × 700 @2')).toBeDefined();
    expect(renders).toHaveBeenCalledTimes(4);
  });

  it('does not re-render for the same size', async () => {
    const renders = vi.fn<() => void>();
    await render(<Size renders={renders} />);
    await testView.resize({ width: 800, height: 600, scale: 1 });
    await testView.resize({});
    expect(renders).toHaveBeenCalledOnce();
  });

  it('returns the snapshot viewSize() does', async () => {
    const seen = vi.fn<(size: unknown) => void>();
    function Probe({ onSize }: { onSize: (size: unknown) => void }) {
      onSize(useViewSize());
      return null;
    }
    await render(<Probe onSize={seen} />);
    expect(seen).toHaveBeenLastCalledWith(viewSize());
    expect(seen.mock.lastCall![0]).toBe(viewSize());
  });

  it('keeps every subscriber up to date, and lets go of them on unmount', async () => {
    const before = subscribers();
    function Two() {
      const [shown, setShown] = useState(true);
      return (
        <View>
          <Size renders={() => {}} />
          {shown ? <Size renders={() => {}} /> : null}
          <Pressable onPress={() => setShown(false)}>
            <Text>Hide</Text>
          </Pressable>
        </View>
      );
    }
    const { unmount } = await render(<Two />);
    expect(subscribers()).toBe(before + 2);
    await testView.resize({ width: 500 });
    expect(screen.getAllByText('500 × 600 @1')).toHaveLength(2);

    await userEvent.setup().click(screen.getByText('Hide'));
    expect(subscribers()).toBe(before + 1);
    await testView.resize({ width: 520 });
    expect(screen.getAllByText('520 × 600 @1')).toHaveLength(1);
    await unmount();
    expect(subscribers()).toBe(before);
  });

  it('switches the layout as the view crosses a breakpoint, and back', async () => {
    await render(<Controls />);
    expect(screen.getByLabelText('row')).toBeDefined();
    // Rapid resizing, as a dragged window edge makes.
    for (const width of [760, 700, 650, 641, 640, 639, 600, 500])
      await testView.resize({ width });
    expect(screen.getByLabelText('stacked')).toBeDefined();
    expect(screen.getByText('Gain')).toBeDefined();
    await testView.resize({ width: 900 });
    expect(screen.getByLabelText('row')).toBeDefined();
  });

  it('keeps an open modal and the focus through a resize', async () => {
    function WithModal() {
      const { width } = useViewSize();
      return (
        <Modal visible>
          <Pressable accessibilityLabel={`OK at ${width}`}>
            <Text>OK</Text>
          </Pressable>
        </Modal>
      );
    }
    await render(<WithModal />);
    const user = userEvent.setup();
    await user.tab();
    expect(getTestRuntime().focusedNode()).toBe(
      screen.getByRole('button', { name: 'OK at 800' }),
    );
    await testView.resize({ width: 500 });
    expect(getTestRuntime().focusedNode()).toBe(
      screen.getByRole('button', { name: 'OK at 500' }),
    );
  });

  it("follows the runtime the test gives it, not a previous test's", () => {
    // A fresh runtime per test (as a reload makes a fresh one): its own size.
    const runtime: TestRuntime = getTestRuntime();
    expect(runtime.viewSize()).toEqual({ width: 800, height: 600, scale: 1 });
  });
});
