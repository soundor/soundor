// The plugin's UI. Its native methods are the Rust controller's
// (native/src/controller.rs): synchronous ones return their value at once,
// async ones a promise the controller settles.

import {
  Pressable,
  StyleSheet,
  Text,
  useParameter,
  useStateValue,
  View,
} from '@soundor/react';
import { useState } from 'react';
import { plugin } from 'soundor:host';
import {
  click,
  clickLater,
  loadTable,
  stats,
  type Shape,
} from 'soundor:native';
import { parameters } from 'soundor:parameters';
import { state } from 'soundor:state';

const SHAPES: readonly Shape[] = ['sine', 'triangle', 'square', 'saw'];

function Button({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function App() {
  const rate = useParameter(parameters.rate);
  const shape = useStateValue(state.shape);
  const [clicks, setClicks] = useState(() => stats().clicks);
  const [status, setStatus] = useState('');
  const summary = () => {
    const { clicks: count, loads, lastShape } = stats();
    setClicks(count);
    return `${loads} loads, last ${lastShape ?? 'none'}`;
  };
  const load = async (next: Shape) => {
    setStatus(`Loading ${next}…`);
    try {
      const size = await loadTable(next, 2048);
      setStatus(`${next}: ${size} samples · ${summary()}`);
    } catch (error) {
      setStatus(String(error));
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{plugin.name}</Text>
      <Text style={styles.caption}>
        {`${parameters.rate.info.label} ${rate.toFixed(1)} Hz · ${shape}`}
      </Text>
      <View style={styles.row}>
        <Button label="Click" onPress={() => setClicks(click())} />
        <Button
          label="Click later"
          onPress={() => void clickLater().then(setClicks)}
        />
        <Text style={styles.value}>{`${clicks} clicks`}</Text>
      </View>
      <View style={styles.row}>
        {SHAPES.map((name) => (
          <Button key={name} label={name} onPress={() => void load(name)} />
        ))}
      </View>
      <Text style={styles.caption}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 24,
    gap: 16,
    backgroundColor: '#14161a',
  },
  title: { color: '#f2f3f5', fontSize: 22, fontWeight: 600 },
  caption: { color: '#9aa0aa', fontSize: 13 },
  value: { color: '#f2f3f5', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#2a2f38',
  },
  buttonText: { color: '#f2f3f5', fontSize: 14 },
});
