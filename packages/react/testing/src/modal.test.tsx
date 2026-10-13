import { Modal, Portal, Text, View } from '@soundor/react';
import { type TestNode } from '@soundor/test-runtime';
import {
  render,
  screen,
  act as reactAct,
  fireEvent as fire,
  userEvent,
} from '@soundor/testing-library/react';
import { getTestRuntime } from '@soundor/vitest';
import { useState, type ReactNode } from 'react';
import { root, overlayRoot } from 'soundor:ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  user = userEvent.setup();
});
const focusedNode = () => getTestRuntime().focusedNode();
const pressKey = (key: string, init: Record<string, unknown> = {}) =>
  fire.keyDown(focusedNode() ?? root, { key, ...init });

let mounted: Awaited<ReturnType<typeof render>> | null = null;

async function show(element: ReactNode) {
  if (mounted) await mounted.rerender(element);
  else mounted = await render(element, { container: root });
}

afterEach(() => {
  mounted = null;
  nodes.clear();
});

const nodes = new Map<string, TestNode>();

function Field({ name }: { name: string }) {
  return (
    <View
      focusable
      ref={(node) => {
        if (node) nodes.set(name, node as unknown as TestNode);
      }}
    />
  );
}

const node = (name: string) => nodes.get(name)!;

function focusedName(): string | null {
  for (const [name, value] of nodes) if (value === focusedNode()) return name;
  return focusedNode() === null ? null : '?';
}

const tab = async (shiftKey = false) => {
  await user.tab({ shift: shiftKey });
  return focusedName();
};

/** The overlay's entries: [backdrop, content] for a modal. */
const entries = () => overlayRoot.children as unknown as TestNode[];
const layers = (entry: TestNode) => {
  const [backdrop, content] = entry.children as unknown as TestNode[];
  return { backdrop: backdrop!, content: content! };
};

describe('Modal', () => {
  it('is an overlay entry: a full backdrop, then content letting it through', async () => {
    await show(
      <View style={{ zIndex: 2147483647 }}>
        <Modal backdropStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <Text>dialog</Text>
        </Modal>
      </View>,
    );
    expect(entries()).toHaveLength(1);
    const { backdrop, content } = layers(entries()[0]!);
    const fill = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 };
    expect(backdrop.style).toEqual({
      ...fill,
      backgroundColor: 'rgba(0,0,0,0.5)',
    });
    // The backdrop takes the pointer; the content passes it where it is empty.
    expect(backdrop.style['pointerEvents']).toBeUndefined();
    expect(content.style).toEqual({ ...fill, pointerEvents: 'box-none' });
    expect(content.children[0]!.text).toBe('dialog');
  });

  it('shows while visible, and only the caller hides it', async () => {
    const onRequestClose = vi.fn<() => void>();
    const app = (visible?: boolean) => (
      <Modal
        accessibilityLabel="Example"
        visible={visible}
        onRequestClose={onRequestClose}
      >
        <Field name="a" />
      </Modal>
    );
    await show(app(false));
    expect(entries()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    await show(app(undefined));
    expect(entries()).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Example' })).toBeDefined();
    await user.keyboard('{Escape}');
    expect(onRequestClose).toHaveBeenCalledOnce();
    expect(entries()).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Example' })).toBeDefined();
    await show(app(false));
    expect(entries()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a backdrop press asks to close only when allowed, and never a content press', async () => {
    const onRequestClose = vi.fn<() => void>();
    const app = (dismissOnBackdropPress: boolean) => (
      <Modal
        onRequestClose={onRequestClose}
        dismissOnBackdropPress={dismissOnBackdropPress}
      >
        <View />
      </Modal>
    );
    await show(app(false));
    let { backdrop, content } = layers(entries()[0]!);
    fire(backdrop, 'click');
    expect(onRequestClose).not.toHaveBeenCalled();

    await show(app(true));
    ({ backdrop, content } = layers(entries()[0]!));
    fire(content.children[0] as unknown as TestNode, 'click');
    fire(content, 'click');
    expect(onRequestClose).not.toHaveBeenCalled();
    fire(backdrop, 'click');
    expect(onRequestClose).toHaveBeenCalledOnce();
    // Pressing the backdrop does not take focus from the dialog.
    expect(fire(backdrop, 'pointerdown').defaultPrevented).toBe(true);
  });

  it('focuses its first control, traps Tab, and gives focus back', async () => {
    const app = (open: boolean) => (
      <View>
        <Field name="button" />
        {open && (
          <Modal>
            <Text>Title</Text>
            <Field name="ok" />
            <Field name="cancel" />
          </Modal>
        )}
        <Field name="after" />
      </View>
    );
    await show(app(false));
    node('button').focus();
    await show(app(true));
    expect(focusedName()).toBe('ok');
    expect([await tab(), await tab(), await tab(true)]).toEqual([
      'cancel',
      'ok',
      'cancel',
    ]);
    node('after').focus();
    expect(focusedName()).toBe('cancel');
    await show(app(false));
    expect(focusedName()).toBe('button');
  });

  it('with nothing to focus, keeps keys from the background', async () => {
    const pressed = vi.fn<() => void>();
    const app = (open: boolean) => (
      <View>
        <View
          focusable
          onKeyDown={pressed}
          ref={(value) => {
            if (value) nodes.set('button', value as unknown as TestNode);
          }}
        />
        {open && (
          <Modal>
            <Text>Busy</Text>
          </Modal>
        )}
      </View>
    );
    await show(app(false));
    node('button').focus();
    await show(app(true));
    expect(focusedNode()).toBeNull();
    pressKey('Enter');
    expect(await tab()).toBeNull();
    expect(pressed).not.toHaveBeenCalled();
    await show(app(false));
    expect(focusedName()).toBe('button');
  });

  it('Escape asks the topmost modal, wherever focus is', async () => {
    const closed: string[] = [];
    await show(
      <View>
        <Modal onRequestClose={() => closed.push('A')}>
          <Field name="a" />
          <Modal onRequestClose={() => closed.push('B')}>
            <Text>B</Text>
          </Modal>
        </Modal>
      </View>,
    );
    const escape = pressKey('Escape');
    expect(escape.defaultPrevented).toBe(true);
    // With modifiers, or already handled, it is not a request.
    pressKey('Escape', { shiftKey: true });
    expect(closed).toEqual(['B']);
  });

  it('nests: the newest is on top, owns the trap, and restores into the previous one', async () => {
    function App({ a, b }: { a: boolean; b: boolean }) {
      return (
        <View>
          <Field name="button" />
          {a && (
            <Modal>
              <Field name="A.ok" />
              <Field name="A.open" />
              {b && (
                <Modal>
                  <Field name="B.ok" />
                  <Field name="B.cancel" />
                </Modal>
              )}
            </Modal>
          )}
        </View>
      );
    }
    await show(<App a={false} b={false} />);
    node('button').focus();
    await show(<App a b={false} />);
    expect(await tab()).toBe('A.open');
    await show(<App a b />);
    expect(entries()).toHaveLength(2);
    expect(focusedName()).toBe('B.ok');
    expect([await tab(), await tab()]).toEqual(['B.cancel', 'B.ok']);
    await show(<App a b={false} />);
    expect(entries()).toHaveLength(1);
    expect(focusedName()).toBe('A.open');
    await show(<App a={false} b={false} />);
    expect(focusedName()).toBe('button');
    expect(entries()).toHaveLength(0);
  });

  it('a portal from inside a modal stacks above it and belongs to its focus trap', async () => {
    function App({ menu }: { menu: boolean }) {
      return (
        <View>
          <Field name="background" />
          <Portal>
            <Text>tooltip</Text>
          </Portal>
          <Modal>
            <Field name="trigger" />
            {menu && (
              <Portal>
                <Field name="item" />
              </Portal>
            )}
          </Modal>
        </View>
      );
    }
    await show(<App menu={false} />);
    await show(<App menu />);
    const [tooltip, modal, dropdown] = entries();
    expect(tooltip!.children[0]!.text).toBe('tooltip');
    expect(layers(modal!).content.children[0]).toBe(node('trigger'));
    expect(dropdown!.children[0]).toBe(node('item'));
    expect([await tab(), await tab(), await tab()]).toEqual([
      'item',
      'trigger',
      'item',
    ]);
  });

  it('a modal opened from an overlay stacks above it', async () => {
    await show(
      <View>
        <Portal>
          <Text>dropdown</Text>
          <Modal>
            <Field name="confirm" />
          </Modal>
        </Portal>
      </View>,
    );
    const [dropdown, modal] = entries();
    expect(dropdown!.children[0]!.text).toBe('dropdown');
    expect(layers(modal!).content.children[0]).toBe(node('confirm'));
    expect(focusedName()).toBe('confirm');
  });

  it('opens and closes repeatedly without leftovers', async () => {
    function App() {
      const [open, setOpen] = useState(false);
      return (
        <View>
          <View
            focusable
            onClick={() => setOpen(true)}
            ref={(value) => {
              if (value) nodes.set('open', value as unknown as TestNode);
            }}
          />
          <Field name="other" />
          {open && (
            <Modal onRequestClose={() => setOpen(false)}>
              <Field name="inside" />
            </Modal>
          )}
        </View>
      );
    }
    await show(<App />);
    node('open').focus();
    for (let i = 0; i < 4; ++i) {
      await reactAct(() => fire(node('open'), 'click'));
      expect(focusedName()).toBe('inside');
      await reactAct(() => pressKey('Escape'));
      expect(entries()).toHaveLength(0);
      expect(focusedName()).toBe('open');
    }
    // No trap, no request handler left behind.
    expect([await tab(), await tab()]).toEqual(['other', 'open']);
    expect(pressKey('Escape').defaultPrevented).toBe(false);
  });
});
