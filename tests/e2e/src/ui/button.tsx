import { Pressable, StyleSheet, Text } from '@soundor/react';

import { colors, text } from './theme';

export function Button({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={({ focused }) => [styles.button, focused && styles.focused]}
    >
      <Text style={text.body}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: colors.control,
  },
  focused: { borderWidth: 1, borderColor: colors.accent },
});
