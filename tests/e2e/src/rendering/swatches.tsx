import { Image, StyleSheet, Text, View } from '@soundor/react';

import magenta from '../assets/magenta.svg';
import { Panel } from '../ui/panel';
import { swatch, text } from '../ui/theme';
import { CanvasSwatch } from './canvas-swatch';
import { swatchStyle } from './swatch-style';
import { WebglSwatch } from './webgl-swatch';

/** One opaque color drawn by each way the engine draws. */
export function Swatches() {
  return (
    <Panel title="Rendering">
      <View style={styles.row}>
        <View
          debugId="swatch.view"
          accessibilityLabel="View swatch"
          accessible
          style={[swatchStyle, { backgroundColor: swatch.view }]}
        />
        <CanvasSwatch />
        <WebglSwatch />
        <Image
          debugId="swatch.image"
          source={magenta}
          accessibilityLabel="Image swatch"
          style={swatchStyle}
        />
      </View>
      <Text debugId="text.sample" style={text.body}>
        Text: Soundor ÄÖÜ ✓ 0123456789
      </Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
});
