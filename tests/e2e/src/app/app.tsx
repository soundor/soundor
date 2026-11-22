import { StyleSheet, Text, View, useViewSize } from '@soundor/react';
import { plugin } from 'soundor:host';

import { Controls } from '../controls/controls';
import { NativePanel } from '../native/native-panel';
import { Swatches } from '../rendering/swatches';
import { ScrollList } from '../scrolling/scroll-list';
import { colors, text } from '../ui/theme';
import { WebApisPanel } from '../web-apis/web-apis-panel';
import { HostStatus } from './host-status';

/**
 * Every part of the plugin, laid out by flexbox to fill the view at any
 * size: the bottom row takes what the others leave.
 */
export function App() {
  const { width, height } = useViewSize();
  return (
    <View debugId="app" style={styles.root}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {plugin.name}
        </Text>
        <HostStatus />
        <Text debugId="view.size" style={text.muted}>
          {`${Math.round(width)}×${Math.round(height)}`}
        </Text>
      </View>
      <Swatches />
      <Controls />
      <View debugId="app.bottom" style={styles.bottom}>
        <NativePanel />
        <WebApisPanel />
        <ScrollList />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 10, gap: 8, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 18, fontWeight: 600 },
  bottom: { flex: 1, flexDirection: 'row', gap: 8 },
});
