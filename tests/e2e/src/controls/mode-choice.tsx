import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useParameter,
} from '@soundor/react';
import { parameters } from 'soundor:parameters';

import { colors, text } from '../ui/theme';

/** Mode as a radio group, one radio per choice. */
export function ModeChoice() {
  const mode = useParameter(parameters.mode);
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Mode"
      style={styles.group}
    >
      {parameters.mode.info.options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: mode === option.value }}
          onPress={() => parameters.mode.set(option.value)}
          style={[styles.radio, mode === option.value && styles.checked]}
        >
          <Text style={text.body}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: 2 },
  radio: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.control,
  },
  checked: { backgroundColor: '#5a5a5a' },
});
