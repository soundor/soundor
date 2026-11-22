import { Pressable, StyleSheet, Text, useParameter } from '@soundor/react';
import { parameters } from 'soundor:parameters';

import { colors, text } from '../ui/theme';

export function BypassToggle() {
  const bypass = useParameter(parameters.bypass);
  return (
    <Pressable
      accessibilityRole="togglebutton"
      accessibilityLabel="Bypass"
      accessibilityState={{ checked: bypass }}
      onPress={() => parameters.bypass.set(!bypass)}
      style={[styles.toggle, bypass && styles.on]}
    >
      <Text style={text.body}>{bypass ? 'Bypassed' : 'Active'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: colors.control,
  },
  on: { backgroundColor: '#7a4a00' },
});
