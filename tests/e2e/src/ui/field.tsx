import { StyleSheet, TextInput } from '@soundor/react';

import { colors } from './theme';

/** A labelled single-line input, uncontrolled. */
export function Field({
  label,
  onChangeText,
  onSubmit,
}: {
  readonly label: string;
  readonly onChangeText: (text: string) => void;
  readonly onSubmit?: () => void;
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      style={styles.input}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: colors.control,
    color: colors.text,
    fontSize: 13,
  },
});
