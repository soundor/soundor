import { Portal, Text, View } from '@soundor/react';
import { useRef, useState } from 'react';
import type { LayoutRect, UiNode } from 'soundor:ui';

// A tooltip: the trigger's box in surface coordinates, and a portal that
// draws above everything else, out of any clipping.
function Hint({ label }: { label: string }) {
  const ref = useRef<UiNode>(null);
  const [box, setBox] = useState<LayoutRect | null>(null);

  return (
    <View
      ref={ref}
      onPointerEnter={() => setBox(ref.current!.getBoundingClientRect())}
      onPointerLeave={() => setBox(null)}
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#3a7bfd',
      }}
    >
      <Text style={{ color: 'white' }}>?</Text>
      {box && (
        <Portal>
          <View
            style={{
              position: 'absolute',
              left: box.x,
              top: box.y + box.height + 6,
              padding: 8,
              borderRadius: 6,
              backgroundColor: '#e6e7ea',
            }}
          >
            <Text style={{ color: '#17181c' }}>{label}</Text>
          </View>
        </Portal>
      )}
    </View>
  );
}

export default function Tooltip() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ color: '#e6e7ea', fontSize: 16 }}>Drive</Text>
      <Hint label="Saturation before the filter" />
    </View>
  );
}
