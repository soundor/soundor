// The plugin's UI: a React app, bundled by `soundor dev` / `soundor build` and
// run inside the plugin view by Soundor's runtime (no browser, no DOM).

import {
  Pressable,
  render,
  StyleSheet,
  Text,
  TextInput,
  useParameter,
  View,
} from '@soundor/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { plugin, snapshot, subscribe } from 'soundor:host';
import { parameters } from 'soundor:parameters';
import { storage } from 'soundor:storage';
import type { PointerEvent, KeyboardEvent, WheelEvent } from 'soundor:ui';

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A vertical fader for the gain: drag, wheel, or arrow keys when focused. */
function GainFader() {
  const gain = useParameter(parameters.gain);
  const drag = useRef<{ y: number; value: number } | null>(null);

  const onPointerDown = (event: PointerEvent) => {
    drag.current = { y: event.clientY, value: gain };
    parameters.gain.beginGesture();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (drag.current === null) return;
    const distance = drag.current.y - event.clientY;
    parameters.gain.set(clamp(drag.current.value + distance / 150));
  };
  const onPointerUp = () => {
    if (drag.current === null) return;
    drag.current = null;
    parameters.gain.endGesture();
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    parameters.gain.set(clamp(gain - Math.sign(event.deltaY) * 0.02));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    if (event.key === 'ArrowUp') parameters.gain.set(clamp(gain + step));
    else if (event.key === 'ArrowDown') parameters.gain.set(clamp(gain - step));
    else return;
    event.preventDefault();
  };

  return (
    <View style={styles.faderColumn}>
      <View
        focusable
        style={styles.fader}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <View style={[styles.faderFill, { height: `${gain * 100}%` }]} />
      </View>
      <Text style={styles.value}>{gain.toFixed(2)}</Text>
      <Text style={styles.caption}>{parameters.gain.info.label}</Text>
    </View>
  );
}

/** The host's tempo and transport, as it reports them. */
function HostStatus() {
  const host = useSyncExternalStore(subscribe, snapshot);
  const transport = host.transport;
  return (
    <Text style={styles.caption}>
      {host.hostName || 'No host'} · {Math.round(host.sampleRate)} Hz
      {transport
        ? ` · ${transport.bpm.toFixed(1)} BPM · ${transport.playing ? 'playing' : 'stopped'}`
        : ''}
    </Text>
  );
}

/** A preset name kept in the plugin's storage across sessions. */
function PresetName() {
  const [name, setName] = useState('');
  useEffect(() => {
    void storage
      .get<string>('presetName')
      .then((saved) => setName(saved ?? 'Init'));
  }, []);
  const save = (value: string) => void storage.set('presetName', value);
  return (
    <TextInput
      value={name}
      placeholder="Preset name"
      onChangeText={setName}
      onSubmitEditing={save}
      onBlur={() => save(name)}
      style={styles.input}
    />
  );
}

function App() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{plugin.name}</Text>
      <HostStatus />
      <View style={styles.row}>
        <GainFader />
        <View style={styles.panel}>
          <PresetName />
          <Pressable
            onPress={() => parameters.gain.set(parameters.gain.info.default)}
            style={({ pressed, hovered }) => [
              styles.button,
              hovered && styles.buttonHovered,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonLabel}>Reset gain</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#17181c', padding: 20, gap: 8 },
  title: { color: '#f2f3f5', fontSize: 20, fontWeight: 'bold' },
  caption: { color: '#8b8f98', fontSize: 12 },
  row: { flexDirection: 'row', gap: 24, marginTop: 12 },
  faderColumn: { alignItems: 'center', gap: 6 },
  fader: {
    width: 36,
    height: 180,
    borderRadius: 8,
    backgroundColor: '#24262c',
    borderWidth: 1,
    borderColor: '#33363e',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  faderFill: { backgroundColor: '#4c8dff' },
  value: { color: '#f2f3f5', fontSize: 14 },
  panel: { flex: 1, gap: 12 },
  input: {
    color: '#f2f3f5',
    fontSize: 14,
    backgroundColor: '#24262c',
    borderRadius: 6,
    padding: 8,
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#3a7bfd',
  },
  buttonHovered: { backgroundColor: '#4c8dff' },
  buttonPressed: { backgroundColor: '#2a5fd0' },
  buttonLabel: { color: 'white', fontSize: 14 },
});

render(<App />);
