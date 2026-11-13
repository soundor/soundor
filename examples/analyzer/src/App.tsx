// The analyzer's UI: the spectrum and the peak the plugin's audio code
// publishes, read from soundor:native's channels.
//
// The spectrum arrives up to once a frame and is drawn straight into a
// canvas from the channel's subscriber, without rendering React again; the
// peak is React state (useSyncExternalStore), re-rendered as it changes.

import {
  Canvas,
  StyleSheet,
  Text,
  useCanvasSize,
  View,
  type CanvasSize,
} from '@soundor/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { channels } from 'soundor:native';
import type { UiNode } from 'soundor:ui';

import { hold } from './spectrum';

/** How far a bar falls a frame, as a fraction of the height. */
const FALL = 0.02;

function draw(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  bars: Float32Array,
) {
  const width = size.width / size.scaleX;
  const height = size.height / size.scaleY;
  context.setTransform(size.scaleX, 0, 0, size.scaleY, 0, 0);
  context.fillStyle = '#10141f';
  context.fillRect(0, 0, width, height);
  if (bars.length === 0) return;
  const step = width / bars.length;
  const gradient = context.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, '#2dd4bf');
  gradient.addColorStop(0.7, '#facc15');
  gradient.addColorStop(1, '#f87171');
  context.fillStyle = gradient;
  for (let band = 0; band < bars.length; band++) {
    const bar = bars[band]! * height;
    context.fillRect(
      band * step + 0.5,
      height - bar,
      Math.max(step - 1, 1),
      bar,
    );
  }
}

function Spectrum() {
  const canvas = useRef<UiNode>(null);
  const size = useCanvasSize(canvas);
  const bars = useRef<Float32Array>(new Float32Array(0));

  // A resized buffer is blank: draw what there is before it shows.
  useLayoutEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (context && size.width > 0) draw(context, size, bars.current);
  }, [size]);

  // Each new spectrum, drawn as it arrives. A spectrum the UI had no frame
  // for was skipped by the channel, never queued.
  useEffect(() => {
    const show = (spectrum: Float32Array) => {
      bars.current = hold(bars.current, spectrum, FALL);
      const context = canvas.current?.getContext('2d');
      if (context && size.width > 0) draw(context, size, bars.current);
    };
    const latest = channels.spectrum.get();
    if (latest !== undefined) show(latest);
    return channels.spectrum.subscribe(show);
  }, [size]);

  return (
    <Canvas
      ref={canvas}
      style={styles.spectrum}
      accessibilityLabel="Spectrum of the plugin's audio"
    />
  );
}

function Peak() {
  // get and subscribe work unbound, as useSyncExternalStore calls them.
  const peak = useSyncExternalStore(channels.peak.subscribe, channels.peak.get);
  const text = peak === undefined || peak <= -96 ? '-∞' : peak.toFixed(1);
  return (
    <Text style={styles.peak} accessibilityLabel="Peak level">
      Peak {text} dB
    </Text>
  );
}

export function App() {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Analyzer</Text>
        <Peak />
      </View>
      <Spectrum />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12, backgroundColor: '#0b0e17' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { color: '#e5e7eb', fontSize: 20, fontWeight: 'bold' },
  peak: { color: '#9ca3af', fontSize: 14 },
  spectrum: { flex: 1, borderRadius: 6 },
});
