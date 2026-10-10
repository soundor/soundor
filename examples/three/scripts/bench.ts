// The Three.js benchmark in the JUCE runtime, headless: builds the UI bundle
// and soundor_run_ui (the native `bench` preset, Release), runs every scene
// several times, and prints the median of each measure with its spread
// across runs.
//
//   pnpm bench [--runs 5] [--frames 120] [--warmup 30] [--size 700x480]
//              [--backend vulkan|opengl|metal|d3d11] [--software]
//              [--save <name>] [--against <name>] [--baseline <report.json>]
//              [--threshold 3] [--check] [--out <report.json>] [--no-build]
//
// Comparing: --save keeps this build (soundor_run_ui and the UI bundle) under
// .soundor/bench/builds/<name>; --against runs a saved build and this one
// alternately in the same session and compares them. That is the comparison
// to trust: a machine drifts by several percent between sessions (heat, other
// load), which an earlier report (--baseline) cannot tell from a change.
// Differences smaller than both sides' spread, or than --threshold percent,
// are not marked. --check exits with 1 when something got worse.
//
// Every report goes to .soundor/bench/ (and to --out).

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const example = path.resolve(import.meta.dirname, '..');
const native = path.resolve(example, '../../runtimes/juce-runtime/native');

const { values: options } = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    frames: { type: 'string', default: '120' },
    warmup: { type: 'string', default: '30' },
    size: { type: 'string', default: '700x480' },
    backend: { type: 'string' },
    software: { type: 'boolean', default: false },
    save: { type: 'string' },
    against: { type: 'string' },
    baseline: { type: 'string' },
    threshold: { type: 'string', default: '3' },
    check: { type: 'boolean', default: false },
    out: { type: 'string' },
    'no-build': { type: 'boolean', default: false },
  },
});

const runs = Number(options.runs);
const frames = Number(options.frames);
const warmup = Number(options.warmup);
const threshold = Number(options.threshold);

/** soundor_run_ui's --json report (see tests/tools/RunUi.cpp). */
interface Distribution {
  mean: number;
  p50: number;
  p95: number;
  max: number;
}
interface Phase {
  name: string;
  frames: number;
  fps: number;
  frameMs: Distribution;
  tickMs: Distribution;
  buildMs: Distribution;
  compositeMs: Distribution;
  layersRasterized: number;
  gpuReadbacks: number;
  bytesUploaded: number;
  textureAllocations: number;
}
/** What the benchmark's soundorBenchmark.run() resolves to, per scene. */
interface SceneResult {
  scene: string;
  updateAverage: number;
  renderAverage: number;
  drawCalls: number;
  triangles: number;
}
interface RunReport {
  device: {
    backend: string;
    renderer: string;
    vendor: string;
    software: boolean;
  };
  outcome: string;
  phases: Phase[];
  value: SceneResult[] | null;
}

/** The measures compared between runs, per scene. */
const MEASURES = {
  frame: { label: 'frame ms', unit: 'ms', timing: true },
  frameP95: { label: 'p95', unit: 'ms', timing: true },
  tick: { label: 'tick', unit: 'ms', timing: true },
  build: { label: 'build', unit: 'ms', timing: true },
  composite: { label: 'composite', unit: 'ms', timing: true },
  update: { label: 'update', unit: 'ms', timing: true },
  render: { label: 'render', unit: 'ms', timing: true },
  fps: { label: 'fps', unit: '', timing: false },
  readbacks: { label: 'read-backs/f', unit: '', timing: false },
  rasterized: { label: 'rasterized/f', unit: '', timing: false },
  uploadedKB: { label: 'uploaded KB/f', unit: 'KB', timing: false },
  drawCalls: { label: 'draw calls', unit: '', timing: false },
} as const;
type Measure = keyof typeof MEASURES;

interface Statistic {
  median: number;
  min: number;
  max: number;
  /** Half the range across runs, relative to the median, in percent. */
  spread: number;
}
type Summary = Record<string, Record<Measure, Statistic>>;

interface Report {
  schema: 1;
  environment: {
    commit: string;
    dirty: boolean;
    date: string;
    backend: string;
    renderer: string;
    software: boolean;
    cpu: string;
    cores: number;
    platform: string;
  };
  config: { runs: number; frames: number; warmup: number; size: string };
  summary: Summary;
  runs: RunReport[];
  /** The saved build run alternately with this one (--against). */
  against?: { name: string; build: BuildInfo; summary: Summary };
}

/** A build of soundor_run_ui and the UI bundle, and where it came from. */
interface Build {
  runner: string;
  ui: string;
  info: BuildInfo;
}
interface BuildInfo {
  commit: string;
  dirty: boolean;
  date: string;
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  }
}

function git(...args: string[]): string {
  const result = spawnSync('git', args, { cwd: example, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function findRunner(): string {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const candidates = [
    path.join(native, 'build/bench/tests', `soundor_run_ui${exe}`),
    // Visual Studio puts each configuration in a directory of its own.
    path.join(native, 'build/bench/tests/Release', `soundor_run_ui${exe}`),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `soundor_run_ui not found; build it with \`cmake --workflow --preset bench\` in ${native}`,
    );
  }
  return found;
}

function statistic(values: number[]): Statistic {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const min = sorted[0]!;
  const max = sorted.at(-1)!;
  return {
    median,
    min,
    max,
    spread: median === 0 ? 0 : ((max - min) / 2 / Math.abs(median)) * 100,
  };
}

function measures(phase: Phase, scene: SceneResult | undefined) {
  const perFrame = (value: number) =>
    phase.frames > 0 ? value / phase.frames : 0;
  return {
    frame: phase.frameMs.mean,
    frameP95: phase.frameMs.p95,
    tick: phase.tickMs.mean,
    build: phase.buildMs.mean,
    composite: phase.compositeMs.mean,
    update: scene?.updateAverage ?? 0,
    render: scene?.renderAverage ?? 0,
    fps: phase.fps,
    readbacks: perFrame(phase.gpuReadbacks),
    rasterized: perFrame(phase.layersRasterized),
    uploadedKB: perFrame(phase.bytesUploaded) / 1024,
    drawCalls: scene?.drawCalls ?? 0,
  } satisfies Record<Measure, number>;
}

function summarize(reports: RunReport[]): Summary {
  const scenes = reports[0]!.phases.map((phase) => phase.name);
  const summary: Summary = {};
  for (const name of scenes) {
    const perRun = reports.map((report) => {
      const phase = report.phases.find((candidate) => candidate.name === name);
      if (!phase) throw new Error(`a run has no phase "${name}"`);
      return measures(
        phase,
        report.value?.find((result) => result.scene === name),
      );
    });
    summary[name] = Object.fromEntries(
      (Object.keys(MEASURES) as Measure[]).map((measure) => [
        measure,
        statistic(perRun.map((values) => values[measure])),
      ]),
    ) as Record<Measure, Statistic>;
  }
  return summary;
}

function format(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === 0
            ? cell.padEnd(widths[column]!)
            : cell.padStart(widths[column]!),
        )
        .join('  '),
    )
    .join('\n');
}

function printSummary(summary: Summary): void {
  const measuresShown = Object.keys(MEASURES) as Measure[];
  const rows = [
    ['scene', ...measuresShown.map((measure) => MEASURES[measure].label)],
  ];
  for (const [scene, values] of Object.entries(summary)) {
    rows.push([
      scene,
      ...measuresShown.map((measure) => {
        const { median, spread } = values[measure];
        return MEASURES[measure].timing
          ? `${format(median)} ±${spread.toFixed(0)}%`
          : format(median);
      }),
    ]);
  }
  console.log(table(rows));
}

/** What changed from `before` to `now`: the rows, and whether anything got worse. */
function compare(
  now: Summary,
  before: Summary,
): { rows: string[][]; regressed: boolean } {
  const rows = [['scene', 'measure', 'before', 'now', 'change', 'noise', '']];
  let regressed = false;
  for (const [scene, values] of Object.entries(now)) {
    const previous = before[scene];
    if (!previous) continue;
    for (const measure of Object.keys(MEASURES) as Measure[]) {
      if (measure === 'fps' || measure === 'drawCalls') continue;
      const after = values[measure];
      const then = previous[measure];
      if (then.median === 0 && after.median === 0) continue;
      const change =
        then.median === 0
          ? Infinity
          : ((after.median - then.median) / then.median) * 100;
      // A difference counts when it is larger than both sides' spread and
      // the threshold (1% for counts, which do not depend on timing); work
      // that appears from nothing always counts.
      const noise = Math.max(
        MEASURES[measure].timing ? threshold : 1,
        after.spread + then.spread,
      );
      const significant = Math.abs(change) > noise;
      const worse = change > 0;
      if (significant && worse) regressed = true;
      rows.push([
        scene,
        MEASURES[measure].label,
        format(then.median),
        format(after.median),
        Number.isFinite(change)
          ? `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
          : 'new',
        `±${noise.toFixed(0)}%`,
        significant ? (worse ? 'WORSE' : 'better') : '',
      ]);
    }
  }
  return { rows, regressed };
}

function differences(current: Report, baseline: Report): string[] {
  const problems: string[] = [];
  const a = current.environment;
  const b = baseline.environment;
  if (a.renderer !== b.renderer) {
    problems.push(`renderer: ${b.renderer} → ${a.renderer}`);
  }
  if (a.cpu !== b.cpu) problems.push(`CPU: ${b.cpu} → ${a.cpu}`);
  for (const key of ['frames', 'warmup', 'size'] as const) {
    if (current.config[key] !== baseline.config[key]) {
      problems.push(`${key}: ${baseline.config[key]} → ${current.config[key]}`);
    }
  }
  return problems;
}

function describeBuild(info: BuildInfo): string {
  return `${info.commit || 'unknown'}${info.dirty ? ' (uncommitted changes)' : ''}`;
}

/** One run of `build`: soundor_run_ui's report. */
function runOnce(build: Build, scratch: string, index: number): RunReport {
  const file = path.join(scratch, `run-${index}.json`);
  const args = [
    build.ui,
    '--size',
    options.size,
    '--eval',
    `soundorBenchmark.run(${frames}, ${warmup})`,
    '--json',
    file,
  ];
  if (options.backend) args.push('--backend', options.backend);
  if (options.software) args.push('--software');
  const result = spawnSync(build.runner, args, { encoding: 'utf8' });
  if (result.status !== 0 || !existsSync(file)) {
    console.error(result.stderr.split('\n').slice(-20).join('\n'));
    throw new Error(
      `soundor_run_ui failed (${result.status ?? result.signal})`,
    );
  }
  return JSON.parse(readFileSync(file, 'utf8')) as RunReport;
}

// --- main ---

const bench = path.join(example, '.soundor/bench');
if (!options['no-build']) {
  console.log('Building the UI bundle and soundor_run_ui (Release)…');
  run('soundor', ['build', 'web'], example);
  run('cmake', ['--workflow', '--preset', 'bench'], native);
}
const current: Build = {
  runner: findRunner(),
  ui: path.join(example, '.soundor/ui/production'),
  info: {
    commit: git('rev-parse', '--short', 'HEAD'),
    dirty: git('status', '--porcelain').length > 0,
    date: new Date().toISOString(),
  },
};

if (options.save) {
  const directory = path.join(bench, 'builds', options.save);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const runner = path.join(directory, path.basename(current.runner));
  cpSync(current.runner, runner);
  cpSync(current.ui, path.join(directory, 'ui'), { recursive: true });
  writeFileSync(
    path.join(directory, 'build.json'),
    `${JSON.stringify(current.info, null, 2)}\n`,
  );
  console.log(`Saved this build as "${options.save}".`);
}

let against: Build | null = null;
if (options.against) {
  const directory = path.join(bench, 'builds', options.against);
  const exe = process.platform === 'win32' ? '.exe' : '';
  if (!existsSync(path.join(directory, 'build.json'))) {
    throw new Error(
      `no saved build "${options.against}" (save one with --save ${options.against})`,
    );
  }
  against = {
    runner: path.join(directory, `soundor_run_ui${exe}`),
    ui: path.join(directory, 'ui'),
    info: JSON.parse(
      readFileSync(path.join(directory, 'build.json'), 'utf8'),
    ) as BuildInfo,
  };
  console.log(
    `Against "${options.against}": ${describeBuild(against.info)}, built ${against.info.date}`,
  );
}

const reports: RunReport[] = [];
const againstReports: RunReport[] = [];
const scratch = mkdtempSync(path.join(os.tmpdir(), 'soundor-bench-'));
try {
  for (let index = 0; index < runs; index++) {
    const started = Date.now();
    // Alternating which goes first spreads a drift over both.
    if (against && index % 2 === 0) {
      againstReports.push(runOnce(against, scratch, index * 2));
    }
    const report = runOnce(current, scratch, index * 2 + 1);
    reports.push(report);
    if (against && index % 2 === 1) {
      againstReports.push(runOnce(against, scratch, index * 2));
    }
    if (index === 0) {
      console.log(
        `Device: ${report.device.backend}, ${report.device.renderer}`,
      );
    }
    console.log(
      `run ${index + 1}/${runs}: ${((Date.now() - started) / 1000).toFixed(0)} s`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const report: Report = {
  schema: 1,
  environment: {
    commit: current.info.commit,
    dirty: current.info.dirty,
    date: current.info.date,
    backend: reports[0]!.device.backend,
    renderer: reports[0]!.device.renderer,
    software: reports[0]!.device.software,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.availableParallelism(),
    platform: `${process.platform} ${os.release()}`,
  },
  config: { runs, frames, warmup, size: options.size },
  summary: summarize(reports),
  runs: reports,
};
if (against) {
  report.against = {
    name: options.against!,
    build: against.info,
    summary: summarize(againstReports),
  };
}

console.log();
printSummary(report.summary);

mkdirSync(bench, { recursive: true });
const saved = path.join(
  bench,
  `${current.info.date.replaceAll(':', '-')}-${current.info.commit || 'unknown'}.json`,
);
const text = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(saved, text);
if (options.out) writeFileSync(path.resolve(options.out), text);
console.log(`\nReport: ${path.relative(process.cwd(), saved)}`);

let regressed = false;
if (report.against) {
  console.log(
    `\nThis build (${describeBuild(current.info)}) against "${report.against.name}" (${describeBuild(report.against.build)}), run alternately:`,
  );
  const compared = compare(report.summary, report.against.summary);
  console.log(table(compared.rows));
  regressed ||= compared.regressed;
}
if (options.baseline) {
  const baseline = JSON.parse(
    readFileSync(path.resolve(options.baseline), 'utf8'),
  ) as Report;
  console.log(
    `\nAgainst the report from ${baseline.environment.date} (${describeBuild(baseline.environment)}); between sessions, expect drift of several percent:`,
  );
  for (const problem of differences(report, baseline)) {
    console.log(`  not comparable: ${problem}`);
  }
  const compared = compare(report.summary, baseline.summary);
  console.log(table(compared.rows));
  regressed ||= compared.regressed;
}
if (options.check && regressed) {
  console.log('\nSomething got worse.');
  process.exitCode = 1;
}
