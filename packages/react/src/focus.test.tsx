import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createRoot,
  FocusScope,
  flushSync,
  Pressable,
  Text,
  View,
} from './index';
import {
  focusedNode,
  pressKey,
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

afterEach(() => {
  if (mounted) flushSync(() => mounted!.unmount());
  mounted = null;
  reset();
});

/** The focusable nodes by name: `<Field name="a" />`. */
const nodes = new Map<string, FakeNode>();

function Field({ name, hidden = false }: { name: string; hidden?: boolean }) {
  return (
    <View
      focusable
      style={hidden ? { display: 'none' } : undefined}
      ref={(node) => {
        if (node) nodes.set(name, node as unknown as FakeNode);
      }}
    />
  );
}

const node = (name: string): FakeNode => nodes.get(name)!;

/** The name of the focused node, or null. */
function focusedName(): string | null {
  const current = focusedNode();
  for (const [name, value] of nodes) if (value === current) return name;
  return current === null ? null : '?';
}

function tab(shiftKey = false): string | null {
  pressKey('Tab', { shiftKey });
  return focusedName();
}

describe('FocusScope', () => {
  it('adds no node: the layout is that of its children', () => {
    show(
      <View style={{ flexDirection: 'row' }}>
        <Text>a</Text>
        <Text>b</Text>
      </View>,
    );
    const plain = print();
    show(
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

  it('leaves Tab to the runtime unless it traps', () => {
    show(
      <View>
        <Field name="a" />
        <FocusScope>
          <Field name="b" />
        </FocusScope>
        <Field name="c" />
      </View>,
    );
    expect([tab(), tab(), tab(), tab()]).toEqual(['a', 'b', 'c', 'a']);
  });

  it('cycles Tab and Shift+Tab through a trapping scope, wrapping', () => {
    show(
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
    expect(tab()).toBe('b');
    expect([tab(), tab(), tab()]).toEqual(['c', 'd', 'b']);
    expect([tab(true), tab(true), tab(true)]).toEqual(['d', 'c', 'b']);
    node('b').blur();
    expect(tab(true)).toBe('d');
    // The runtime's own Tab did not also run.
    const event = pressKey('Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(focusedName()).toBe('b');
  });

  it('skips hidden and unfocusable nodes', () => {
    show(
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
    expect([tab(), tab(), tab()]).toEqual(['a', 'b', 'a']);
  });

  it('keeps Tab inside even with nothing focusable in it', () => {
    show(
      <View>
        <Field name="a" />
        <FocusScope trapped>
          <View />
        </FocusScope>
      </View>,
    );
    expect(tab()).toBeNull();
    // Focus cannot leave for the background either.
    node('a').focus();
    expect(focusedNode()).toBeNull();
    expect(tab()).toBeNull();
  });

  it('takes back focus moved outside it', () => {
    const seen: string[] = [];
    show(
      <View>
        <View
          focusable
          onFocus={() => seen.push('outside focus')}
          ref={(value) => {
            if (value) nodes.set('outside', value as unknown as FakeNode);
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

  it('a trap that starts with focus outside it drops that focus', () => {
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
    show(app(false));
    node('a').focus();
    show(app(true));
    // Keys no longer reach the background; Tab enters the trap.
    expect(focusedNode()).toBeNull();
    expect(tab()).toBe('b');
  });

  it('autoFocus focuses the first focusable node once it is in the view', () => {
    show(
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

  it('autoFocus leaves focus already inside alone, and survives no candidates', () => {
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
    show(<App open={false} />);
    node('b').focus();
    show(<App open />);
    expect(focusedName()).toBe('b');
  });

  it('restores focus on unmount, unless its node is gone', () => {
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
    show(<App open={false} />);
    node('a').focus();
    show(<App open />);
    expect(focusedName()).toBe('inside');
    show(<App open={false} />);
    expect(focusedName()).toBe('a');

    show(<App open />);
    show(<App open withA={false} />);
    show(<App open={false} withA={false} />);
    // Not some other node instead.
    expect(focusedNode()).toBeNull();
  });

  it('restores through nested scopes, each to where it was opened', () => {
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
    show(<App a={false} b={false} />);
    node('button').focus();
    show(<App a b={false} />);
    expect(focusedName()).toBe('A.control');
    expect(tab()).toBe('A.other');
    show(<App a b />);
    expect(focusedName()).toBe('B.control');
    // The innermost trap wins.
    expect([tab(), tab()]).toEqual(['B.other', 'B.control']);
    show(<App a b={false} />);
    expect(focusedName()).toBe('A.other');
    expect([tab(), tab()]).toEqual(['A.control', 'A.other']);
    show(<App a={false} b={false} />);
    expect(focusedName()).toBe('button');
    // Both traps are gone.
    expect(tab()).toBe('button');
  });

  it('nested traps mounted together: the inner one wins; closing both restores once', () => {
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
    show(<App open={false} />);
    node('button').focus();
    show(<App open />);
    expect(focusedName()).toBe('inner');
    expect([tab(), tab()]).toEqual(['inner2', 'inner']);
    show(<App open={false} />);
    expect(focusedName()).toBe('button');
  });

  it('mounts and unmounts repeatedly without leftovers', () => {
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
    show(<App open={false} />);
    node('a').focus();
    for (let i = 0; i < 5; ++i) {
      show(<App open />);
      expect(focusedName()).toBe('inside');
      show(<App open={false} />);
      expect(focusedName()).toBe('a');
    }
    expect([tab(), tab(), tab()]).toEqual(['b', 'a', 'b']);
  });

  it('counts a Pressable as a member', () => {
    function App() {
      const [count] = useState(0);
      return (
        <FocusScope trapped autoFocus>
          <Pressable
            ref={(value) => {
              if (value) nodes.set('pressable', value as unknown as FakeNode);
            }}
          >
            <Text>{count}</Text>
          </Pressable>
        </FocusScope>
      );
    }
    show(<App />);
    expect(focusedName()).toBe('pressable');
    expect(root.children.length).toBe(1);
  });
});
