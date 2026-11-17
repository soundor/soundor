import { Pressable, StyleSheet, Text, View } from '@soundor/react';
import { useEffect, useRef, useState } from 'react';
import { midi, type MidiEvent } from 'soundor:midi';

const notes = [60, 62, 64, 65, 67, 69, 71, 72];
const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'];

/** Publications are events, so retain a bounded history rather than a latest-value stream. */
export function KeyboardMonitor() {
  const held = useRef(new Set<number>());
  const [events, setEvents] = useState<readonly MidiEvent[]>([]);
  const [status, setStatus] = useState('Ready');
  const [active, setActive] = useState<readonly number[]>([]);
  const play = (note: number, down: boolean) => {
    if (down) held.current.add(note);
    else held.current.delete(note);
    const result = midi.send({
      type: down ? 'noteOn' : 'noteOff',
      channel: 1,
      note,
      velocity: down ? 100 : 0,
    });
    setStatus(result === 'sent' ? 'Next block' : result);
  };
  useEffect(() => {
    const pressed = held.current;
    const sounding = new Set<number>();
    const off = midi.subscribeBatch((batch) => {
      if (batch.reset) {
        sounding.clear();
        pressed.clear();
        setEvents([]);
        setStatus(`Reset · ${batch.dropped} dropped`);
      }
      for (const { message } of batch.events) {
        if (message.type === 'noteOn' && message.velocity > 0)
          sounding.add((message.channel - 1) * 128 + message.note);
        else if (message.type === 'noteOff' || message.type === 'noteOn')
          sounding.delete((message.channel - 1) * 128 + message.note);
        else if (
          message.type === 'controlChange' &&
          (message.controller === 120 || message.controller === 123)
        ) {
          for (const key of sounding)
            if (Math.floor(key / 128) === message.channel - 1)
              sounding.delete(key);
        }
      }
      setActive([...sounding].map((key) => key % 128));
      if (batch.events.length)
        setEvents((previous) => [...batch.events, ...previous].slice(0, 8));
    });
    return () => {
      off();
      for (const note of pressed)
        midi.send({ type: 'noteOff', channel: 1, note, velocity: 0 });
      pressed.clear();
    };
  }, []);
  const panic = () => {
    held.current.clear();
    for (let channel = 1; channel <= 16; channel++)
      midi.send({ type: 'controlChange', channel, controller: 120, value: 0 });
  };
  return (
    <View style={styles.panel}>
      <View style={styles.keys}>
        {notes.map((note, index) => (
          <Pressable
            key={note}
            accessibilityLabel={`Note ${note}`}
            debugId={`note-${note}`}
            onPressIn={() => play(note, true)}
            onPressOut={() => play(note, false)}
            style={({ pressed }) => [
              styles.key,
              (pressed || active.includes(note)) && styles.down,
            ]}
          >
            <Text style={styles.keyLabel}>{names[index]}</Text>
            <Text style={styles.number}>{note}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.caption}>
        {status} · Hold keys with the pointer. Host/device input also works.
      </Text>
      <Pressable
        accessibilityLabel="All notes off"
        onPress={panic}
        style={styles.button}
      >
        <Text style={styles.text}>All notes off</Text>
      </Pressable>
      <Text style={styles.heading}>Processor MIDI monitor</Text>
      <Text style={styles.caption}>
        Only events explicitly published by Rust appear here.
      </Text>
      {events.map((event, index) => (
        <Text key={index} style={styles.event}>
          {JSON.stringify(event.message)} · +{event.sampleOffset} ·{' '}
          {event.source ?? 'processor'}
        </Text>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: 10 },
  keys: { flexDirection: 'row', gap: 6 },
  key: {
    flex: 1,
    height: 88,
    backgroundColor: '#e5eaf4',
    borderRadius: 6,
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 8,
  },
  down: { backgroundColor: '#6aa9ff' },
  keyLabel: { color: '#17223a', fontSize: 20 },
  number: { color: '#465673', fontSize: 11 },
  heading: { color: '#f2f5fb', fontSize: 16, fontWeight: 'bold' },
  text: { color: '#f2f5fb', fontSize: 13 },
  caption: { color: '#a4b2ca', fontSize: 11 },
  event: { color: '#b8c8e5', fontSize: 10 },
  button: {
    backgroundColor: '#294c7c',
    borderRadius: 6,
    padding: 8,
    alignSelf: 'flex-start',
  },
});
