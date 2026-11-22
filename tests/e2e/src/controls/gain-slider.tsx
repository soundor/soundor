import { StyleSheet, Text, View, useParameter } from '@soundor/react';
import { useEffect, useRef } from 'react';
import { parameters } from 'soundor:parameters';

import { colors, text } from '../ui/theme';

/** The track's width: dragging across all of it is the whole range. */
export const TRACK = 240;

const gain = parameters.gain;
const { min, max } = gain.info;
const clamp = (value: number) => Math.min(max, Math.max(min, value));

/**
 * Gain as a horizontal slider: drag (one gesture for the host), the wheel,
 * arrow keys (Home restores the default) and the accessibility actions.
 */
export function GainSlider() {
  const value = useParameter(gain);
  const drag = useRef<{ x: number; value: number } | null>(null);
  const end = () => {
    if (drag.current === null) return;
    drag.current = null;
    gain.endGesture();
  };
  useEffect(
    () => () => {
      if (drag.current !== null) gain.endGesture();
    },
    [],
  );
  const set = (next: number) => gain.set(clamp(next));
  const label = `${value.toFixed(2)}x`;
  return (
    <View style={styles.row}>
      <Text style={text.body}>Gain</Text>
      <View
        focusable
        debugId="gain.slider"
        accessibilityRole="adjustable"
        accessibilityLabel="Gain"
        accessibilityValue={{ min, max, now: value, text: label }}
        accessibilityActions={[
          { name: 'increment' },
          { name: 'decrement' },
          { name: 'setValue' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.actionName === 'increment') set(value + 0.1);
          else if (event.actionName === 'decrement') set(value - 0.1);
          else if (event.actionName === 'setValue') set(Number(event.value));
          else return;
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
            set(value + 0.02);
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
            set(value - 0.02);
          else if (event.key === 'Home') set(gain.info.default);
          else return;
          event.preventDefault();
        }}
        onWheel={(event) => {
          event.preventDefault();
          set(value - Math.sign(event.deltaY) * 0.1);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { x: event.pageX, value };
          gain.beginGesture();
        }}
        onPointerMove={(event) => {
          if (drag.current)
            set(
              drag.current.value +
                ((event.pageX - drag.current.x) / TRACK) * (max - min),
            );
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onBlur={end}
        style={styles.track}
      >
        <View
          style={[
            styles.fill,
            { width: ((value - min) / (max - min)) * TRACK },
          ]}
        />
      </View>
      <Text debugId="gain.value" style={text.body}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: {
    width: TRACK,
    height: 16,
    borderRadius: 3,
    backgroundColor: colors.control,
    overflow: 'hidden',
  },
  fill: { height: 16, backgroundColor: colors.accent },
});
