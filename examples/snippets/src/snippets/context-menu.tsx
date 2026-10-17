import { Portal, Pressable, Text, View } from '@soundor/react';
import { useState } from 'react';

const ACTIONS = ['Copy', 'Paste', 'Reset to default'];

// Right-click (or Ctrl-click) the track: onContextMenu gives the pointer's
// position in the view, and a portal draws the menu there, above everything.
export default function ContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [last, setLast] = useState('nothing yet');

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.pageX, y: event.pageY });
        }}
        onPointerDown={(event) => {
          if (event.button === 0) setMenu(null);
        }}
        style={{
          width: 260,
          padding: 16,
          borderRadius: 8,
          backgroundColor: '#24262c',
        }}
      >
        <Text style={{ color: '#e6e7ea' }}>Track 1 · right-click me</Text>
      </View>
      <Text style={{ color: '#8b8f98' }}>Last action: {last}</Text>
      {menu && (
        <Portal>
          <View
            style={{
              position: 'absolute',
              left: menu.x,
              top: menu.y,
              padding: 4,
              borderRadius: 8,
              backgroundColor: '#e6e7ea',
            }}
          >
            {ACTIONS.map((action) => (
              <Pressable
                key={action}
                accessibilityRole="menuitem"
                onPress={() => {
                  setLast(action);
                  setMenu(null);
                }}
                style={({ hovered }) => ({
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 4,
                  backgroundColor: hovered ? '#c9d8ff' : 'transparent',
                })}
              >
                <Text style={{ color: '#17181c' }}>{action}</Text>
              </Pressable>
            ))}
          </View>
        </Portal>
      )}
    </View>
  );
}
