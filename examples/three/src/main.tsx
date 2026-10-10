// A Three.js benchmark: unmodified Three.js on a Soundor canvas, the same code
// in the JUCE runtime (WebGL 2 on ANGLE, composited without copies) and in
// the browser. Pick a scene to watch it with live statistics, or run them
// all for a table of results.

import {
  Canvas,
  Pressable,
  render,
  StyleSheet,
  Text,
  View,
  type StyleProp,
} from '@soundor/react';
import { useEffect, useRef, useState } from 'react';
import type { UiNode } from 'soundor:ui';
import * as THREE from 'three';

import { SCENES, type BenchScene, type SceneEntry } from './scenes';

const WIDTH = 640;
const HEIGHT = 360;
/** Frames between updates of the live statistics (4 per second at 60 fps). */
const STATS_INTERVAL = 15;

/** What one scene cost over a run of frames. */
interface Result {
  scene: string;
  frames: number;
  fps: number;
  /** CPU time spent per frame in update() and render(), in milliseconds. */
  cpuAverage: number;
  cpuP95: number;
  /** ... of which in update() (the scene's own JavaScript). */
  updateAverage: number;
  /** ... and in render() (Three, and the WebGL calls it makes). */
  renderAverage: number;
  drawCalls: number;
  triangles: number;
}

/** Frame timings, kept for one scene. */
class Meter {
  cpu: number[] = [];
  update: number[] = [];
  intervals: number[] = [];
  last = 0;

  add(update: number, render: number, now: number): void {
    this.cpu.push(update + render);
    this.update.push(update);
    if (this.last > 0) this.intervals.push(now - this.last);
    this.last = now;
    if (this.cpu.length > 600) this.cpu.shift();
    if (this.update.length > 600) this.update.shift();
    if (this.intervals.length > 600) this.intervals.shift();
  }

  summary(
    scene: string,
    info: THREE.WebGLInfo,
    frames = this.cpu.length,
  ): Result {
    const cpu = [...this.cpu].sort((a, b) => a - b);
    const average = (values: number[]) =>
      values.length === 0
        ? 0
        : values.reduce((sum, value) => sum + value, 0) / values.length;
    const interval = average(this.intervals);
    const update = average(this.update);
    return {
      scene,
      frames,
      fps: interval > 0 ? 1000 / interval : 0,
      cpuAverage: average(cpu),
      cpuP95: cpu[Math.min(cpu.length - 1, Math.floor(cpu.length * 0.95))] ?? 0,
      updateAverage: update,
      renderAverage: average(cpu) - update,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
    };
  }
}

/** Drives the renderer: one scene at a time, measured every frame. */
class Bench {
  readonly renderer: THREE.WebGLRenderer;
  current: { entry: SceneEntry; scene: BenchScene } | null = null;
  meter = new Meter();
  started = 0;
  /** Called after each frame (for a run of the whole suite). */
  onFrame: (() => void) | null = null;
  /**
   * Called every STATS_INTERVAL frames, for the live statistics: counted in
   * frames, not time, so that what the UI redraws per frame does not depend
   * on how fast the scene runs.
   */
  onStats: (() => void) | null = null;
  frames = 0;

  constructor(canvas: UiNode, pixelRatio: number) {
    // A Soundor canvas node stands where Three expects an HTML canvas.
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      antialias: true,
    });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.shadowMap.enabled = true;
    // Counted per frame (post-processing renders twice), not per render().
    this.renderer.info.autoReset = false;
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  show(entry: SceneEntry): void {
    this.current?.scene.dispose();
    const scene = entry.create(this.renderer);
    scene.camera.aspect = WIDTH / HEIGHT;
    scene.camera.updateProjectionMatrix();
    this.current = { entry, scene };
    this.meter = new Meter();
    this.started = performance.now();
  }

  frame(time: number): void {
    if (this.current === null) return;
    const { scene } = this.current;
    this.renderer.info.reset();
    const begin = performance.now();
    scene.update((time - this.started) / 1000);
    const updated = performance.now();
    if (scene.render) scene.render(this.renderer);
    else this.renderer.render(scene.scene, scene.camera);
    const end = performance.now();
    this.meter.add(updated - begin, end - updated, end);
    if (++this.frames % STATS_INTERVAL === 0) this.onStats?.();
    this.onFrame?.();
  }

  result(): Result {
    return this.meter.summary(this.current?.entry.id ?? '', this.renderer.info);
  }

  /** Every scene for `frames` frames after `warmup`: the results, in order. */
  runAll(frames = 120, warmup = 30): Promise<Result[]> {
    const results: Result[] = [];
    let index = -1;
    let count = 0;
    return new Promise((resolve) => {
      const next = () => {
        index++;
        globalThis.soundorRunUiPhase = undefined;
        if (index >= SCENES.length) {
          this.onFrame = null;
          resolve(results);
          return;
        }
        this.show(SCENES[index]!);
        count = 0;
      };
      this.onFrame = () => {
        count++;
        // The warm-up (compiling shaders, first uploads) is not measured.
        // soundor_run_ui reports its own timings of these frames per phase.
        if (count === warmup) {
          this.meter = new Meter();
          globalThis.soundorRunUiPhase = SCENES[index]!.id;
        }
        if (count === warmup + frames) {
          results.push(this.result());
          next();
        }
      };
      next();
    });
  }
}

declare global {
  // For headless runs: soundorBenchmark.run() resolves to the results.
  var soundorBenchmark:
    | { run(frames?: number, warmup?: number): Promise<Result[]> }
    | undefined;
  // What soundor_run_ui reports the frames under (a scene being measured).
  var soundorRunUiPhase: string | undefined;
}

function Button({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) =>
        [
          styles.button,
          active && styles.buttonActive,
          hovered && styles.buttonHovered,
          pressed && styles.buttonPressed,
        ] as StyleProp
      }
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const format = (value: number, digits = 1) => value.toFixed(digits);

function App() {
  const canvas = useRef<UiNode>(null);
  const bench = useRef<Bench | null>(null);
  const [scene, setScene] = useState(SCENES[0]!.id);
  const [live, setLive] = useState<Result | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scale = Math.max(1, Math.round(devicePixelRatio));

  useEffect(() => {
    const node = canvas.current;
    if (node === null) return;
    if (node.getContext('webgl2') === null) {
      setError('No GPU for WebGL here');
      return;
    }
    const created = new Bench(node, scale);
    bench.current = created;
    created.show(SCENES[0]!);
    globalThis.soundorBenchmark = {
      run: async (frames, warmup) => {
        const all = await created.runAll(frames, warmup);
        console.log(`soundor-three-benchmark ${JSON.stringify(all)}`);
        return all;
      },
    };
    created.onStats = () => setLive(created.result());
    return () => {
      created.onStats = null;
      created.renderer.setAnimationLoop(null);
      created.current?.scene.dispose();
      created.renderer.dispose();
      globalThis.soundorBenchmark = undefined;
    };
  }, [scale]);

  const pick = (entry: SceneEntry) => {
    setScene(entry.id);
    bench.current?.show(entry);
  };

  const runAll = async () => {
    if (bench.current === null || running) return;
    setRunning(true);
    setResults(await globalThis.soundorBenchmark!.run());
    setRunning(false);
    pick(SCENES.find((entry) => entry.id === scene) ?? SCENES[0]!);
  };

  const entry = SCENES.find((each) => each.id === scene)!;
  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Text style={styles.title}>Three.js on Soundor</Text>
        {SCENES.map((each) => (
          <Button
            key={each.id}
            label={each.label}
            active={each.id === scene && !running}
            onPress={() => pick(each)}
          />
        ))}
        <Button label={running ? 'Running…' : 'Run all'} onPress={runAll} />
      </View>
      <Canvas
        ref={canvas}
        width={WIDTH * scale}
        height={HEIGHT * scale}
        style={styles.canvas}
        accessibilityLabel={`The ${entry.label} benchmark scene`}
      />
      <Text style={styles.caption}>
        {error ??
          (live
            ? `${entry.label}: ${entry.stresses} · ${format(live.fps, 0)} fps · CPU ${format(live.cpuAverage)} ms (p95 ${format(live.cpuP95)}) · ${live.drawCalls} draw calls · ${live.triangles.toLocaleString()} triangles`
            : entry.stresses)}
      </Text>
      {results && (
        <View style={styles.table}>
          <Text style={styles.row}>
            {'scene        fps    CPU ms   p95 ms   draws   triangles'}
          </Text>
          {results.map((result) => (
            <Text key={result.scene} style={styles.row}>
              {`${result.scene.padEnd(12)} ${format(result.fps, 0).padStart(4)} ${format(result.cpuAverage, 2).padStart(8)} ${format(result.cpuP95, 2).padStart(8)} ${String(result.drawCalls).padStart(7)} ${String(result.triangles).padStart(11)}`}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111317', padding: 16, gap: 10 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#f2f3f5', fontSize: 16, fontWeight: 'bold', marginRight: 8 },
  button: {
    backgroundColor: '#2a2d35',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  buttonActive: { backgroundColor: '#3b6fd8' },
  buttonHovered: { backgroundColor: '#363a44' },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { color: '#f2f3f5', fontSize: 12 },
  canvas: { width: WIDTH, height: HEIGHT, borderRadius: 8 },
  caption: { color: '#a8adb8', fontSize: 12 },
  table: { backgroundColor: '#1a1d23', borderRadius: 6, padding: 8, gap: 2 },
  row: { color: '#d5d8de', fontSize: 12, fontFamily: 'monospace' },
});

render(<App />);
