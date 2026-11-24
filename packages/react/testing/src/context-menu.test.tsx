import { Pressable, Text, View } from '@soundor/react';
import { getTestRuntime, type TestNode } from '@soundor/test-runtime';
import { advanceTime, render } from '@soundor/testing-library/react';
import type { ReactNode } from 'react';
import { root, type PointerEvent } from 'soundor:ui';
import { afterEach, describe, expect, it } from 'vitest';

// Context menu requests and long presses: every way of asking is the same
// `contextmenu` event, whose listeners never advertise an action.

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

const runtime = () => getTestRuntime();
const describeEvent = (event: PointerEvent) =>
  `${event.type}:${event.pointerType}:${event.button}`;

async function hold(node: TestNode, pointerType = 'touch', ms = 500) {
  runtime().pointerDown(node, { pointerType, pointerId: 7 });
  await advanceTime(ms);
  runtime().pointerUp(node, { pointerId: 7 });
}

afterEach(() => {
  mounted = null;
});

describe('context menu requests', () => {
  it('reach an ordinary view from the pointer, the keyboard and a touch hold', async () => {
    const log: string[] = [];
    await show(
      <View focusable onContextMenu={(event) => log.push(describeEvent(event))}>
        <Text>Track</Text>
      </View>,
    );
    const view = child(0);
    runtime().pointerDown(view, { button: 2 });
    runtime().pointerUp(view, { button: 2 });
    view.focus();
    runtime().pressKey('F10', { shiftKey: true });
    runtime().releaseKey('F10', { shiftKey: true });
    runtime().pressKey('ContextMenu');
    runtime().pressKey('ContextMenu', { repeat: true });
    runtime().releaseKey('ContextMenu');
    // Not shortcuts: F10 alone, or with Control.
    runtime().pressKey('F10');
    runtime().pressKey('F10', { shiftKey: true, ctrlKey: true });
    await hold(view);
    expect(log).toEqual([
      'contextmenu:mouse:2',
      'contextmenu::-1',
      'contextmenu::-1',
      'contextmenu:touch:0',
    ]);
  });

  it('capture, target and bubble through React and soundor:ui listeners alike', async () => {
    const log: string[] = [];
    await show(
      <View
        onContextMenuCapture={(event) =>
          log.push(`capture ${event.target === (child(0, 0) as unknown)}`)
        }
        onContextMenu={(event) => {
          log.push(`bubble ${event.currentTarget === (child(0) as unknown)}`);
          // Stopping propagation does not cancel a default.
          event.stopPropagation();
        }}
      >
        <View onLongPress={() => log.push('target longpress')} />
      </View>,
    );
    child(0, 0).addEventListener('contextmenu', () => log.push('target'));
    await hold(child(0, 0));
    expect(log).toEqual([
      'target longpress',
      'capture true',
      'target',
      'bubble true',
    ]);
  });

  it('follow the longpress, unless it is canceled', async () => {
    const log: string[] = [];
    let cancel = false;
    await show(
      <Pressable
        onPress={() => log.push('press')}
        onLongPress={(event) => {
          log.push(describeEvent(event));
          if (cancel) event.preventDefault();
        }}
        onContextMenu={(event) => {
          log.push(describeEvent(event));
          event.preventDefault();
        }}
      />,
    );
    const button = child(0);
    await hold(button);
    expect(log).toEqual(['longpress:touch:0', 'contextmenu:touch:0']);
    log.length = 0;
    cancel = true;
    await hold(button);
    expect(log).toEqual(['longpress:touch:0']);
    // Right-click and the keyboard are not long presses.
    log.length = 0;
    runtime().pointerDown(button, { button: 2 });
    runtime().pointerUp(button, { button: 2 });
    button.focus();
    runtime().pressKey('ContextMenu');
    expect(log).toEqual(['contextmenu:mouse:2', 'contextmenu::-1']);
  });

  it('come from a touch hold with no longpress listener, and not from a mouse one', async () => {
    const log: string[] = [];
    await show(
      <View
        onClick={() => log.push('click')}
        onContextMenu={(event) => log.push(describeEvent(event))}
      />,
    );
    const view = child(0);
    await hold(view, 'mouse');
    expect(log).toEqual(['click']); // an unhandled hold still clicks
    log.length = 0;
    await hold(view);
    expect(log).toEqual(['contextmenu:touch:0', 'click']);
  });

  it('a handled hold does not click; moving, scrolling or leaving ends it', async () => {
    const log: string[] = [];
    await show(
      <View style={{ height: 50, overflow: 'scroll' }}>
        <View
          style={{ height: 200 }}
          onClick={() => log.push('click')}
          onContextMenu={(event) => {
            log.push('menu');
            event.preventDefault();
          }}
        />
      </View>,
    );
    const scroller = child(0);
    const view = child(0, 0);
    await hold(view);
    expect(log).toEqual(['menu']);

    log.length = 0;
    runtime().pointerDown(view, { pointerType: 'touch', pointerId: 7 });
    runtime().pointerMove(view, { pointerId: 7, pageX: 20 });
    await advanceTime(600);
    runtime().pointerCancel(7);
    runtime().pointerDown(view, { pointerType: 'touch', pointerId: 7 });
    runtime().fire(scroller, 'scroll');
    await advanceTime(600);
    runtime().pointerUp(view, { pointerId: 7 });
    expect(log).toEqual(['click']);

    log.length = 0;
    runtime().pointerDown(view, { pointerType: 'touch', pointerId: 7 });
    await show(<View style={{ height: 50, overflow: 'scroll' }} />);
    await advanceTime(600);
    expect(log).toEqual([]);
    runtime().pointerCancel(7);
  });

  it('a canceled keydown makes no request', async () => {
    const log: string[] = [];
    await show(
      <View
        focusable
        onKeyDown={(event) => {
          if (event.key === 'F10' && event.shiftKey) event.preventDefault();
        }}
        onContextMenu={(event) => log.push(describeEvent(event))}
      />,
    );
    child(0).focus();
    runtime().pressKey('F10', { shiftKey: true });
    runtime().pressKey('ContextMenu');
    expect(log).toEqual(['contextmenu::-1']);
  });
});

describe('the showContextMenu accessibility action', () => {
  it('is offered only where declared, never from listeners', async () => {
    await show(
      <View onContextMenuCapture={() => {}}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Gain"
          accessibilityValue={{ min: 0, max: 1, now: 0.5 }}
          accessibilityActions={[{ name: 'increment' }]}
          onContextMenu={() => {}}
        />
      </View>,
    );
    expect(child(0).accessibility.actions).toBeUndefined();
    expect(child(0, 0).accessibility.actions).toEqual([{ name: 'increment' }]);
    expect(() =>
      runtime().accessibilityAction(child(0, 0), 'showContextMenu'),
    ).toThrow(/does not offer/);

    await show(
      <View onContextMenuCapture={() => {}}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Gain"
          accessibilityValue={{ min: 0, max: 1, now: 0.5 }}
          accessibilityActions={[
            { name: 'increment' },
            { name: 'showContextMenu' },
          ]}
          onContextMenu={() => {}}
        />
      </View>,
    );
    expect(child(0, 0).accessibility).toMatchObject({
      role: 'adjustable',
      label: 'Gain',
      value: { min: 0, max: 1, now: 0.5 },
      actions: [{ name: 'increment' }, { name: 'showContextMenu' }],
    });
  });

  it('requests a menu, unless the action is canceled', async () => {
    const log: string[] = [];
    let replace = false;
    await show(
      <View
        accessibilityLabel="Track"
        accessibilityActions={[
          { name: 'showContextMenu' },
          { name: 'longpress' },
        ]}
        onAccessibilityAction={(event) => {
          log.push(`action:${event.actionName}`);
          if (replace && event.actionName === 'showContextMenu')
            event.preventDefault();
        }}
        onLongPress={(event) => log.push(describeEvent(event))}
        onContextMenu={(event) => log.push(describeEvent(event))}
      />,
    );
    const view = child(0);
    runtime().accessibilityAction(view, 'showContextMenu');
    expect(log).toEqual(['action:showContextMenu', 'contextmenu::-1']);
    log.length = 0;
    replace = true;
    runtime().accessibilityAction(view, 'showContextMenu');
    // Its own longpress is a different request: no menu follows.
    runtime().accessibilityAction(view, 'longpress');
    expect(log).toEqual([
      'action:showContextMenu',
      'action:longpress',
      'longpress::-1',
    ]);
    // Physical input is not an accessibility action.
    log.length = 0;
    runtime().pointerDown(view, { button: 2 });
    runtime().pointerUp(view, { button: 2 });
    expect(log).toEqual(['contextmenu:mouse:2']);
  });
});
