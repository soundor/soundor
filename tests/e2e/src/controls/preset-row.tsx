import {
  StyleSheet,
  Text,
  View,
  usePresetSelection,
  useStateValue,
} from '@soundor/react';
import { presets } from 'soundor:presets';
import { state } from 'soundor:state';

import { Button } from '../ui/button';
import { text } from '../ui/theme';

/** A button per factory preset, what is selected, and the saved note. */
export function PresetRow() {
  const selection = usePresetSelection(presets);
  const note = useStateValue(state.note);
  const current = presets.factory
    .list()
    .find((preset) => preset.id === selection.factoryId);
  return (
    <View style={styles.row}>
      {presets.factory.list().map((preset) => (
        <Button
          key={preset.id}
          label={preset.name}
          onPress={() => presets.factory.load(preset.id)}
        />
      ))}
      <Text debugId="preset.current" style={text.muted}>
        {current
          ? `${current.name}${selection.modified ? ' (modified)' : ''}`
          : 'Custom'}
      </Text>
      <Text debugId="note" style={text.muted}>
        {`Note: ${note || 'none'}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
