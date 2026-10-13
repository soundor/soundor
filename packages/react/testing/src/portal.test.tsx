import { createRoot, flushSync } from '@soundor/react';
import {
  createPortalHost,
  FocusScope,
  Portal,
  ScrollView,
  Text,
  View,
  type PortalHost,
} from '@soundor/react';
import { print as printNode, type TestNode } from '@soundor/test-runtime';
import { render, screen, userEvent } from '@soundor/testing-library/react';
import { getTestRuntime } from '@soundor/vitest';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { root, overlayRoot } from 'soundor:ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  user = userEvent.setup();
});
const print = (node: import('soundor:ui').UiNode | TestNode = root) =>
  printNode(node as unknown as TestNode);
const focusedNode = () => getTestRuntime().focusedNode();

let mounted: Awaited<ReturnType<typeof render>> | null = null;

async function show(element: ReactNode) {
  if (mounted) await mounted.rerender(element);
  else mounted = await render(element, { container: root });
}

afterEach(() => {
  mounted = null;
});

/** The overlay as text, entries without their (fixed) style. */
const overlay = () =>
  print(overlayRoot as unknown as TestNode).replaceAll(
    'view{position:absolute,left:0,top:0,right:0,bottom:0,pointerEvents:box-none}',
    'entry',
  );

const label = (text: string) => <Text>{text}</Text>;

describe('Portal', () => {
  it('renders into an overlay entry, out of clipping and scrolling', async () => {
    await show(
      <View style={{ overflow: 'hidden' }}>
        <ScrollView>
          <Portal>{label('menu')}</Portal>
        </ScrollView>
      </View>,
    );
    expect(print()).toBe('view[view{overflow:hidden}[scroll[view]]]');
    expect(overlay()).toBe('view[entry[text"menu"]]');
  });

  it('treats null and undefined hosts as the overlay', async () => {
    await show(
      <View>
        <Portal host={null}>{label('a')}</Portal>
        <Portal host={undefined}>{label('b')}</Portal>
      </View>,
    );
    expect(overlay()).toBe('view[entry[text"a"] entry[text"b"]]');
  });

  it('keeps React context, state and effects across updates', async () => {
    const Theme = createContext('light');
    const effects: string[] = [];
    function Counter({ step }: { step: number }) {
      const theme = useContext(Theme);
      const [count, setCount] = useState(0);
      useEffect(() => {
        effects.push('mount');
        return () => {
          effects.push('unmount');
        };
      }, []);
      return (
        <View onClick={() => setCount((value) => value + step)}>
          <Text>{`${theme} ${count}`}</Text>
        </View>
      );
    }
    const app = (step: number) => (
      <Theme.Provider value="dark">
        <View>
          <Portal>
            <Counter step={step} />
          </Portal>
        </View>
      </Theme.Provider>
    );
    await show(app(1));

    const button = overlayRoot.children[0]!.children[0]! as unknown as TestNode;
    await user.click(screen.getByText('dark 0'));
    await show(app(10));
    await user.click(screen.getByText('dark 1'));

    expect(overlay()).toBe('view[entry[view[text"dark 11"]]]');
    // The same node, never remounted.
    expect(overlayRoot.children[0]!.children[0]).toBe(button);
    expect(effects).toEqual(['mount']);
  });

  it('stacks entries in the order they open; updates do not move them', async () => {
    const app = (open: string[], text = '') => (
      <View>
        {open.map((name) => (
          <Portal key={name}>{label(name + text)}</Portal>
        ))}
      </View>
    );
    await show(app(['a']));
    await show(app(['a', 'b']));
    await show(app(['b', 'a'], '!'));
    expect(overlay()).toBe('view[entry[text"a!"] entry[text"b!"]]');
    await show(app(['b']));
    expect(overlay()).toBe('view[entry[text"b"]]');
    // Opened again: on top.
    await show(app(['a', 'b']));
    expect(overlay()).toBe('view[entry[text"b"] entry[text"a"]]');
    await show(app([]));
    expect(overlay()).toBe('view');
  });

  it('a portal opened from inside another stacks above it, even in one commit', async () => {
    const app = (inner: boolean, later: boolean) => (
      <View>
        <Portal>{label('tooltip')}</Portal>
        {later && (
          <Portal>
            {label('modal')}
            {inner && <Portal>{label('modal tooltip')}</Portal>}
          </Portal>
        )}
      </View>
    );
    await show(app(false, false));
    await show(app(true, true));
    expect(overlay()).toBe(
      'view[entry[text"tooltip"] entry[text"modal"] entry[text"modal tooltip"]]',
    );
  });
});

describe('Portal.Host', () => {
  function Panel({ host, clip = false }: { host: PortalHost; clip?: boolean }) {
    return (
      <View style={clip ? { overflow: 'hidden' } : undefined}>
        <Portal.Host host={host} style={{ flex: 1 }} />
      </View>
    );
  }

  it('renders exactly where the host is, inheriting its clipping', async () => {
    const host = createPortalHost();
    await show(
      <View>
        <Panel host={host} clip />
        <Portal host={host}>{label('inside')}</Portal>
      </View>,
    );
    expect(print()).toBe(
      'view[view[view{overflow:hidden}[view{flex:1}[text"inside"]]]]',
    );
    expect(overlay()).toBe('view');
  });

  it('shows nothing until the host mounts, and follows it away and back', async () => {
    const host = createPortalHost();
    const app = (panel: boolean) => (
      <View>
        <Portal host={host}>{label('content')}</Portal>
        {panel && <Panel host={host} />}
      </View>
    );
    await show(app(false));
    expect(print()).toBe('view[view]');
    await show(app(true));

    expect(print()).toBe('view[view[view[view{flex:1}[text"content"]]]]');
    await show(app(false));

    expect(print()).toBe('view[view]');
    await show(app(true));

    expect(print()).toBe('view[view[view[view{flex:1}[text"content"]]]]');
  });

  it('refuses a host shown in two places', async () => {
    const reported = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reported);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = createPortalHost();
    const raw = createRoot(root);
    const show = (element: ReactNode) => flushSync(() => raw.render(element));
    await show(
      <View>
        <Panel host={host} />
        <Panel host={host} />
      </View>,
    );
    expect(reported.mock.calls[0]?.[0]).toMatchObject({
      message:
        'A PortalHost is shown by two <Portal.Host> at once; show it in one place',
    });
    flushSync(() => raw.unmount());
    vi.unstubAllGlobals();
    errors.mockRestore();
  });

  it('refuses what is not a PortalHost', async () => {
    const reported = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reported);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = createRoot(root);
    const show = (element: ReactNode) => flushSync(() => raw.render(element));
    await show(<Portal host={{} as PortalHost}>{label('x')}</Portal>);
    expect(reported.mock.calls[0]?.[0]).toMatchObject({
      message: 'host must be a PortalHost from createPortalHost()',
    });
    flushSync(() => raw.unmount());
    vi.unstubAllGlobals();
    errors.mockRestore();
  });

  it('a host is opaque', async () => {
    const host = createPortalHost();
    expect(Object.keys(host)).toEqual([]);
    expect(Object.isFrozen(host)).toBe(true);
  });
});

describe('Portal and FocusScope', () => {
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
  const focusedName = () => {
    for (const [name, node] of nodes) if (node === focusedNode()) return name;
    return null;
  };
  const tab = async (shiftKey = false) => {
    await user.tab({ shift: shiftKey });
    return focusedName();
  };

  it('portaled content belongs to the scope that rendered it', async () => {
    const app = (menu: boolean) => (
      <View>
        <Field name="background" />
        <FocusScope trapped>
          <Field name="a" />
          {menu && (
            <Portal>
              <Field name="menu" />
              <Portal>
                <Field name="submenu" />
              </Portal>
            </Portal>
          )}
          <Field name="b" />
        </FocusScope>
      </View>
    );
    await show(app(true));
    // Tree order: the content, then the overlay.
    expect([
      await tab(),
      await tab(),
      await tab(),
      await tab(),
      await tab(),
    ]).toEqual(['a', 'b', 'menu', 'submenu', 'a']);
    expect(await tab(true)).toBe('submenu');
    // Closing the menu takes its nodes out of the cycle.
    await show(app(false));
    nodes.get('a')!.focus();
    expect([await tab(), await tab()]).toEqual(['b', 'a']);
  });

  it('autoFocus inside a portal finds its nodes in the view', async () => {
    await show(
      <View>
        <Field name="background" />
        <Portal>
          <FocusScope trapped autoFocus>
            <Field name="dialog" />
          </FocusScope>
        </Portal>
      </View>,
    );
    expect(focusedName()).toBe('dialog');
    expect(await tab()).toBe('dialog');
  });

  it('content rendered into a host outside the scope still belongs to it', async () => {
    const host = createPortalHost();
    await show(
      <View>
        <Portal.Host host={host} />
        <Field name="background" />
        <FocusScope trapped autoFocus>
          <Field name="a" />
          <Portal host={host}>
            <Field name="hosted" />
          </Portal>
        </FocusScope>
      </View>,
    );
    expect(focusedName()).toBe('a');
    // The host comes first in the tree.
    expect([await tab(), await tab()]).toEqual(['hosted', 'a']);
  });
});
