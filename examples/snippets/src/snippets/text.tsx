import { Text, View } from '@soundor/react';

// Text is the only place strings go. Nested <Text> continues the same run
// with its own style; numberOfLines cuts it short.
export default function Typography() {
  return (
    <View style={{ width: 300, gap: 10 }}>
      <Text style={{ fontSize: 22, fontWeight: 'bold', color: '#e6e7ea' }}>
        Warm Tape
      </Text>
      <Text style={{ fontSize: 14, color: '#8b8f98' }}>
        Saturation <Text style={{ color: '#f2b13a' }}>+3 dB</Text>, wow and
        flutter <Text style={{ fontStyle: 'italic' }}>subtle</Text>.
      </Text>
      <Text
        numberOfLines={2}
        style={{ fontSize: 14, lineHeight: 20, color: '#e6e7ea' }}
      >
        A long description is cut after two lines: the rest of this sentence
        keeps going, well past what the box has room for, and never shows.
      </Text>
    </View>
  );
}
