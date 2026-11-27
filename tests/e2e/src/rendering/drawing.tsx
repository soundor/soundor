import { StyleSheet, View } from '@soundor/react';
import { Circle, Svg } from '@soundor/react/svg';
import type { ReactNode } from 'react';

import { colors } from '../ui/theme';
import { type DrawingTile, drawingTiles } from './drawing-tiles';

const ink = colors.text;
const box = { width: 16, height: 16 };

const styles = StyleSheet.create({
  // Placed by numbers, over the Rendering panel, rather than after
  // anything with text in it: each runtime measures text its own way, which
  // would start the tiles a fraction of a pixel apart in each.
  tiles: {
    position: 'absolute',
    left: 360.3,
    top: 68.3,
    width: 8 * 22 + 7 * 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  tile: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  nest: { paddingLeft: 0.3, paddingTop: 0.3 },
});

/**
 * One tile for each thing the engine paints, text aside, at sizes that are
 * not whole device pixels at 125 %: the native renderer and the browser
 * must draw each the same (e2e/vst3/drawing.test.ts compares them).
 */
const drawn: Record<DrawingTile, ReactNode> = {
  'border 0.5': <View style={[box, { borderWidth: 0.5, borderColor: ink }]} />,
  'border 1': <View style={[box, { borderWidth: 1, borderColor: ink }]} />,
  'border 1.5': <View style={[box, { borderWidth: 1.5, borderColor: ink }]} />,
  'border 2, radius 5': (
    <View
      style={[box, { borderWidth: 2, borderRadius: 5, borderColor: ink }]}
    />
  ),
  ring: (
    <View
      style={[box, { borderWidth: 2, borderRadius: 8, borderColor: ink }]}
    />
  ),
  'radius 4.3': (
    <View style={[box, { borderRadius: 4.3, backgroundColor: ink }]} />
  ),
  outline: (
    <View
      style={{
        width: 10,
        height: 10,
        backgroundColor: colors.control,
        outlineWidth: 1.5,
        outlineOffset: 1.5,
        outlineColor: ink,
      }}
    />
  ),
  shadow: (
    <View
      style={{
        width: 12,
        height: 12,
        backgroundColor: ink,
        boxShadow: [{ offsetX: 0, offsetY: 1, blur: 3, color: 'black' }],
      }}
    />
  ),
  'inset shadow': (
    <View
      style={[
        box,
        {
          backgroundColor: colors.muted,
          boxShadow: [
            { offsetX: 0, offsetY: 1, blur: 3, color: 'black', inset: true },
          ],
        },
      ]}
    />
  ),
  opacity: <View style={[box, { backgroundColor: ink, opacity: 0.5 }]} />,
  translate: (
    <View
      style={[
        box,
        {
          backgroundColor: ink,
          transform: [{ translateX: 0.3 }, { translateY: 0.3 }],
        },
      ]}
    />
  ),
  rotate: (
    <View
      style={{
        width: 14,
        height: 10,
        backgroundColor: ink,
        transform: [{ rotate: '10deg' }],
      }}
    />
  ),
  scale: (
    <View
      style={{
        width: 14,
        height: 10,
        backgroundColor: ink,
        transform: [{ scale: 1.1 }],
      }}
    />
  ),
  clip: (
    <View
      style={[
        box,
        {
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: colors.control,
        },
      ]}
    >
      <View style={{ width: 16, height: 8, backgroundColor: ink }} />
    </View>
  ),
  svg: (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Circle cx={9} cy={9} r={8} fill="none" stroke={ink} strokeWidth={1.5} />
    </Svg>
  ),
  nested: (
    // Each box a fraction of a pixel into the last: where they land is
    // added up level by level, by the browser in 1/64 px.
    <View style={styles.nest}>
      <View style={styles.nest}>
        <View style={styles.nest}>
          <View style={styles.nest}>
            <View style={styles.nest}>
              <View style={[box, { backgroundColor: ink }]} />
            </View>
          </View>
        </View>
      </View>
    </View>
  ),
};

/** The tiles, two rows of them, starting between device pixels. */
export function Drawing() {
  return (
    <View debugId="drawing" style={styles.tiles}>
      {drawingTiles.map((name, index) => (
        <View
          key={name}
          debugId={`drawing.${index}`}
          accessibilityLabel={name}
          style={styles.tile}
        >
          {drawn[name]}
        </View>
      ))}
    </View>
  );
}
