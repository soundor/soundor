import { StyleSheet, Text, View, useNativeStream } from '@soundor/react';
import { useEffect, useState } from 'react';
import { countLater, events, reverse, streams } from 'soundor:native';

import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Panel } from '../ui/panel';
import { text } from '../ui/theme';

/** The Rust controller's methods and event, and the processor's streams. */
export function NativePanel() {
  const [input, setInput] = useState('');
  const [reversed, setReversed] = useState('');
  const [count, setCount] = useState('');
  const [event, setEvent] = useState(0);
  const peak = useNativeStream(streams.peak);
  const scope = useNativeStream(streams.scope);
  useEffect(
    () => events.counted.subscribe(({ count: value }) => setEvent(value)),
    [],
  );
  const later = async () => {
    try {
      setCount(`Counted ${await countLater()}`);
    } catch (error) {
      setCount(`Count failed: ${String(error)}`);
    }
  };
  return (
    <Panel title="Native" style={styles.fill}>
      <View style={styles.row}>
        <Field
          label="Text to reverse"
          onChangeText={setInput}
          onSubmit={() => setReversed(reverse(input))}
        />
        <Button label="Reverse" onPress={() => setReversed(reverse(input))} />
      </View>
      <Text debugId="native.reversed" style={text.body}>
        {`Reversed: ${reversed}`}
      </Text>
      <View style={styles.row}>
        <Button label="Count later" onPress={() => void later()} />
        <Text debugId="native.count" style={text.body}>
          {count || 'Not counted'}
        </Text>
        <Text debugId="native.event" style={text.muted}>
          {`Event ${event}`}
        </Text>
      </View>
      <Text debugId="native.peak" style={text.body}>
        {peak === undefined ? 'Peak none' : `Peak ${peak.toFixed(3)}`}
      </Text>
      <Text debugId="native.scope" style={text.body}>
        {scope === undefined
          ? 'Scope none'
          : `Scope ${scope.length} samples, first ${scope[0]?.toFixed(3) ?? '-'}`}
      </Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
