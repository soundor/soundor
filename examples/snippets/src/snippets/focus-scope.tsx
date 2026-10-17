import { FocusScope, Pressable, Text, TextInput, View } from '@soundor/react';
import { useState } from 'react';

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ focused }) => ({
        padding: 8,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: focused ? '#8fb3ff' : 'transparent',
        backgroundColor: '#3a7bfd',
      })}
    >
      <Text style={{ color: 'white' }}>{label}</Text>
    </Pressable>
  );
}

// Click into the panel, then press Tab: focus cycles inside it while
// trapped, starts in it (autoFocus), and goes back where it was when the
// panel closes (restoreFocus).
export default function TrappedPanel() {
  const [open, setOpen] = useState(false);

  return (
    <View style={{ width: 300, gap: 10 }}>
      <Button
        label={open ? 'Close panel' : 'Open panel'}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <FocusScope trapped autoFocus restoreFocus>
          <View
            style={{
              gap: 8,
              padding: 10,
              borderRadius: 8,
              backgroundColor: '#24262c',
            }}
          >
            <TextInput
              accessibilityLabel="Preset name"
              placeholder="Preset name"
              style={{
                padding: 6,
                borderRadius: 6,
                backgroundColor: '#17181c',
                color: '#e6e7ea',
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Save" onPress={() => setOpen(false)} />
              <Button label="Cancel" onPress={() => setOpen(false)} />
            </View>
          </View>
        </FocusScope>
      )}
    </View>
  );
}
