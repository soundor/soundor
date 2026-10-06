import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPortalHost,
  createRoot,
  FocusScope,
  flushSync,
  Portal,
  ScrollView,
  Text,
  View,
  type PortalHost,
} from './index';
import {
  fire,
  focusedNode,
  overlayRoot,
  pressKey,
  print,
  reset,
  type FakeNode,
} from './testing/fake-ui';

let mounted: ReturnType<typeof createRoot> | null = null;

function show(element: ReactNode) {
  mounted ??= createRoot();
  flushSync(() => mounted!.render(element));
}

/** Lets scheduled work (effects, store updates) run. */
async function settle() {
  for (let i = 0; i < 5; ++i)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  if (mounted) flushSync(() => mounted!.unmount());
  mounted = null;
  reset();
});

/** The overlay as text, entries without their (fixed) style. */
const overlay = () =>
  print(overlayRoot as FakeNode).replaceAll(
    'view{position:absolute,left:0,top:0,right:0,bottom:0,pointerEvents:box-none}',
    'entry',
  );

const label = (text: string) => <Text>{text}</Text>;

describe('Portal', () => {
  it('renders into an overlay entry, out of clipping and scrolling', () => {
    show(
      <View style={{ overflow: 'hidden' }}>
        <ScrollView>
          <Portal>{label('menu')}</Portal>
        </ScrollView>
      </View>,
    );
    expect(print()).toBe('view[view{overflow:hidden}[scroll[view]]]');
    expect(overlay()).toBe('view[entry[text"menu"]]');
  });

  it('treats null and undefined hosts as the overlay', () => {
    show(
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
    show(app(1));
    await settle();
    const button = overlayRoot.children[0]!.children[0]! as FakeNode;
    flushSync(() => fire(button, 'click'));
    show(app(10));
    flushSync(() => fire(button, 'click'));
    await settle();
    expect(overlay()).toBe('view[entry[view[text"dark 11"]]]');
    // The same node, never remounted.
    expect(overlayRoot.children[0]!.children[0]).toBe(button);
    expect(effects).toEqual(['mount']);
  });

  it('stacks entries in the order they open; updates do not move them', () => {
    const app = (open: string[], text = '') => (
      <View>
        {open.map((name) => (
          <Portal key={name}>{label(name + text)}</Portal>
        ))}
      </View>
    );
    show(app(['a']));
    show(app(['a', 'b']));
    show(app(['b', 'a'], '!'));
    expect(overlay()).toBe('view[entry[text"a!"] entry[text"b!"]]');
    show(app(['b']));
    expect(overlay()).toBe('view[entry[text"b"]]');
    // Opened again: on top.
    show(app(['a', 'b']));
    expect(overlay()).toBe('view[entry[text"b"] entry[text"a"]]');
    show(app([]));
    expect(overlay()).toBe('view');
  });

  it('a portal opened from inside another stacks above it, even in one commit', () => {
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
    show(app(false, false));
    show(app(true, true));
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

  it('renders exactly where the host is, inheriting its clipping', () => {
    const host = createPortalHost();
    show(
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
    show(app(false));
    expect(print()).toBe('view[view]');
    show(app(true));
    await settle();
    expect(print()).toBe('view[view[view[view{flex:1}[text"content"]]]]');
    show(app(false));
    await settle();
    expect(print()).toBe('view[view]');
    show(app(true));
    await settle();
    expect(print()).toBe('view[view[view[view{flex:1}[text"content"]]]]');
  });

  it('refuses a host shown in two places', () => {
    const reported = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reported);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = createPortalHost();
    show(
      <View>
        <Panel host={host} />
        <Panel host={host} />
      </View>,
    );
    expect(reported.mock.calls[0]?.[0]).toMatchObject({
      message:
        'A PortalHost is shown by two <Portal.Host> at once; show it in one place',
    });
    vi.unstubAllGlobals();
    errors.mockRestore();
  });

  it('refuses what is not a PortalHost', () => {
    const reported = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reported);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    show(<Portal host={{} as PortalHost}>{label('x')}</Portal>);
    expect(reported.mock.calls[0]?.[0]).toMatchObject({
      message: 'host must be a PortalHost from createPortalHost()',
    });
    vi.unstubAllGlobals();
    errors.mockRestore();
  });

  it('a host is opaque', () => {
    const host = createPortalHost();
    expect(Object.keys(host)).toEqual([]);
    expect(Object.isFrozen(host)).toBe(true);
  });
});

describe('Portal and FocusScope', () => {
  const nodes = new Map<string, FakeNode>();
  function Field({ name }: { name: string }) {
    return (
      <View
        focusable
        ref={(node) => {
          if (node) nodes.set(name, node as unknown as FakeNode);
        }}
      />
    );
  }
  const focusedName = () => {
    for (const [name, node] of nodes) if (node === focusedNode()) return name;
    return null;
  };
  const tab = (shiftKey = false) => {
    pressKey('Tab', { shiftKey });
    return focusedName();
  };

  it('portaled content belongs to the scope that rendered it', () => {
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
    show(app(true));
    // Tree order: the content, then the overlay.
    expect([tab(), tab(), tab(), tab(), tab()]).toEqual([
      'a',
      'b',
      'menu',
      'submenu',
      'a',
    ]);
    expect(tab(true)).toBe('submenu');
    // Closing the menu takes its nodes out of the cycle.
    show(app(false));
    nodes.get('a')!.focus();
    expect([tab(), tab()]).toEqual(['b', 'a']);
  });

  it('autoFocus inside a portal finds its nodes in the view', () => {
    show(
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
    expect(tab()).toBe('dialog');
  });

  it('content rendered into a host outside the scope still belongs to it', () => {
    const host = createPortalHost();
    show(
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
    expect([tab(), tab()]).toEqual(['hosted', 'a']);
  });
});
