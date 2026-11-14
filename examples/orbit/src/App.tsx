import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useParameter,
  useStateValue,
} from '@soundor/react';
import { useState, useSyncExternalStore } from 'react';
import {
  getHostState as snapshot,
  subscribeHostState as subscribe,
} from 'soundor:host';
import { parameters } from 'soundor:parameters';
import { presets } from 'soundor:presets';
import { state } from 'soundor:state';
import type { HistoryOptions } from 'soundor:state-history';

import { EchoField } from './EchoField';
import { Knob } from './Knob';

export function App() {
  const catalog = presets.factory.list();
  const selection = useSyncExternalStore(
    presets.subscribe,
    presets.getSnapshot,
  );
  const preset = catalog.findIndex((entry) => entry.id === selection.factoryId);
  const selected = catalog[preset];
  const description = useStateValue(state.presetDescription);
  const [help, setHelp] = useState(false);
  const host = useSyncExternalStore(subscribe, snapshot);
  const sync = useParameter(parameters.sync),
    hold = useParameter(parameters.hold),
    bypass = useParameter(parameters.bypass);
  const bpm = host.transport?.bpm ?? 120;
  const choose = (index: number) => {
    presets.factory.load(catalog[index]!.id, { history: true });
  };
  const toggle = (parameter: {
    set(
      value: boolean | ((current: boolean) => boolean),
      options?: HistoryOptions,
    ): void;
  }) => {
    parameter.set((current) => !current, { history: true });
  };
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: '#3d4143',
              transform: [{ rotate: '-30deg' }, { scaleY: 0.58 }],
            }}
          >
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: '#3d4143',
                position: 'absolute',
                right: -2,
                top: 8,
              }}
            />
          </View>
          <Text
            style={{
              color: '#262b2e',
              fontSize: 34,
              fontWeight: 'bold',
              letterSpacing: -1.8,
              lineHeight: 40,
            }}
          >
            orbit
          </Text>
          <View
            style={{
              width: 1,
              height: 22,
              backgroundColor: '#c9cbc5',
              marginLeft: 5,
            }}
          />
          <Text style={styles.eyebrow}>
            THREE VOICES.{'\n'}ENDLESS RETURNS.
          </Text>
        </View>
        <View style={styles.preset}>
          <Pressable
            accessibilityLabel="Previous preset"
            onPress={() =>
              choose(
                preset < 0
                  ? catalog.length - 1
                  : (preset + catalog.length - 1) % catalog.length,
              )
            }
            style={({ focusVisible }) => [
              styles.arrow,
              focusVisible && styles.ring,
            ]}
          >
            <Text style={styles.arrowText}>‹</Text>
          </Pressable>
          <View style={{ width: 164, gap: 2 }}>
            <Text style={{ color: '#92958b', fontSize: 8, letterSpacing: 1.4 }}>
              PRESET /{' '}
              {preset < 0 ? 'CUSTOM' : String(preset + 1).padStart(2, '0')}
              {selection.modified ? ' *' : ''}
            </Text>
            <Text
              style={{ color: '#343938', fontSize: 12, fontWeight: 'bold' }}
            >
              {selected?.name ?? 'Custom'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Next preset"
            onPress={() => choose((preset + 1) % catalog.length)}
            style={({ focusVisible }) => [
              styles.arrow,
              focusVisible && styles.ring,
            ]}
          >
            <Text style={styles.arrowText}>›</Text>
          </Pressable>
        </View>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Compare audio"
          style={styles.compare}
        >
          {[
            { label: 'Original', dry: true },
            { label: 'Orbit', dry: false },
          ].map(({ label, dry }) => (
            <Pressable
              key={label}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: bypass === dry }}
              accessibilityHint={
                dry
                  ? 'Hear the input without Orbit'
                  : 'Hear the current Orbit settings'
              }
              onPress={() => {
                parameters.bypass.set(dry, { history: true });
              }}
              style={({ focusVisible }) => [
                styles.compareOption,
                bypass === dry && { backgroundColor: '#30362f' },
                // Inside: the options touch, and the next would cover it.
                focusVisible && styles.ringInside,
              ]}
            >
              <Text
                style={{
                  color: bypass === dry ? '#e2f1c6' : '#6e7867',
                  fontSize: 11,
                  fontWeight: 'bold',
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ marginTop: 14 }}>
        <EchoField bpm={bpm} playing={host.transport?.playing ?? false} />
      </View>
      <View style={styles.controls}>
        <Knob
          label="Feedback"
          parameter={parameters.feedback}
          hint="Length of the echo tail"
        />
        <Knob
          label="Tone"
          parameter={parameters.tone}
          hint="Brightness of the repeats"
          format={(v) => `${Math.round(400 * 30 ** v)} Hz`}
        />
        <Knob
          label="Motion"
          parameter={parameters.motion}
          hint="Pitch and timing drift"
        />
        <Knob
          label="Spread"
          parameter={parameters.spread}
          hint="Stereo width of the echoes"
        />
        <Knob
          label="Mix"
          parameter={parameters.mix}
          hint="Balance between original and echoes"
        />
        <View
          style={{
            width: 1,
            height: 85,
            backgroundColor: '#cdd0c6',
            marginLeft: 8,
            marginRight: 20,
            marginTop: 14,
          }}
        />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Pressable
            accessibilityLabel="Hold"
            accessibilityRole="togglebutton"
            accessibilityState={{ checked: hold }}
            onPress={() => toggle(parameters.hold)}
            style={({ hovered, pressed, focusVisible }) => [
              styles.hold,
              hold && styles.held,
              hovered && { borderColor: '#9eae86' },
              pressed && { opacity: 0.8 },
              focusVisible && styles.ring,
            ]}
          >
            <View
              style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: hold ? '#243027' : '#9b9f92',
                }}
              />
              <Text
                style={{
                  color: '#32382f',
                  fontWeight: 'bold',
                  fontSize: 12,
                  letterSpacing: 1,
                }}
              >
                HOLD
              </Text>
            </View>
          </Pressable>
          <Text style={{ color: '#81867a', fontSize: 9 }}>
            {hold ? 'Release to let sound in' : 'Catch a moment'}
          </Text>
        </View>
      </View>
      <View style={styles.footer}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            accessibilityLabel="Tempo sync"
            accessibilityRole="togglebutton"
            accessibilityState={{ checked: sync }}
            onPress={() => toggle(parameters.sync)}
            style={({ focusVisible }) => [
              styles.sync,
              sync && { backgroundColor: '#dfe6d5' },
              focusVisible && styles.ring,
            ]}
          >
            <Text
              style={{
                color: sync ? '#4c6140' : '#777c73',
                fontSize: 9,
                fontWeight: 'bold',
                letterSpacing: 0.8,
              }}
            >
              {sync ? 'SYNC' : 'FREE'}
            </Text>
          </Pressable>
          <Text
            style={{ color: '#7f857a', fontFamily: 'monospace', fontSize: 10 }}
          >
            {bpm.toFixed(0)} BPM
          </Text>
        </View>
        <Text style={{ color: '#7c8179', fontSize: 10 }}>
          {bypass
            ? 'Bypassed · original audio'
            : help
              ? 'Drag echoes: time ↔ / level ↕. Knobs: drag ↑↓. Arrow keys work too.'
              : selected
                ? description
                : 'Custom settings. Choose a preset to start again.'}
        </Text>
        <Pressable
          accessibilityLabel="Show controls help"
          accessibilityRole="togglebutton"
          accessibilityState={{ checked: help }}
          onPress={() => setHelp(!help)}
          style={({ focusVisible }) => [
            { padding: 4, borderRadius: 4 },
            focusVisible && styles.ring,
          ]}
        >
          <Text style={{ color: '#777e71', fontSize: 10 }}>
            {help ? 'CLOSE' : '? HELP'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#eaece4',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 14,
  },
  header: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: '#808578',
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 1.1,
  },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 18,
  },
  arrow: {
    width: 26,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  arrowText: { color: '#737b6d', fontSize: 24, lineHeight: 28 },
  compare: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 8,
    backgroundColor: '#dce0d4',
    borderWidth: 1,
    borderColor: '#c5ccba',
  },
  compareOption: {
    width: 59,
    height: 30,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: { marginTop: 12, height: 132, flexDirection: 'row' },
  hold: {
    width: 137,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#dce0d4',
    borderWidth: 1,
    borderColor: '#c5ccba',
    alignItems: 'center',
    justifyContent: 'center',
  },
  held: { backgroundColor: '#c4e693', borderColor: '#afce80' },
  footer: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: '#cdd1c4',
    paddingTop: 10,
  },
  sync: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  // Keyboard focus (focusVisible): an outline, so nothing moves.
  ring: { outlineWidth: 2, outlineOffset: 2, outlineColor: '#9473ca' },
  ringInside: { outlineWidth: 2, outlineOffset: -2, outlineColor: '#9473ca' },
});
