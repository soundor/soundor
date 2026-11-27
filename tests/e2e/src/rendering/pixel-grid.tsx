import { StyleSheet, View } from '@soundor/react';
import { Circle, Svg } from '@soundor/react/svg';

import { colors } from '../ui/theme';

/**
 * Boxes that must stay together on the device-pixel grid, moved off it by a
 * fraction of a logical pixel: a ring centred over a disc, and an `Svg` and
 * a `View` with the same style (issue 405). Rounded each on its own, they
 * drifted a device pixel apart at 125 % and 150 %.
 */
export function PixelGrid() {
  return (
    <View debugId="pixel-grid" style={styles.offset}>
      <View style={styles.centring}>
        <View debugId="pixel-grid.ring" style={styles.ring} />
        <View debugId="pixel-grid.disc" style={styles.disc} />
      </View>
      <View style={styles.box}>
        <Svg
          debugId="pixel-grid.svg"
          width={40}
          height={40}
          viewBox="0 0 40 40"
          style={styles.same}
        >
          <Circle
            cx={20}
            cy={20}
            r={19}
            fill="none"
            stroke={colors.text}
            strokeWidth={2}
          />
        </Svg>
        <View debugId="pixel-grid.view" style={[styles.same, styles.outline]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  offset: { flexDirection: 'row', gap: 14, paddingLeft: 9.4, paddingTop: 9.4 },
  centring: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.text,
  },
  disc: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  box: { width: 30, height: 30 },
  same: { position: 'absolute', left: -5, top: -5, width: 40, height: 40 },
  outline: { borderRadius: 20, borderWidth: 2, borderColor: colors.accent },
});
