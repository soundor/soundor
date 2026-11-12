import {
  Pressable,
  Text,
  View,
  useParameter,
  useStateHistory,
} from '@soundor/react';
import { parameters } from 'soundor:parameters';

export default function History() {
  const bypass = useParameter(parameters.bypass);
  const history = useStateHistory();
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        onPress={() =>
          parameters.bypass.set((current) => !current, {
            history: { label: 'Toggle Bypass' },
          })
        }
        style={{ padding: 10, backgroundColor: '#2a2c33', borderRadius: 6 }}
      >
        <Text style={{ color: 'white' }}>
          {bypass ? 'Bypass On' : 'Bypass Off'}
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable
          disabled={!history.canUndo}
          onPress={history.undo}
          accessibilityLabel="Undo"
        >
          <Text style={{ color: history.canUndo ? '#8fb3ff' : '#8b8f98' }}>
            Undo
          </Text>
        </Pressable>
        <Pressable
          disabled={!history.canRedo}
          onPress={history.redo}
          accessibilityLabel="Redo"
        >
          <Text style={{ color: history.canRedo ? '#8fb3ff' : '#8b8f98' }}>
            Redo
          </Text>
        </Pressable>
      </View>
      <Text style={{ color: '#8b8f98' }}>
        {history.undoLabel ?? 'No recorded edits'}
      </Text>
    </View>
  );
}
