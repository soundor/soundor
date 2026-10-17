import {
  Canvas,
  Text,
  View,
  useAnimationFrame,
  useParameter,
} from '@soundor/react';
import { useEffect, useRef, useState } from 'react';
import { parameters } from 'soundor:parameters';
import type { UiNode } from 'soundor:ui';

import { createFieldRenderer, type FieldRenderer } from './field-renderer';
import { beatLabel, clamp, colors, levels, milliseconds, times } from './model';

function Echo({
  index,
  bpm,
  sync,
}: {
  index: number;
  bpm: number;
  sync: boolean;
}) {
  const time = useParameter(times[index]!);
  const level = useParameter(levels[index]!);
  const [focused, setFocused] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    time: number;
    level: number;
  } | null>(null);
  const color = colors[index]!;
  const label = sync
    ? beatLabel(time)
    : `${Math.round(milliseconds(time, false, bpm))} ms`;
  const updateTime = (value: number) =>
    times[index]!.set(
      clamp(sync ? Math.round(value * 8) / 8 : value, 0.125, 3),
    );
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    times[index]!.endGesture();
    levels[index]!.endGesture();
  };
  useEffect(
    () => () => {
      if (drag.current) {
        times[index]!.endGesture();
        levels[index]!.endGesture();
      }
    },
    [index],
  );
  const step = (direction: number) => {
    times[index]!.beginGesture();
    updateTime(time + direction * 0.125);
    times[index]!.endGesture();
  };
  return (
    <View
      focusable
      accessibilityRole="adjustable"
      accessibilityLabel={`Echo ${index + 1} time`}
      accessibilityHint="Drag horizontally for time and vertically for level. Left and right change time; up and down change level."
      accessibilityValue={{
        min: 0.125,
        max: 3,
        now: time,
        text: `${label}, ${Math.round(level * 100)} percent level`,
      }}
      accessibilityActions={[
        { name: 'increment' },
        { name: 'decrement' },
        { name: 'setValue' },
      ]}
      onAccessibilityAction={(event) => {
        if (event.actionName === 'increment') step(1);
        else if (event.actionName === 'decrement') step(-1);
        else if (
          event.actionName === 'setValue' &&
          Number.isFinite(Number(event.value))
        ) {
          times[index]!.beginGesture();
          updateTime(Number(event.value));
          times[index]!.endGesture();
        } else return;
        event.preventDefault();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        end();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') step(-1);
        else if (event.key === 'ArrowRight') step(1);
        else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          levels[index]!.beginGesture();
          levels[index]!.set(
            clamp(level + (event.key === 'ArrowUp' ? 0.05 : -0.05)),
          );
          levels[index]!.endGesture();
        } else return;
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { x: event.pageX, y: event.pageY, time, level };
        times[index]!.beginGesture();
        levels[index]!.beginGesture();
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        updateTime(
          drag.current.time + ((event.pageX - drag.current.x) / 660) * 3,
        );
        levels[index]!.set(
          clamp(
            drag.current.level +
              (drag.current.y - event.pageY) / ((133 * 332) / 244),
          ),
        );
      }}
      onPointerUp={end}
      onPointerCancel={end}
      style={{
        position: 'absolute',
        left: 46 + (time / 3) * 660 - 21,
        top: ((202 - level * 133) * 332) / 244 - 21,
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 21,
        borderWidth: focused ? 2 : 1,
        borderColor: focused ? '#fff' : `${color}55`,
        backgroundColor: `${color}15`,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <Text style={{ color: '#191c21', fontSize: 11, fontWeight: 'bold' }}>
          {index + 1}
        </Text>
      </View>
      <View
        style={{
          position: 'absolute',
          top: 44,
          width: 100,
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <Text style={{ color, fontFamily: 'monospace', fontSize: 10 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export function EchoField({ bpm, playing }: { bpm: number; playing: boolean }) {
  const canvas = useRef<UiNode>(null);
  const renderer = useRef<FieldRenderer | null>(null);
  const [fallback, setFallback] = useState(false);
  const time1 = useParameter(parameters.time1),
    time2 = useParameter(parameters.time2),
    time3 = useParameter(parameters.time3);
  const level1 = useParameter(parameters.level1),
    level2 = useParameter(parameters.level2),
    level3 = useParameter(parameters.level3);
  const feedback = useParameter(parameters.feedback),
    motion = useParameter(parameters.motion);
  const hold = useParameter(parameters.hold),
    bypass = useParameter(parameters.bypass),
    sync = useParameter(parameters.sync);
  const state = {
    times: [time1, time2, time3],
    levels: [level1, level2, level3],
    feedback,
    motion,
    hold,
    bypass,
    playing,
  };
  const lastDraw = useRef<typeof state | null>(null);
  useEffect(() => {
    lastDraw.current = null;
    if (!canvas.current) return;
    try {
      renderer.current = createFieldRenderer(canvas.current, fallback);
    } catch {
      // The renderer is an external resource; failure needs a fresh 2D canvas.
      // oxlint-disable-next-line react/set-state-in-effect
      setFallback(true);
    }
    return () => {
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [fallback]);
  useAnimationFrame((time) => {
    const previous = lastDraw.current;
    const changed =
      !previous ||
      state.times.some((v, i) => v !== previous.times[i]) ||
      state.levels.some((v, i) => v !== previous.levels[i]) ||
      state.feedback !== previous.feedback ||
      state.motion !== previous.motion ||
      state.hold !== previous.hold ||
      state.bypass !== previous.bypass ||
      state.playing !== previous.playing;
    if (changed || (state.playing && state.motion > 0 && !state.bypass)) {
      renderer.current?.draw(state, time / 1000);
      lastDraw.current = state;
    }
  });
  return (
    <View
      style={{
        width: 752,
        height: 332,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#10121a',
      }}
    >
      <Canvas
        key={String(fallback)}
        ref={canvas}
        width={752 * Math.min(2, devicePixelRatio)}
        height={332 * Math.min(2, devicePixelRatio)}
        style={{
          width: 752,
          height: 332,
          position: 'absolute',
          pointerEvents: 'none',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 22,
          top: 17,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: hold ? '#bce977' : '#a99cc2',
          }}
        />
        <Text style={{ color: '#acabb9', fontSize: 9, letterSpacing: 1.8 }}>
          {hold ? 'LOOP HELD' : 'ECHO MAP'}
        </Text>
      </View>
      <Text
        style={{
          position: 'absolute',
          right: 22,
          top: 17,
          color: '#747584',
          fontSize: 9,
          letterSpacing: 0.8,
        }}
      >
        DRAG TO SHAPE THE REPEATS
      </Text>
      {[0, 1, 2].map((index) => (
        <Echo key={index} index={index} bpm={bpm} sync={sync} />
      ))}
      {[0, 1, 2, 3].map((beat) => (
        <Text
          key={beat}
          style={{
            position: 'absolute',
            left: 39 + (beat / 3) * 660,
            bottom: 14,
            color: '#737581',
            fontFamily: 'monospace',
            fontSize: 9,
          }}
        >
          {sync ? `${beat} beat${beat === 1 ? '' : 's'}` : `${beat * 500} ms`}
        </Text>
      ))}
    </View>
  );
}
