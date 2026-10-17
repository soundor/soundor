import { Pressable, Text, TextInput, View } from '@soundor/react';
import { useState } from 'react';

// A controlled TextInput: its text is state, and Enter submits it.
export default function PresetName() {
  const [name, setName] = useState('');
  const [presets, setPresets] = useState(['Init']);
  const save = () => {
    if (name.trim() === '') return;
    setPresets((saved) => [...saved, name.trim()]);
    setName('');
  };

  return (
    <View style={{ width: 280, gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          accessibilityLabel="Preset name"
          placeholder="Preset name"
          value={name}
          onChangeText={setName}
          onSubmitEditing={save}
          style={{
            flex: 1,
            padding: 8,
            borderRadius: 6,
            backgroundColor: '#24262c',
            color: '#e6e7ea',
            fontSize: 14,
          }}
        />
        <Pressable
          onPress={save}
          disabled={name.trim() === ''}
          style={({ pressed }) => ({
            justifyContent: 'center',
            paddingHorizontal: 12,
            borderRadius: 6,
            backgroundColor: pressed ? '#2a5fd0' : '#3a7bfd',
            opacity: name.trim() === '' ? 0.5 : 1,
          })}
        >
          <Text style={{ color: 'white' }}>Save</Text>
        </Pressable>
      </View>
      {presets.map((preset, index) => (
        <Text key={index} style={{ color: '#e6e7ea' }}>
          {index + 1}. {preset}
        </Text>
      ))}
    </View>
  );
}
