import { Modal, Pressable, Text, View } from '@soundor/react';
import { useState } from 'react';

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 6,
        backgroundColor: pressed ? '#2a5fd0' : '#3a7bfd',
      })}
    >
      <Text style={{ color: 'white' }}>{label}</Text>
    </Pressable>
  );
}

// A modal takes the view's input and keyboard focus until it closes:
// Escape and a press on the backdrop ask it to.
export default function ConfirmDiscard() {
  const [confirming, setConfirming] = useState(false);
  const [discarded, setDiscarded] = useState(0);

  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <Button label="Discard changes…" onPress={() => setConfirming(true)} />
      <Text style={{ color: '#8b8f98' }}>Discarded {discarded} times</Text>
      <Modal
        visible={confirming}
        onRequestClose={() => setConfirming(false)}
        dismissOnBackdropPress
        accessibilityLabel="Discard changes"
        backdropStyle={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      >
        <View
          style={{
            margin: 'auto',
            gap: 12,
            padding: 16,
            borderRadius: 10,
            backgroundColor: '#24262c',
          }}
        >
          <Text style={{ color: '#e6e7ea', fontSize: 16 }}>
            Discard changes?
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Cancel" onPress={() => setConfirming(false)} />
            <Button
              label="Discard"
              onPress={() => {
                setDiscarded((count) => count + 1);
                setConfirming(false);
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
