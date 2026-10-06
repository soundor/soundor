// A tour of the UI primitives: coordinates, zIndex, context menus, long
// press, focus state, FocusScope, Portal / Portal.Host and Modal.

import {
  createPortalHost,
  FocusScope,
  Modal,
  Portal,
  Pressable,
  render,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
} from '@soundor/react';
import { useState, type ReactNode } from 'react';
import type { LayoutRect, PointerEvent, UiNode } from 'soundor:ui';

// ── Small building blocks ────────────────────────────────────────────────────

function Button({
  label,
  onPress,
  onLongPress,
  style,
}: {
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed, hovered, focused }) => [
        styles.button,
        hovered && styles.buttonHovered,
        pressed && styles.buttonPressed,
        focused && styles.focusRing,
        style,
      ]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ── Coordinates ──────────────────────────────────────────────────────────────

function Coordinates() {
  const [last, setLast] = useState('Move the pointer over the box');
  const show = (event: PointerEvent) =>
    setLast(
      `local ${event.locationX.toFixed(0)},${event.locationY.toFixed(0)}  ·  surface ${event.pageX.toFixed(0)},${event.pageY.toFixed(0)}`,
    );
  return (
    <Card title="Coordinates">
      <View style={styles.coordBox} onPointerMove={show} />
      <Text style={styles.caption}>{last}</Text>
    </Card>
  );
}

// ── zIndex ───────────────────────────────────────────────────────────────────

function Stacking() {
  const [front, setFront] = useState<'a' | 'b'>('b');
  const box = (name: 'a' | 'b', color: string, offset: number) => (
    <Pressable
      onPress={() => setFront(name)}
      style={[
        styles.stackBox,
        { left: offset, top: offset, backgroundColor: color },
        { zIndex: front === name ? 1 : 0 },
      ]}
    >
      <Text style={styles.buttonLabel}>{name.toUpperCase()}</Text>
    </Pressable>
  );
  return (
    <Card title="zIndex (click one to raise it)">
      <View style={styles.stackArea}>
        {box('a', '#e0525c', 0)}
        {box('b', '#3a7bfd', 28)}
      </View>
    </Card>
  );
}

// ── Context menu ─────────────────────────────────────────────────────────────

function ContextMenuDemo() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [picked, setPicked] = useState('Right-click the area');
  const choose = (item: string) => {
    setPicked(`Picked: ${item}`);
    setMenu(null);
  };
  return (
    <Card title="Context menu (onContextMenu + Portal)">
      <View
        style={styles.menuArea}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.pageX, y: event.pageY });
        }}
      >
        <Text style={styles.caption}>{picked}</Text>
      </View>
      {menu && (
        <Portal>
          {/* A transparent layer closes the menu on an outside press. */}
          <View style={styles.fill} onPointerDown={() => setMenu(null)} />
          <View style={[styles.menu, { left: menu.x, top: menu.y }]}>
            {['Copy', 'Paste', 'Reset'].map((item) => (
              <Pressable
                key={item}
                onPress={() => choose(item)}
                style={({ hovered }) => [
                  styles.menuItem,
                  hovered && styles.menuItemHovered,
                ]}
              >
                <Text style={styles.menuLabel}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </Portal>
      )}
    </Card>
  );
}

// ── Tooltip + long press + focus ─────────────────────────────────────────────

function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [node, setNode] = useState<UiNode | null>(null);
  const [box, setBox] = useState<LayoutRect | null>(null);
  return (
    <View
      ref={setNode}
      style={styles.tooltipAnchor}
      onPointerEnter={() => setBox(node?.getBoundingClientRect() ?? null)}
      onPointerLeave={() => setBox(null)}
    >
      {children}
      {box && (
        <Portal>
          <View
            style={[
              styles.tooltip,
              { left: box.x, top: box.y + box.height + 6 },
              { pointerEvents: 'none' },
            ]}
          >
            <Text style={styles.tooltipLabel}>{label}</Text>
          </View>
        </Portal>
      )}
    </View>
  );
}

function PressDemo() {
  const [log, setLog] = useState('Press, or hold for 500 ms');
  return (
    <Card title="Long press, focus, tooltip">
      <View style={styles.row}>
        <Tooltip label="Measured with getBoundingClientRect()">
          <Button
            label="Hold me"
            onPress={() => setLog('Pressed')}
            onLongPress={() => setLog('Long press!')}
          />
        </Tooltip>
        <Button label="Tab to me" onPress={() => setLog('Pressed the other')} />
      </View>
      <Text style={styles.caption}>{log}</Text>
    </Card>
  );
}

// ── Dropdown out of a clipped ScrollView ─────────────────────────────────────

function Dropdown() {
  const [anchor, setAnchor] = useState<UiNode | null>(null);
  const [box, setBox] = useState<LayoutRect | null>(null);
  const [value, setValue] = useState('Sine');
  return (
    <>
      <Pressable
        ref={setAnchor}
        onPress={() => setBox(anchor!.getBoundingClientRect())}
        style={({ focused }) => [styles.select, focused && styles.focusRing]}
      >
        <Text style={styles.menuLabel}>{value} ▾</Text>
      </Pressable>
      {box && (
        <Portal>
          <View style={styles.fill} onPointerDown={() => setBox(null)} />
          <View
            style={[
              styles.menu,
              { left: box.x, top: box.y + box.height, width: box.width },
            ]}
          >
            {['Sine', 'Saw', 'Square', 'Noise'].map((item) => (
              <Pressable
                key={item}
                onPress={() => {
                  setValue(item);
                  setBox(null);
                }}
                style={({ hovered }) => [
                  styles.menuItem,
                  hovered && styles.menuItemHovered,
                ]}
              >
                <Text style={styles.menuLabel}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </Portal>
      )}
    </>
  );
}

function ScrollDemo() {
  return (
    <Card title="Dropdown out of a clipped ScrollView">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ gap: 8, padding: 8 }}
      >
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <View key={n} style={styles.scrollRow}>
            <Text style={styles.caption}>Voice {n}</Text>
            <Dropdown />
          </View>
        ))}
      </ScrollView>
    </Card>
  );
}

// ── Custom Portal.Host (clipped where it lives) ──────────────────────────────

const panelHost = createPortalHost();

function HostDemo() {
  const [shown, setShown] = useState(false);
  return (
    <Card title="Portal.Host: clipped where it lives">
      <View style={styles.hostFrame}>
        <Portal.Host host={panelHost} style={styles.fill} />
      </View>
      <Button
        label={shown ? 'Remove hosted content' : 'Render into the host'}
        onPress={() => setShown((value) => !value)}
      />
      {shown && (
        <Portal host={panelHost}>
          <View style={styles.hostedBadge}>
            <Text style={styles.buttonLabel}>
              Hosted (clipped by its frame)
            </Text>
          </View>
        </Portal>
      )}
    </Card>
  );
}

// ── Modal, nested Modal, Portal inside Modal ─────────────────────────────────

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      onRequestClose={onClose}
      dismissOnBackdropPress
      backdropStyle={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
    >
      <View style={styles.dialog}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.caption}>
          Tab stays inside. Escape or a backdrop press asks to close.
        </Text>
        {children}
        <Button label="Close" onPress={onClose} />
      </View>
    </Modal>
  );
}

function ModalDemo() {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <Card title="Modal (in-surface, nested)">
      <Button label="Open dialog" onPress={() => setFirst(true)} />
      {first && (
        <Dialog title="Preset settings" onClose={() => setFirst(false)}>
          <TextInput placeholder="Preset name" style={styles.input} />
          <Dropdown />
          <Button
            label="Open a nested dialog"
            onPress={() => setSecond(true)}
          />
          {second && (
            <Dialog title="Are you sure?" onClose={() => setSecond(false)} />
          )}
        </Dialog>
      )}
    </Card>
  );
}

// ── FocusScope ───────────────────────────────────────────────────────────────

function ScopeDemo() {
  const [trapped, setTrapped] = useState(false);
  return (
    <Card title="FocusScope (trapped Tab)">
      <FocusScope trapped={trapped} autoFocus restoreFocus>
        <View style={[styles.row, trapped && styles.trapped]}>
          <TextInput placeholder="One" style={[styles.input, { flex: 1 }]} />
          <TextInput placeholder="Two" style={[styles.input, { flex: 1 }]} />
        </View>
      </FocusScope>
      <Button
        label={trapped ? 'Release the trap' : 'Trap Tab in the fields'}
        onPress={() => setTrapped((value) => !value)}
      />
    </Card>
  );
}

function App() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Soundor UI primitives</Text>
      <View style={styles.grid}>
        <Coordinates />
        <Stacking />
        <ContextMenuDemo />
        <PressDemo />
        <ScrollDemo />
        <HostDemo />
        <ModalDemo />
        <ScopeDemo />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#17181c' },
  content: { padding: 16, gap: 12 },
  title: { color: '#f2f3f5', fontSize: 20, fontWeight: 'bold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: 376,
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#202227',
    borderWidth: 1,
    borderColor: '#2e3138',
  },
  cardTitle: { color: '#f2f3f5', fontSize: 14, fontWeight: 'bold' },
  caption: { color: '#8b8f98', fontSize: 12 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#3a7bfd',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  buttonHovered: { backgroundColor: '#4c8dff' },
  buttonPressed: { backgroundColor: '#2a5fd0' },
  focusRing: { borderColor: '#ffd166' },
  buttonLabel: { color: 'white', fontSize: 13 },
  coordBox: { height: 60, borderRadius: 6, backgroundColor: '#2b2e35' },
  stackArea: { height: 90 },
  stackBox: {
    position: 'absolute',
    width: 120,
    height: 56,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuArea: {
    height: 60,
    borderRadius: 6,
    backgroundColor: '#2b2e35',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  menu: {
    position: 'absolute',
    minWidth: 140,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#2f323a',
    borderWidth: 1,
    borderColor: '#454955',
  },
  menuItem: { paddingVertical: 6, paddingHorizontal: 10 },
  menuItemHovered: { backgroundColor: '#3a7bfd' },
  menuLabel: { color: '#f2f3f5', fontSize: 13 },
  tooltipAnchor: { alignSelf: 'flex-start' },
  tooltip: {
    position: 'absolute',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: '#000000',
  },
  tooltipLabel: { color: 'white', fontSize: 12 },
  scroll: {
    height: 110,
    borderRadius: 6,
    backgroundColor: '#2b2e35',
    overflow: 'hidden',
  },
  scrollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  select: {
    width: 120,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 5,
    backgroundColor: '#3a3d46',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  hostFrame: {
    height: 50,
    borderRadius: 6,
    backgroundColor: '#2b2e35',
    overflow: 'hidden',
  },
  hostedBadge: {
    position: 'absolute',
    left: 200,
    top: 10,
    width: 260,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#2fa36b',
  },
  dialog: {
    margin: 'auto',
    width: 360,
    gap: 10,
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#24262c',
    borderWidth: 1,
    borderColor: '#454955',
  },
  input: {
    color: '#f2f3f5',
    fontSize: 13,
    backgroundColor: '#2b2e35',
    borderRadius: 6,
    padding: 8,
  },
  trapped: {
    borderWidth: 1,
    borderColor: '#ffd166',
    borderRadius: 6,
    padding: 4,
  },
});

render(<App />);
