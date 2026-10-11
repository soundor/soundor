// Identical Three.js CPU workloads, alternated between two standalone engines.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { build } from 'tsdown';

const example = path.resolve(import.meta.dirname, '..');
const source = path.join(example, 'scripts/js-engines');
const cache = path.join(example, '.soundor/js-engines');
const pins = JSON.parse(
  readFileSync(path.join(source, 'engines.json'), 'utf8'),
) as {
  hermesRevision: string;
  hermesSha256: string;
};
const quickjsPins = readFileSync(
  path.resolve(
    example,
    '../../runtimes/juce-runtime/native/cmake/SoundorDependencies.cmake',
  ),
  'utf8',
);
const quickjsRevision = /set\(SOUNDOR_QUICKJS_REVISION "([^"]+)"\)/.exec(
  quickjsPins,
)![1]!;
const scenarioIds = ['particles', 'instanced', 'meshes', 'scene-matrices'];
const { values: options } = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    frames: { type: 'string', default: '120' },
    warmup: { type: 'string', default: '30' },
    only: { type: 'string' },
    jobs: { type: 'string', default: '4' },
    'no-build': { type: 'boolean', default: false },
    source: { type: 'boolean', default: false },
    'hermes-source': { type: 'string' },
    'quickjs-source': { type: 'string' },
    out: { type: 'string' },
  },
});
function integer(value: string, name: string, minimum = 1): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum)
    throw new Error(`${name} must be an integer >= ${minimum}`);
  return result;
}
const runs = integer(options.runs!, 'runs');
const frames = integer(options.frames!, 'frames');
const warmup = integer(options.warmup!, 'warmup', 0);
const jobs = integer(options.jobs!, 'jobs');
const scenarios = options.only
  ? [...new Set(options.only.split(',').map((id) => id.trim()))]
  : scenarioIds;
for (const id of scenarios)
  if (!scenarioIds.includes(id)) throw new Error(`Unknown scenario: ${id}`);
mkdirSync(cache, { recursive: true });
function command(binary: string, args: string[]): void {
  const result = spawnSync(binary, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${binary} failed (${result.status ?? result.signal})`);
}
const suffix = process.platform === 'win32' ? '.exe' : '';
const hermesBuild = path.join(cache, 'hermes-build');
const quickjsBuild = path.join(cache, 'quickjs-build');
const hermes = path.join(hermesBuild, 'bin', `hermes${suffix}`);
const hermesc = path.join(hermesBuild, 'bin', `hermesc${suffix}`);
const quickjs = path.join(quickjsBuild, `soundor_bench_js${suffix}`);

if (!options['no-build']) {
  const hermesSource = options['hermes-source']
    ? path.resolve(options['hermes-source'])
    : path.join(cache, `hermes-${pins.hermesRevision}`);
  if (!options['hermes-source']) {
    const archive = path.join(cache, 'hermes.tar.gz');
    if (!existsSync(archive)) {
      console.log(`Downloading Hermes ${pins.hermesRevision}...`);
      const response = await fetch(
        `https://codeload.github.com/facebook/hermes/tar.gz/${pins.hermesRevision}`,
      );
      if (!response.ok)
        throw new Error(`Hermes download failed: HTTP ${response.status}`);
      writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    }
    const hash = createHash('sha256')
      .update(readFileSync(archive))
      .digest('hex');
    if (hash !== pins.hermesSha256)
      throw new Error(
        'Hermes archive hash mismatch; remove .soundor/js-engines/hermes.tar.gz and retry',
      );
    if (!existsSync(hermesSource))
      command('tar', ['-xzf', archive, '-C', cache]);
  }
  command('cmake', [
    '-S',
    hermesSource,
    '-B',
    hermesBuild,
    '-G',
    'Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DHERMES_ENABLE_DEBUGGER=OFF',
    '-DHERMES_ENABLE_TEST_SUITE=OFF',
    '-DHERMES_BUILD_SHARED_JSI=OFF',
    '-DBUILD_SHARED_LIBS=OFF',
  ]);
  command('cmake', [
    '--build',
    hermesBuild,
    '--target',
    'hermes',
    'hermesc',
    '-j',
    String(jobs),
  ]);
  const configure = [
    '-S',
    source,
    '-B',
    quickjsBuild,
    '-G',
    'Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
  ];
  if (options['quickjs-source'])
    configure.push(
      `-DFETCHCONTENT_SOURCE_DIR_SOUNDOR_QUICKJS=${path.resolve(options['quickjs-source'])}`,
    );
  command('cmake', configure);
  command('cmake', [
    '--build',
    quickjsBuild,
    '--target',
    'soundor_bench_js',
    '-j',
    String(jobs),
  ]);
}
for (const binary of [hermes, hermesc, quickjs]) {
  if (!existsSync(binary))
    throw new Error(`Missing ${binary}; run without --no-build first`);
}

await build({
  config: false,
  cwd: example,
  entry: { workload: path.join(source, 'workloads.ts') },
  outDir: path.join(cache, 'bundle'),
  format: 'iife',
  platform: 'neutral',
  target: 'es2015',
  deps: { alwaysBundle: [/.*/] },
  minify: false,
  sourcemap: false,
  dts: false,
  clean: true,
  hash: false,
  report: false,
  publint: false,
  logLevel: 'silent',
  fixedExtension: false,
  outExtensions: () => ({ js: '.js' }),
});
const bundle = readFileSync(
  path.join(cache, 'bundle/workload.iife.js'),
  'utf8',
);
interface Sample {
  scenario: string;
  frames: number;
  elapsedMs: number;
  setupMs: number;
  checksum: number[];
  processMs: number;
}
type Engine = 'quickjs' | 'hermes';
const results: Record<string, Record<Engine, Sample[]>> = {};
async function run(engine: Engine, filename: string): Promise<Sample> {
  const args =
    engine === 'hermes'
      ? options.source
        ? ['-O', '-Xes6-class', filename]
        : ['-Xes6-class', filename]
      : options.source
        ? [filename]
        : ['--bytecode', filename];
  const start = performance.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(engine === 'hermes' ? hermes : quickjs, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8').on('data', (text: string) => {
      output += text;
    });
    child.stderr.setEncoding('utf8').on('data', (text: string) => {
      errors += text;
    });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      if (status !== 0)
        reject(new Error(`${engine} failed: ${errors || signal || status}`));
      else resolve(output);
    });
  });
  const processMs = performance.now() - start;
  const sample = JSON.parse(stdout.trim()) as Sample;
  if (
    sample.frames !== frames ||
    !Number.isFinite(sample.elapsedMs) ||
    sample.elapsedMs <= 0 ||
    !Number.isFinite(sample.setupMs) ||
    !Array.isArray(sample.checksum) ||
    sample.checksum.length === 0 ||
    sample.checksum.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(
      `Invalid ${engine} result; increase --frames if elapsed time rounded to zero`,
    );
  }
  return { ...sample, processMs };
}
function sameChecksum(a: Sample, b: Sample): boolean {
  return (
    a.scenario === b.scenario &&
    a.checksum.length === b.checksum.length &&
    a.checksum.every(
      (value, i) =>
        Math.abs(value - b.checksum[i]!) <=
        1e-7 * Math.max(1, Math.abs(value), Math.abs(b.checksum[i]!)),
    )
  );
}
for (const scenario of scenarios) {
  const js = path.join(cache, `${scenario}.js`);
  const qbc = path.join(cache, `${scenario}.qbc`);
  const hbc = path.join(cache, `${scenario}.hbc`);
  writeFileSync(
    js,
    `var benchOptions = ${JSON.stringify({ scenario, frames, warmup })};\n${bundle}`,
  );
  if (!options.source) {
    command(quickjs, ['--compile', js, qbc]);
    command(hermesc, ['-O', '-Xes6-class', '-emit-binary', '-out', hbc, js]);
  }
  const samples: Record<Engine, Sample[]> = { quickjs: [], hermes: [] };
  results[scenario] = samples;
  for (let round = 0; round < runs; round++) {
    const order: Engine[] =
      round % 2 === 0 ? ['quickjs', 'hermes'] : ['hermes', 'quickjs'];
    for (const engine of order) {
      const sample = await run(
        engine,
        options.source ? js : engine === 'quickjs' ? qbc : hbc,
      );
      const reference = samples.quickjs[0] ?? samples.hermes[0];
      if (
        sample.scenario !== scenario ||
        (reference && !sameChecksum(reference, sample))
      )
        throw new Error(`Output mismatch in ${scenario}: ${engine}`);
      samples[engine].push(sample);
    }
    console.log(`${scenario}: pair ${round + 1}/${runs} verified`);
  }
}
function distribution(samples: Sample[]) {
  const values = samples
    .map((sample) => sample.elapsedMs / frames)
    .sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return {
    medianMs:
      values.length % 2
        ? values[middle]!
        : (values[middle - 1]! + values[middle]!) / 2,
    minMs: values[0]!,
    maxMs: values[values.length - 1]!,
  };
}
const summary = scenarios.map((scenario) => {
  const q = distribution(results[scenario]!.quickjs);
  const h = distribution(results[scenario]!.hermes);
  return {
    scenario,
    quickjs: q,
    hermes: h,
    quickjsOverHermes: q.medianMs / h.medianMs,
    rangesOverlap: q.minMs <= h.maxMs && h.minMs <= q.maxMs,
  };
});
console.table(
  summary.map((row) => ({
    scenario: row.scenario,
    'QuickJS ms/update': row.quickjs.medianMs.toFixed(3),
    'Hermes ms/update': row.hermes.medianMs.toFixed(3),
    'QuickJS/Hermes': `${row.quickjsOverHermes.toFixed(2)}x`,
    'QuickJS range': `${row.quickjs.minMs.toFixed(3)}–${row.quickjs.maxMs.toFixed(3)}`,
    'Hermes range': `${row.hermes.minMs.toFixed(3)}–${row.hermes.maxMs.toFixed(3)}`,
    'ranges overlap': row.rangesOverlap,
  })),
);
const report = {
  date: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  cpu: os.cpus()[0]?.model,
  quickjsRevision,
  hermesRevision: pins.hermesRevision,
  hermesFlags: ['-O', '-Xes6-class'],
  customSources: {
    hermes: options['hermes-source'] ?? null,
    quickjs: options['quickjs-source'] ?? null,
  },
  threeVersion: JSON.parse(
    readFileSync(path.join(example, 'node_modules/three/package.json'), 'utf8'),
  ).version,
  mode: options.source ? 'source' : 'bytecode',
  clock: 'Date.now (1 ms resolution; timed batch divided by frames)',
  runs,
  frames,
  warmup,
  bundleSha256: createHash('sha256').update(bundle).digest('hex'),
  summary,
  results,
};
const output = options.out
  ? path.resolve(options.out)
  : path.join(cache, `report-${Date.now()}.json`);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Report: ${output}`);
