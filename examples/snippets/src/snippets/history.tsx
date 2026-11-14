import {
  Pressable,
  Text,
  View,
  useParameter,
  useHistory,
} from '@soundor/react';
import { useEffect, useRef, useState } from 'react';
import { history } from 'soundor:history';
import { parameters } from 'soundor:parameters';

function Button({
  label,
  onPress,
  disabled = false,
  selected = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: selected || pressed ? '#315da8' : '#2a2c33',
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Text style={{ color: '#e6e7ea' }}>{label}</Text>
    </Pressable>
  );
}

export default function History() {
  const gain = useParameter(parameters.gain);
  const voices = useParameter(parameters.voices);
  const bypass = useParameter(parameters.bypass);
  const mode = useParameter(parameters.mode);
  const historyStatus = useHistory();
  const dragging = useRef(false);
  const [isDragging, setDragging] = useState(false);

  const endGesture = () => {
    if (!dragging.current) return;
    dragging.current = false;
    parameters.gain.endGesture();
    setDragging(false);
  };
  useEffect(
    () => () => {
      // Also balance the gesture if the example is replaced while dragging.
      if (dragging.current) parameters.gain.endGesture();
    },
    [],
  );

  const stepGain = (by: number) =>
    parameters.gain.set((current) => current + by, {
      history: { label: 'Adjust Gain' },
    });

  const loadPreset = (warm: boolean) => {
    // Four edits publish together and undo as one entry.
    history.transaction(warm ? 'Load Warm Preset' : 'Load Clean Preset', () => {
      parameters.gain.set(warm ? 0.75 : 0.5);
      parameters.voices.set(warm ? 6 : 4);
      parameters.mode.set(warm ? 'warm' : 'clean');
      parameters.bypass.set(false);
    });
  };

  return (
    <View style={{ width: 340, maxWidth: '100%', gap: 12 }}>
      <Text style={{ color: '#e6e7ea', fontSize: 18 }}>
        Gain {gain.toFixed(2)} · Voices {voices}
      </Text>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Gain"
        accessibilityValue={{ min: 0, max: 1, now: gain }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (event.actionName === 'increment') stepGain(0.05);
          if (event.actionName === 'decrement') stepGain(-0.05);
        }}
        focusable
        onKeyDown={(event) => {
          if (
            ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            stepGain(
              event.key === 'ArrowRight' || event.key === 'ArrowUp'
                ? 0.05
                : -0.05,
            );
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || dragging.current) return;
          // Moves update immediately; release records the entire drag as
          // one entry, alongside the parameter's host automation gesture.
          parameters.gain.beginGesture({ history: { label: 'Adjust Gain' } });
          dragging.current = true;
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (dragging.current)
            parameters.gain.set((current) => current + event.movementX / 340);
        }}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        style={{
          height: 28,
          borderRadius: 6,
          backgroundColor: '#2a2c33',
          cursor: 'ew-resize',
        }}
      >
        <View
          style={{
            width: `${gain * 100}%`,
            height: '100%',
            borderRadius: 6,
            backgroundColor: '#5489e8',
          }}
        />
      </View>
      <Text style={{ color: '#8b8f98' }}>
        Drag gain: one gesture, one undo. Arrow keys step gain.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={{ color: '#8b8f98' }}>Voices</Text>
        <Button
          label="Fewer"
          disabled={voices === 1}
          onPress={() =>
            parameters.voices.set((current) => current - 1, {
              history: { label: 'Remove Voice' },
            })
          }
        />
        <Button
          label="More"
          disabled={voices === 8}
          onPress={() =>
            parameters.voices.set((current) => current + 1, {
              history: { label: 'Add Voice' },
            })
          }
        />
        <Button
          label={bypass ? 'Bypass On' : 'Bypass Off'}
          selected={bypass}
          onPress={() =>
            parameters.bypass.set((current) => !current, {
              history: { label: 'Toggle Bypass' },
            })
          }
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {parameters.mode.info.options.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            selected={mode === option.value}
            onPress={() =>
              parameters.mode.set(option.value, {
                history: { label: 'Change Mode' },
              })
            }
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label="Load Warm Preset"
          disabled={isDragging}
          onPress={() => loadPreset(true)}
        />
        <Button
          label="Load Clean Preset"
          disabled={isDragging}
          onPress={() => loadPreset(false)}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label="Undo"
          disabled={isDragging || !historyStatus.canUndo}
          onPress={historyStatus.undo}
        />
        <Button
          label="Redo"
          disabled={isDragging || !historyStatus.canRedo}
          onPress={historyStatus.redo}
        />
        <Button
          label="Clear history"
          disabled={
            isDragging || (!historyStatus.canUndo && !historyStatus.canRedo)
          }
          onPress={history.clear}
        />
      </View>
      <Text style={{ color: '#8b8f98' }}>
        {isDragging
          ? 'Recording gain gesture…'
          : `Undo: ${historyStatus.undoLabel ?? 'none'}`}
      </Text>
      <Text style={{ color: '#8b8f98' }}>
        Redo: {historyStatus.redoLabel ?? 'none'}
      </Text>
    </View>
  );
}
