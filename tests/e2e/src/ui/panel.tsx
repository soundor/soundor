import { StyleSheet, Text, View, type StyleProp } from '@soundor/react';
import type { ReactNode } from 'react';

import { colors, text } from './theme';

/** A titled group of controls, a region to assistive technology. */
export function Panel({
  title,
  children,
  style,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly style?: StyleProp;
}) {
  return (
    <View style={[styles.panel, style]}>
      <Text accessibilityRole="header" style={text.muted}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 6, padding: 8, borderRadius: 6, backgroundColor: colors.panel },
});
