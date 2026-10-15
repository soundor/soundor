import type { DebugMetrics } from '@soundor/devtools-protocol';
export function metricSummary(
  metrics: DebugMetrics,
): Record<string, string | number> {
  const last = metrics.frames.at(-1);
  const values: Record<string, string | number> = {
    'Rendered frames': metrics.frameCount,
  };
  if (metrics.delayedTicks !== undefined)
    values[
      `Delayed UI ticks${metrics.tickDelayThresholdMs ? ` (>${metrics.tickDelayThresholdMs} ms)` : ''}`
    ] = metrics.delayedTicks;
  if (metrics.tickIntervalMs !== undefined)
    values['Tick interval (ms)'] = metrics.tickIntervalMs.toFixed(2);
  if (last) {
    for (const [name, value] of Object.entries({
      'CPU frame (ms)': last.frameMs,
      'Production (ms)': last.productionMs,
      'Layout (ms)': last.layoutMs,
      'Node raster (ms)': last.rasterMs,
      'Composition (ms)': last.compositionMs,
    }))
      if (value !== undefined) values[name] = value.toFixed(2);
    for (const [name, value] of Object.entries({
      'Frame layers': last.layerCount,
      'Rasterized layers': last.layersRasterized,
      'GPU layers': last.gpuLayers,
      'Uploaded bytes': last.bytesUploaded,
      'GPU layer readbacks': last.gpuReadbacks,
      'Compositor readbacks': last.compositorReadbacks,
      'Draw calls': last.drawCalls,
    }))
      if (value !== undefined) values[name] = value;
    if (last.mode || last.backend)
      values['Compositor'] = [last.mode?.toUpperCase(), last.backend]
        .filter(Boolean)
        .join(' · ');
  } else values['Frame samples'] = 'No rendered frames yet';
  return values;
}
export function mergeMetrics(
  previous: DebugMetrics | undefined,
  metrics: DebugMetrics,
  full = false,
): DebugMetrics {
  if (full || !previous || metrics.frameCount === 0) return metrics;
  const combined = new Map(
    previous.frames.map((frame) => [frame.timestampMs, frame]),
  );
  for (const frame of metrics.frames) combined.set(frame.timestampMs, frame);
  return {
    ...metrics,
    frames: [...combined.values()]
      .sort((a, b) => a.timestampMs - b.timestampMs)
      .slice(-300),
  };
}
