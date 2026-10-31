import { Text, useViewSize, View } from '@soundor/react';

// The view's size in logical pixels, re-rendered when it changes. Below 480
// the two controls stack; above, they sit side by side. Here the view is the
// page's iframe: make the window narrower to see it switch.
export default function ViewSize() {
  const { width, height, scale } = useViewSize();
  const compact = width < 480;

  return (
    <View style={{ alignSelf: 'stretch', gap: 12 }}>
      <Text style={{ color: '#8b8f98', fontSize: 13 }}>
        {`${Math.round(width)} × ${Math.round(height)} · scale ${scale}`}
      </Text>
      <View style={{ flexDirection: compact ? 'column' : 'row', gap: 8 }}>
        {['Gain', 'Tone'].map((label) => (
          <View
            key={label}
            style={{
              flex: compact ? 0 : 1,
              padding: 16,
              borderRadius: 8,
              backgroundColor: '#24262c',
            }}
          >
            <Text style={{ color: '#e6e7ea', fontSize: 15 }}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
