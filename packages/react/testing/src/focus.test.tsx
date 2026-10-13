import { FocusScope, Pressable, Text, View } from '@soundor/react';
import { print as printNode, type TestNode } from '@soundor/test-runtime';
import {
  render,
  fireEvent as fire,
  userEvent,
} from '@soundor/testing-library/react';
import { getTestRuntime } from '@soundor/vitest';
import { useState, type ReactNode } from 'react';
import { root } from 'soundor:ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  user = userEvent.setup();
});
const print = (node = root) => printNode(node as unknown as TestNode);
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

/** The focusable nodes by name: `<Field name="a" />`. */
const nodes = new Map<string, TestNode>();

function Field({ name, hidden = false }: { name: string; hidden?: boolean }) {
  return (
    <View
      focusable
      accessibilityLabel={name}
      style={hidden ? { display: 'none' } : undefined}
      ref={(node) => {
        if (node) nodes.set(name, node as unknown as TestNode);
      }}
    />
  );
}

const node = (name: string): TestNode => nodes.get(name)!;

/** The name of the focused node, or null. */
function focusedName(): string | null {
  const current = focusedNode();
  for (const [name, value] of nodes) if (value === current) return name;
  return current === null ? null : '?';
}

async function tab(shiftKey = false): Promise<string | null> {
  await user.tab({ shift: shiftKey });
  return focusedName();
}

describe('FocusScope', () => {
  it('adds no node: the layout is that of its children', async () => {
    await show(
      <View style={{ flexDirection: 'row' }}>
        <Text>a</Text>
        <Text>b</Text>
      </View>,
    );
    const plain = print();
    await show(
      <View style={{ flexDirection: 'row' }}>
        <FocusScope trapped autoFocus restoreFocus>
          <Text>a</Text>
        </FocusScope>
        <FocusScope>
          <Text>b</Text>
        </FocusScope>
      </View>,
    );
    expect(print()).toBe(plain);
  });

  it('leaves Tab to the runtime unless it traps', async () => {
    await show(
      <View>
        <Field name="a" />
        <FocusScope>
          <Field name="b" />
        </FocusScope>
        <Field name="c" />
      </View>,
    );
    expect([await tab(), await tab(), await tab(), await tab()]).toEqual([
      'a',
      'b',
      'c',
      'a',
    ]);
  });

  it('cycles Tab and Shift+Tab through a trapping scope, wrapping', async () => {
    await show(
      <View>
        <Field name="a" />
        <FocusScope trapped>
          <Field name="b" />
          <View>
            <Field name="c" />
          </View>
          <Field name="d" />
        </FocusScope>
        <Field name="e" />
      </View>,
    );
    // From nowhere, Tab enters at the first member and Shift+Tab the last.
    expect(await tab()).toBe('b');
    expect([await tab(), await tab(), await tab()]).toEqual(['c', 'd', 'b']);
    expect([await tab(true), await tab(true), await tab(true)]).toEqual([
      'd',
      'c',
      'b',
    ]);
    node('b').blur();
    expect(await tab(true)).toBe('d');
    // The runtime's own Tab did not also run.
    const event = pressKey('Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(focusedName()).toBe('b');
  });

  it('skips hidden and unfocusable nodes', async () => {
    await show(
      <FocusScope trapped>
        <Field name="a" />
        <Field name="hidden" hidden />
        <View style={{ display: 'none' }}>
          <Field name="inHidden" />
        </View>
        <View />
        <Field name="b" />
      </FocusScope>,
    );
    expect([await tab(), await tab(), await tab()]).toEqual(['a', 'b', 'a']);
  });

  it('keeps Tab inside even with nothing focusable in it', async () => {
    await show(
      <View>
        <Field name="a" />
        <FocusScope trapped>
          <View />
        </FocusScope>
      </View>,
    );
    expect(await tab()).toBeNull();
    // Focus cannot leave for the background either.
    node('a').focus();
    expect(focusedNode()).toBeNull();
    expect(await tab()).toBeNull();
  });

  it('takes back focus moved outside it', async () => {
    const seen: string[] = [];
    await show(
      <View>
        <View
          focusable
          onFocus={() => seen.push('outside focus')}
          ref={(value) => {
            if (value) nodes.set('outside', value as unknown as TestNode);
          }}
        />
        <FocusScope trapped>
          <Field name="a" />
          <Field name="b" />
        </FocusScope>
      </View>,
    );
    node('outside').focus();
    // Nothing inside had focus yet: the first member gets it.
    expect(focusedName()).toBe('a');
    node('b').focus();
    node('outside').focus();
    expect(focusedName()).toBe('b');
    expect(seen).toEqual([]);
  });

  it('a trap that starts with focus outside it drops that focus', async () => {
    const app = (open: boolean) => (
      <View>
        <Field name="a" />
        {open && (
          <FocusScope trapped>
            <Field name="b" />
          </FocusScope>
        )}
      </View>
    );
    await show(app(false));
    node('a').focus();
    await show(app(true));
    // Keys no longer reach the background; Tab enters the trap.
    expect(focusedNode()).toBeNull();
    expect(await tab()).toBe('b');
  });

  it('autoFocus focuses the first focusable node once it is in the view', async () => {
    await show(
      <View>
        <Field name="a" />
        <FocusScope autoFocus>
          <View />
          <Field name="hidden" hidden />
          <Field name="b" />
          <Field name="c" />
        </FocusScope>
      </View>,
    );
    expect(focusedName()).toBe('b');
  });

  it('autoFocus leaves focus already inside alone, and survives no candidates', async () => {
    function App({ open }: { open: boolean }) {
      return (
        <View>
          <FocusScope>
            <Field name="a" />
            <Field name="b" />
            {open && (
              <FocusScope autoFocus>
                <View />
              </FocusScope>
            )}
          </FocusScope>
        </View>
      );
    }
    await show(<App open={false} />);
    node('b').focus();
    await show(<App open />);
    expect(focusedName()).toBe('b');
  });

  it('restores focus on unmount, unless its node is gone', async () => {
    function App({ open, withA = true }: { open: boolean; withA?: boolean }) {
      return (
        <View>
          {withA && <Field name="a" />}
          <Field name="z" />
          {open && (
            <FocusScope trapped autoFocus restoreFocus>
              <Field name="inside" />
            </FocusScope>
          )}
        </View>
      );
    }
    await show(<App open={false} />);
    node('a').focus();
    await show(<App open />);
    expect(focusedName()).toBe('inside');
    await show(<App open={false} />);
    expect(focusedName()).toBe('a');

    await show(<App open />);
    await show(<App open withA={false} />);
    await show(<App open={false} withA={false} />);
    // Not some other node instead.
    expect(focusedNode()).toBeNull();
  });

  it('restores through nested scopes, each to where it was opened', async () => {
    function Modal({ name, children }: { name: string; children?: ReactNode }) {
      return (
        <FocusScope trapped autoFocus restoreFocus>
          <Field name={`${name}.control`} />
          <Field name={`${name}.other`} />
          {children}
        </FocusScope>
      );
    }
    function App({ a, b }: { a: boolean; b: boolean }) {
      return (
        <View>
          <Field name="button" />
          {a && <Modal name="A">{b && <Modal name="B" />}</Modal>}
        </View>
      );
    }
    await show(<App a={false} b={false} />);
    node('button').focus();
    await show(<App a b={false} />);
    expect(focusedName()).toBe('A.control');
    expect(await tab()).toBe('A.other');
    await show(<App a b />);
    expect(focusedName()).toBe('B.control');
    // The innermost trap wins.
    expect([await tab(), await tab()]).toEqual(['B.other', 'B.control']);
    await show(<App a b={false} />);
    expect(focusedName()).toBe('A.other');
    expect([await tab(), await tab()]).toEqual(['A.control', 'A.other']);
    await show(<App a={false} b={false} />);
    expect(focusedName()).toBe('button');
    // Both traps are gone.
    expect(await tab()).toBe('button');
  });

  it('nested traps mounted together: the inner one wins; closing both restores once', async () => {
    function App({ open }: { open: boolean }) {
      return (
        <View>
          <Field name="button" />
          {open && (
            <FocusScope trapped restoreFocus>
              <Field name="outer" />
              <FocusScope trapped autoFocus restoreFocus>
                <Field name="inner" />
                <Field name="inner2" />
              </FocusScope>
            </FocusScope>
          )}
        </View>
      );
    }
    await show(<App open={false} />);
    node('button').focus();
    await show(<App open />);
    expect(focusedName()).toBe('inner');
    expect([await tab(), await tab()]).toEqual(['inner2', 'inner']);
    await show(<App open={false} />);
    expect(focusedName()).toBe('button');
  });

  it('mounts and unmounts repeatedly without leftovers', async () => {
    function App({ open }: { open: boolean }) {
      return (
        <View>
          <Field name="a" />
          <Field name="b" />
          {open && (
            <FocusScope trapped autoFocus restoreFocus>
              <Field name="inside" />
            </FocusScope>
          )}
        </View>
      );
    }
    await show(<App open={false} />);
    node('a').focus();
    for (let i = 0; i < 5; ++i) {
      await show(<App open />);
      expect(focusedName()).toBe('inside');
      await show(<App open={false} />);
      expect(focusedName()).toBe('a');
    }
    expect([await tab(), await tab(), await tab()]).toEqual(['b', 'a', 'b']);
  });

  it('counts a Pressable as a member', async () => {
    function App() {
      const [count] = useState(0);
      return (
        <FocusScope trapped autoFocus>
          <Pressable
            ref={(value) => {
              if (value) nodes.set('pressable', value as unknown as TestNode);
            }}
          >
            <Text>{count}</Text>
          </Pressable>
        </FocusScope>
      );
    }
    await show(<App />);
    expect(focusedName()).toBe('pressable');
    expect(root.children.length).toBe(1);
  });
});
