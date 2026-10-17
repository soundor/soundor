import {
  Canvas,
  Text,
  View,
  useParameter,
  type ParameterLike,
} from '@soundor/react';
import { useEffect, useRef, useState } from 'react';
import type { UiNode } from 'soundor:ui';

import { clamp } from './model';

type KnobParameter = ParameterLike<number> & {
  info: { min: number; max: number; default: number };
  set(value: number): void;
  beginGesture(): void;
  endGesture(): void;
};

export function Knob({
  label,
  parameter,
  hint,
  format = (v) => `${Math.round(v * 100)}%`,
}: {
  label: string;
  parameter: KnobParameter;
  hint: string;
  format?: (value: number) => string;
}) {
  const value = useParameter(parameter);
  const node = useRef<UiNode>(null);
  const drag = useRef<{ y: number; value: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const { min, max } = parameter.info;
  const normalized = (value - min) / (max - min);
  const change = (next: number) => parameter.set(clamp(next, min, max));
  const edit = (next: number) => {
    parameter.beginGesture();
    change(next);
    parameter.endGesture();
  };
  const end = () => {
    if (drag.current === null) return;
    drag.current = null;
    parameter.endGesture();
  };
  useEffect(
    () => () => {
      if (drag.current !== null) parameter.endGesture();
    },
    [parameter],
  );
  useEffect(() => {
    const ctx = node.current?.getContext('2d');
    if (!ctx) return;
    const scale = Math.min(2, devicePixelRatio);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, 84, 84);
    const start = Math.PI * 0.75;
    const end = start + Math.PI * 1.5 * normalized;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#cecfc8';
    ctx.beginPath();
    ctx.arc(42, 42, 36, start, Math.PI * 2.25);
    ctx.stroke();
    if (normalized > 0) {
      ctx.strokeStyle = focused ? '#7752bd' : '#5e6260';
      ctx.beginPath();
      ctx.arc(42, 42, 36, start, end);
      ctx.stroke();
    }
    const gradient = ctx.createLinearGradient(10, 8, 72, 78);
    gradient.addColorStop(0, '#3d4142');
    gradient.addColorStop(1, '#191c20');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(42, 42, 29, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#525556';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(42, 42, 28.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#d4f3a4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(42 + Math.cos(end) * 17, 42 + Math.sin(end) * 17);
    ctx.lineTo(42 + Math.cos(end) * 23, 42 + Math.sin(end) * 23);
    ctx.stroke();
  }, [normalized, focused]);
  return (
    <View style={{ alignItems: 'center', width: 113, gap: 0 }}>
      <View
        focusable
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint={`${hint}. Drag vertically, scroll, or use arrow keys. Home resets.`}
        accessibilityValue={{ min, max, now: value, text: format(value) }}
        accessibilityActions={[
          { name: 'increment' },
          { name: 'decrement' },
          { name: 'setValue' },
          { name: 'reset' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.actionName === 'increment') edit(value + (max - min) / 100);
          else if (event.actionName === 'decrement')
            edit(value - (max - min) / 100);
          else if (
            event.actionName === 'setValue' &&
            Number.isFinite(Number(event.value))
          )
            edit(Number(event.value));
          else if (event.actionName === 'reset') edit(parameter.info.default);
          else return;
          event.preventDefault();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          end();
        }}
        onKeyDown={(event) => {
          const step = (max - min) * (event.shiftKey ? 0.1 : 0.01);
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight')
            edit(value + step);
          else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft')
            edit(value - step);
          else if (event.key === 'Home') edit(parameter.info.default);
          else return;
          event.preventDefault();
        }}
        onWheel={(event) => {
          event.preventDefault();
          edit(value - Math.sign(event.deltaY) * (max - min) * 0.02);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { y: event.pageY, value };
          parameter.beginGesture();
        }}
        onPointerMove={(event) => {
          if (drag.current)
            change(
              drag.current.value +
                ((drag.current.y - event.pageY) / 160) * (max - min),
            );
        }}
        onPointerUp={end}
        onPointerCancel={end}
        style={{
          width: 84,
          height: 84,
          borderRadius: 42,
          borderWidth: focused ? 1 : 0,
          borderColor: '#9473ca',
        }}
      >
        <Canvas
          ref={node}
          width={84 * Math.min(2, devicePixelRatio)}
          height={84 * Math.min(2, devicePixelRatio)}
          style={{ width: 84, height: 84, pointerEvents: 'none' }}
        />
      </View>
      <Text
        style={{
          color: '#282d30',
          fontSize: 12,
          fontWeight: 'bold',
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: '#767974',
          fontSize: 11,
          marginTop: 4,
          fontFamily: 'monospace',
        }}
      >
        {format(value)}
      </Text>
    </View>
  );
}
