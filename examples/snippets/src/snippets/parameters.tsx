import { Pressable, Text, View, useParameter } from '@soundor/react';
import type { ReactNode } from 'react';
import { parameters } from 'soundor:parameters';

function Button({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        minWidth: 32,
        alignItems: 'center',
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 6,
        backgroundColor: selected || pressed ? '#3a7bfd' : '#2a2c33',
      })}
    >
      <Text style={{ color: 'white' }}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ width: 64, color: '#8b8f98' }}>{label}</Text>
      {children}
    </View>
  );
}

// One parameter of each type. Values are plain: a number in range (an int
// is rounded), a boolean, or one of an enum's values.
export default function Parameters() {
  const gain = useParameter(parameters.gain);
  const voices = useParameter(parameters.voices);
  const bypass = useParameter(parameters.bypass);
  const mode = useParameter(parameters.mode);

  return (
    <View style={{ gap: 10 }}>
      <Row label="Gain">
        <Button label="−" onPress={() => parameters.gain.set(gain - 0.1)} />
        <Text style={{ width: 40, color: '#e6e7ea' }}>{gain.toFixed(2)}</Text>
        <Button label="+" onPress={() => parameters.gain.set(gain + 0.1)} />
      </Row>
      <Row label="Voices">
        <Button label="−" onPress={() => parameters.voices.set(voices - 1)} />
        <Text style={{ width: 40, color: '#e6e7ea' }}>{voices}</Text>
        <Button label="+" onPress={() => parameters.voices.set(voices + 1)} />
      </Row>
      <Row label="Bypass">
        <Button
          label={bypass ? 'On' : 'Off'}
          selected={bypass}
          onPress={() => parameters.bypass.set(!bypass)}
        />
      </Row>
      <Row label="Mode">
        {parameters.mode.info.values.map((value) => (
          <Button
            key={value}
            label={value}
            selected={value === mode}
            onPress={() => parameters.mode.set(value)}
          />
        ))}
      </Row>
    </View>
  );
}
