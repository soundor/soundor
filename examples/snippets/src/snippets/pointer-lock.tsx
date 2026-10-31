import { Text, View } from '@soundor/react';
import { useRef, useState } from 'react';
import type { PointerEvent } from 'soundor:ui';

// A knob that locks the pointer while it is dragged: the pointer hides, the
// screen's edges don't stop it, movementY turns the knob, and on release the
// pointer is back on the knob. The other one doesn't lock: it stops at the
// edge, and the pointer ends wherever you let go.
function Knob({ lock }: { lock: boolean }) {
  const [value, setValue] = useState(0.5);
  const dragging = useRef(false);

  const end = () => {
    dragging.current = false;
  };
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View
        onPointerDown={(event: PointerEvent) => {
          dragging.current = true;
          // Turns without the lock too, if it is refused.
          if (lock) event.currentTarget?.requestPointerLock().catch(() => {});
        }}
        onPointerMove={(event: PointerEvent) => {
          if (!dragging.current) return;
          setValue((v) => Math.min(1, Math.max(0, v - event.movementY / 300)));
        }}
        onPointerUp={end}
        onPointerCancel={end}
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          overflow: 'hidden',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#2a2c33',
          cursor: 'ns-resize',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: `${value * 100}%`,
            backgroundColor: lock ? '#3a7bfd' : '#5b5e6b',
          }}
        />
        <Text style={{ color: 'white', fontSize: 16 }}>
          {Math.round(value * 100)}%
        </Text>
      </View>
      <Text style={{ color: '#9a9cab', fontSize: 12 }}>
        {lock ? 'Locks the pointer' : 'No lock'}
      </Text>
    </View>
  );
}

export default function PointerLock() {
  return (
    <View style={{ flexDirection: 'row', gap: 48 }}>
      <Knob lock />
      <Knob lock={false} />
    </View>
  );
}
