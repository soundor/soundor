import { Text, View } from '@soundor/react';
import { useRef, useState } from 'react';

const DEFAULT = 0.5;
const WIDTH = 260;
const NAMES = ['', 'single click', 'double click', 'triple click'];

// Drag the fader to change it, double-click it to reset it: the platform
// decides what counts as a double click (its double-click time), and every
// click says which of a series it is in event.detail.
export default function DoubleClick() {
  const [value, setValue] = useState(0.8);
  const [last, setLast] = useState('none yet');
  const dragging = useRef(false);
  // A drag ends with a release on the fader too: not a click to report.
  const dragged = useRef(false);

  const end = () => {
    dragging.current = false;
  };
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Text style={{ color: '#e6e7ea' }}>Mix {Math.round(value * 100)}%</Text>
      <View
        onPointerDown={() => {
          dragging.current = true;
          dragged.current = false;
        }}
        onPointerMove={(event) => {
          if (!dragging.current || event.movementX === 0) return;
          dragged.current = true;
          setValue((v) =>
            Math.min(1, Math.max(0, v + event.movementX / WIDTH)),
          );
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onClick={(event) => {
          if (!dragged.current)
            setLast(NAMES[event.detail] ?? `${event.detail} clicks`);
        }}
        onDoubleClick={() => setValue(DEFAULT)}
        style={{
          width: WIDTH,
          height: 28,
          borderRadius: 14,
          backgroundColor: '#24262c',
          cursor: 'ew-resize',
        }}
      >
        <View
          style={{
            width: `${value * 100}%`,
            height: '100%',
            borderRadius: 14,
            backgroundColor: '#9473ca',
          }}
        />
      </View>
      <Text style={{ color: '#8b8f98' }}>
        Drag to change · double-click to reset
      </Text>
      <Text style={{ color: '#8b8f98' }}>Last click: {last}</Text>
    </View>
  );
}
