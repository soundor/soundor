import { Text, View, type Style } from '@soundor/react';
import { useRef, useState } from 'react';

const CURSORS = [
  'default',
  'pointer',
  'text',
  'crosshair',
  'move',
  'none',
  'ew-resize',
  'ns-resize',
  'nesw-resize',
  'nwse-resize',
] as const;

const tile: Style = {
  width: 92,
  paddingVertical: 6,
  alignItems: 'center',
  borderRadius: 6,
  backgroundColor: '#2a2c33',
};
const label: Style = { color: 'white', fontSize: 12 };

// `cursor` sets the pointer's shape over a node and its children. Hover the
// tiles; drag the fader and leave it: its cursor stays until you release.
export default function Cursors() {
  const [level, setLevel] = useState(0.6);
  const drag = useRef<{ x: number; level: number } | null>(null);

  return (
    <View style={{ width: 484, gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {CURSORS.map((cursor) => (
          <View key={cursor} style={[tile, { cursor }]}>
            <Text style={label}>{cursor}</Text>
          </View>
        ))}
      </View>

      {/* Children take their parent's cursor unless they set their own. */}
      <View
        style={{
          flexDirection: 'row',
          gap: 6,
          padding: 6,
          borderRadius: 8,
          backgroundColor: '#24262c',
          cursor: 'crosshair',
        }}
      >
        <View style={[tile, { flex: 1 }]}>
          <Text style={label}>inherits crosshair</Text>
        </View>
        <View style={[tile, { flex: 1, cursor: 'pointer' }]}>
          <Text style={label}>its own: pointer</Text>
        </View>
      </View>

      <View
        onPointerDown={(event) => {
          drag.current = { x: event.pageX, level };
        }}
        onPointerMove={(event) => {
          if (drag.current === null) return;
          const moved = (event.pageX - drag.current.x) / 484;
          setLevel(Math.min(1, Math.max(0, drag.current.level + moved)));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        style={{
          height: 28,
          justifyContent: 'center',
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: '#2a2c33',
          cursor: 'ew-resize',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${level * 100}%`,
            backgroundColor: '#3a7bfd',
          }}
        />
        <Text style={[label, { paddingHorizontal: 8 }]}>
          Drag: {Math.round(level * 100)}%
        </Text>
      </View>
    </View>
  );
}
