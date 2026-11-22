import { StyleSheet, Text, View } from '@soundor/react';

import { Panel } from '../ui/panel';
import { colors, text } from '../ui/theme';

/** How many rows, each this tall: far more than the list shows. */
export const ROWS = 40;
export const ROW_HEIGHT = 20;

/** A list that scrolls with the wheel, clipped to its box. */
export function ScrollList() {
  return (
    <Panel title="Scrolling" style={styles.panel}>
      <View debugId="scroll.list" accessibilityLabel="Rows" style={styles.list}>
        {Array.from({ length: ROWS }, (_, index) => (
          <Text
            key={index}
            debugId={`scroll.row.${index + 1}`}
            style={[text.body, styles.row]}
          >
            {`Row ${index + 1}`}
          </Text>
        ))}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { width: 160 },
  list: {
    flex: 1,
    overflowY: 'scroll',
    borderRadius: 4,
    backgroundColor: colors.background,
  },
  row: { height: ROW_HEIGHT, paddingHorizontal: 6 },
});
