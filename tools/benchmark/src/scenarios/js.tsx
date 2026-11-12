// JavaScript-only scenarios: the frame's JavaScript is pure computation, and
// the only native work is one small cell's opacity (so frames are real and
// the run reports GCs and heap alongside the times). The `JS` column is what
// the interpreter charged; `frame ms` adds the cell. The group exists to
// compare Hermes versions: build the engine with each revision, save both
// builds, then `pnpm bench --only js --against <old build>`.
// Each scenario builds its own fixtures when it mounts (during warm-up), so
// nothing here costs startup. The promise scenario's callbacks settle between
// frames: their drain lands in `tick`, not in the frame.

import { Text, View } from '@soundor/react';
import { useEffect, useRef } from 'react';
import type { UiNode } from 'soundor:ui';

import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type FrameFunction,
  type Scenario,
  type StageProps,
} from './types';

/** Consumed by every frame, so no loop can be folded away. */
let sink = 0;

/** Deterministic randomness: a linear congruential generator over 24 bits. */
function lcg(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 8) / 0x1000000;
  };
}

function scenario(
  id: string,
  label: string,
  stresses: string,
  makeFrame: () => FrameFunction,
): Scenario {
  return {
    id: `js-${id}`,
    group: 'js',
    label,
    stresses,
    Stage: stage(label, stresses, makeFrame),
  };
}

function stage(
  title: string,
  stresses: string,
  makeFrame: () => FrameFunction,
) {
  return function Stage({ register }: StageProps) {
    const cell = useRef<UiNode | null>(null);
    useEffect(() => {
      let frames = 0;
      const frame = makeFrame();
      register((time) => {
        const node = cell.current;
        if (node) node.style.opacity = 0.35 + 0.65 * ((frames++ % 60) / 60);
        frame(time);
      });
    }, [register]);
    const cells = [];
    for (let i = 0; i < 12; i++) {
      cells.push(
        <View
          key={i}
          ref={
            i === 0
              ? (node) => {
                  cell.current = node;
                }
              : undefined
          }
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            backgroundColor: `hsl(${i * 30}, 65%, 55%)`,
          }}
        />,
      );
    }
    return (
      <View
        style={{
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          padding: 12,
          gap: 8,
        }}
      >
        <Text style={{ color: '#e6e8ee', fontSize: 15 }}>{title}</Text>
        <Text style={{ color: '#a8adb8', fontSize: 12 }}>{stresses}</Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>{cells}</View>
      </View>
    );
  };
}

// ---------------------------------------------------------------- dispatch

/** Tight numeric loops, integer and float: opcode dispatch, no allocation. */
function dispatchFrame(): FrameFunction {
  return () => {
    let a = 0x1234567;
    let b = 0x9e3779b9;
    let acc = 0;
    for (let i = 0; i < 180_000; i++) {
      a = (a * 1664525 + 1013904223) | 0;
      b = (b ^ (a >>> 3)) | 0;
      acc += (a & 0xffff) + Math.sqrt(b >>> 16);
    }
    for (let i = 0; i < 55_000; i++) {
      acc += Math.sin(i * 1e-4) * Math.cos(i * 2e-4);
    }
    sink += acc;
  };
}

// ------------------------------------------------------------ alloc-small

/** 80,000 short-lived objects per frame: allocation fast path and GC. */
function allocSmallFrame(): FrameFunction {
  return () => {
    interface Hot {
      a: number;
      b: number;
      c: number;
    }
    const batch = new Array<Hot>(80_000);
    for (let i = 0; i < 80_000; i++) {
      batch[i] = { a: (i * 7) % 97, b: (i * 13) % 89, c: (i * 3) % 71 };
    }
    let sum = 0;
    for (let i = 0; i < 80_000; i += 5) sum += batch[i]!.a + batch[i]!.c;
    sink += sum;
  };
}

// ------------------------------------------------------------------- props

type Loose = Record<string, number | undefined>;

interface Hot {
  a: number;
  b: number;
  c: number;
}

/** Property access across shapes: monomorphic, polymorphic, megamorphic
 * reads, and objects that grow properties as they go. */
function propsFrame(): FrameFunction {
  const mono: Hot[] = [];
  for (let i = 0; i < 60_000; i++) mono.push({ a: i, b: i * 2, c: i * 3 });
  const poly: Loose[] = [];
  for (let i = 0; i < 36_000; i++) {
    const o: Loose = { a: i };
    if (i % 2) o.b = i * 2;
    if (i % 3) o.c = i * 3;
    poly.push(o);
  }
  const mega: Loose[] = [];
  for (let i = 0; i < 18_000; i++) {
    const o: Loose = {};
    for (let j = 0; j < 4 + (i % 40); j++) o[`k${(i * 31 + j) % 256}`] = j;
    mega.push(o);
  }
  return () => {
    let sum = 0;
    for (let i = 0; i < mono.length; i++) {
      const o = mono[i]!;
      o.b = o.a + o.c;
      sum += o.b;
    }
    for (let i = 0; i < poly.length; i++) {
      const o = poly[i]!;
      sum += (o.a ?? 0) + (o.b ?? 0);
      o.c = i;
    }
    for (let i = 0; i < mega.length; i++) {
      const o = mega[i]!;
      const key = `k${i % 256}`;
      sum += (o[key] ?? 0) + o.a!;
      o[key] = i;
      o.a = i;
    }
    for (let i = 0; i < 15_000; i++) {
      const o: Loose = { a: i };
      o.b = i + 1;
      o.c = i + 2;
      o.d = i + 3;
      o.e = i + 4;
      o.f = i + 5;
      sum += o.f!;
    }
    sink += sum;
  };
}

// ------------------------------------------------------------------- calls

function add(a: number, b: number): number {
  return a + b;
}

function rest(...args: number[]): number {
  return args[0]! + args[1]!;
}

function recurse(n: number): number {
  return n <= 1 ? 1 : recurse(n - 1) + n;
}

function throwing(n: number): number {
  if (n % 16 === 0) throw new Error('tick');
  return n;
}

/** Call overhead: closures, bound functions, spread arguments, deep
 * recursion, and try/catch with a throw in the loop. */
function callsFrame(): FrameFunction {
  const bound = add.bind(null, 2);
  const spread = [1, 2, 3];
  return () => {
    let sum = 0;
    for (let i = 0; i < 150_000; i++) sum += add(i, i + 1);
    for (let i = 0; i < 50_000; i++) sum += bound(i);
    for (let i = 0; i < 30_000; i++) sum += rest(...spread);
    for (let i = 0; i < 150; i++) sum += recurse(250);
    for (let i = 0; i < 6_000; i++) {
      try {
        sum += throwing(i);
      } catch {
        sum += 1;
      }
    }
    sink += sum;
  };
}

// ----------------------------------------------------------------- strings

const WORDS = 4_000;

/** String churn: template literals, concatenation that is trimmed back,
 * split/join, and ASCII against UTF-16 text. */
function stringsFrame(): FrameFunction {
  const words: string[] = [];
  const random = lcg(11);
  for (let i = 0; i < WORDS; i++) {
    let word = '';
    for (let j = 0; j < 3 + (i % 9); j++) {
      word += String.fromCharCode((97 + random() * 26) | 0);
    }
    words.push(word);
  }
  const asciiText = words.join(' ');
  const unicodeText = words
    .slice(0, 2_000)
    .map((word, i) => (i % 3 ? `${word}é` : `${word}—${word}`))
    .join(' ');
  return () => {
    let sum = 0;
    for (let i = 0; i < 12_000; i++) {
      const s = `${i} of ${words[i % WORDS]!}`;
      sum += s.length;
    }
    let ascii = 'a';
    for (let i = 0; i < 8_000; i++) {
      ascii = ascii.length < 40 ? ascii + words[i % WORDS]! : ascii.slice(20);
      sum += ascii.length;
    }
    let unicode = 'é';
    for (let i = 0; i < 5_000; i++) {
      unicode =
        unicode.length < 40
          ? unicode + unicodeText[i % unicodeText.length]!
          : unicode.slice(20);
      sum += unicode.length;
    }
    for (let i = 0; i < 48; i++) {
      sum +=
        asciiText.split(' ').length +
        asciiText.slice(0, 4_000).replace(/a/g, 'å').length;
      sum += unicodeText.slice(0, 4_000).split('é').length;
    }
    sink += sum;
  };
}

// ------------------------------------------------------------------- async

async function awaited(value: number): Promise<number> {
  const a = await Promise.resolve(value);
  const b = await Promise.resolve(a + 1);
  return b;
}

/** Promise allocation and async/await state machines. The callbacks settle
 * between frames, so the drain shows in `tick` rather than in the frame. */
function asyncFrame(): FrameFunction {
  return () => {
    for (let i = 0; i < 2_500; i++) {
      const p = Promise.resolve(i);
      p.then((v) => {
        sink += v;
      }).then(() => {
        sink += 1;
      });
      void awaited(i);
    }
  };
}

// ------------------------------------------------------------- alloc-large

/** Megabyte-scale churn: typed arrays written in full, a long array, and a
 * large string, all dropped again each frame. */
function allocLargeFrame(): FrameFunction {
  return () => {
    let sum = 0;
    for (let i = 0; i < 24; i++) {
      const data = new Float64Array(16_384);
      for (let j = 0; j < 16_384; j++) data[j] = (i * j) % 977;
      sum += data[data.length - 1]!;
    }
    const list: number[] = [];
    for (let i = 0; i < 60_000; i++) list.push(i * 3);
    sum += list[59_999]!;
    const text = 'x'.repeat(500_000) + `y${sum}`;
    sum += text.length;
    sink += sum;
  };
}

// ---------------------------------------------------------------- retained

interface Node {
  id: number;
  edges: number[];
  payload: Float64Array;
}

/** A live object graph of 8,000 nodes, mutated and walked every frame with
 * 300 nodes replaced: the heap holds a plateau under churn, and the run's
 * heap max and GC count show how well the collector keeps up. */
function retainedFrame(): FrameFunction {
  const graph = new Map<number, Node>();
  const random = lcg(7);
  for (let i = 0; i < 8_000; i++) {
    const payload = new Float64Array(8);
    for (let j = 0; j < 8; j++) payload[j] = random() * 100;
    graph.set(i, {
      id: i,
      edges: [(i * 3) % 8_000, (i * 7 + 11) % 8_000, (i * 13 + 5) % 8_000],
      payload,
    });
  }
  const added: number[] = [];
  let nodeId = 8_000;
  return () => {
    let sum = 0;
    for (let i = 0; i < 8_000; i++) {
      const node = graph.get(i)!;
      const payload = node.payload;
      for (let j = 0; j < 8; j++) payload[j] = payload[j]! * 0.999 + i * 0.0001;
      sum += payload[0]! + graph.get(node.edges[0]!)!.payload[0]!;
    }
    for (let i = 0; i < 900; i++) {
      const victim = added.shift();
      if (victim !== undefined) graph.delete(victim);
      const id = nodeId++;
      const payload = new Float64Array(8);
      payload[0] = id;
      graph.set(id, { id, edges: [id % 8_000, (id + 1) % 8_000], payload });
      added.push(id);
    }
    sink += sum;
  };
}

// ------------------------------------------------------------------ arrays

/** Array builtins: a full sort, filter, map and reduce over 12,000
 * numbers, fresh copies each frame. */
function arraysFrame(): FrameFunction {
  const base: number[] = [];
  const random = lcg(23);
  for (let i = 0; i < 12_000; i++) base.push(random());
  return () => {
    let sum = 0;
    const copy = base.slice();
    copy.sort((a, b) => a - b);
    sum += copy[6_000]!;
    sum += base.filter((v) => v > 0.5).length;
    sum += base.map((v) => v * 2).reduce((a, b) => a + b, 0);
    sink += sum;
  };
}

// -------------------------------------------------------------------- json

interface Clip {
  start: number;
  length: number;
  name: string;
}

interface Track {
  id: string;
  label: string;
  gain: number;
  pan: number;
  muted: boolean;
  clips: Clip[];
  nodes: { kind: number; params: { cutoff: number; resonance: number } }[];
}

interface Config {
  name: string;
  version: number;
  tracks: Track[];
}

/** JSON.stringify and JSON.parse of a plugin-sized configuration, every
 * frame. */
function jsonFrame(): FrameFunction {
  const config: Config = { name: 'orbit-project', version: 4, tracks: [] };
  const random = lcg(41);
  for (let i = 0; i < 700; i++) {
    config.tracks.push({
      id: `track-${i}`,
      label: `Track ${i} é`,
      gain: random(),
      pan: random() * 2 - 1,
      muted: i % 7 === 0,
      clips: [
        {
          start: random() * 100,
          length: 1 + random() * 20,
          name: `clip-${i}-a`,
        },
        {
          start: random() * 100,
          length: 1 + random() * 20,
          name: `clip-${i}-b`,
        },
      ],
      nodes: Array.from({ length: 6 }, (_, j) => ({
        kind: j % 3,
        params: { cutoff: random(), resonance: random() * 10 },
      })),
    });
  }
  return () => {
    const text = JSON.stringify(config);
    const parsed = JSON.parse(text) as Config;
    sink += parsed.name.length + text.length + parsed.tracks.length;
  };
}

// ------------------------------------------------------------------ errors

/** Errors thrown, caught and stacked: construction with the stack read, so
 * capture is paid, plus the handler path. */
function errorsFrame(): FrameFunction {
  return () => {
    let sum = 0;
    for (let i = 0; i < 9_000; i++) {
      try {
        if (i % 3 === 0) throw new Error(`e${i}`);
        sum += i;
      } catch (e) {
        sum += (e as Error).stack!.length;
      }
    }
    sink += sum;
  };
}

// ------------------------------------------------------------- collections

/** Map and Set at scale: 60,000 gets, 24,000 updates and 32,000 membership
 * tests per frame. */
function collectionsFrame(): FrameFunction {
  const map = new Map<number, { v: number }>();
  for (let i = 0; i < 50_000; i++) map.set(i, { v: i });
  const set = new Set<number>();
  for (let i = 0; i < 30_000; i += 2) set.add(i);
  return () => {
    let sum = 0;
    for (let i = 0; i < 60_000; i++) {
      const node = map.get((i * 3) % 50_000);
      sum += node ? node.v : 0;
    }
    for (let i = 0; i < 24_000; i++) {
      const node = map.get((i * 7) % 50_000)!;
      node.v += 1;
    }
    for (let i = 0; i < 32_000; i++) {
      if (set.has(i % 30_000)) sum += 1;
    }
    sink += sum;
  };
}

// ------------------------------------------------------------------- regex

/** The engine's own regex implementation: 36,000 matches and 4,000
 * replaces per frame over 1,000 texts. */
function regexFrame(): FrameFunction {
  const patterns = [
    /^track-(\d+)$/,
    /clip-([a-z\d]+)-([ab])$/,
    /\b\d{2,}\b/g,
    /[é—]/g,
  ];
  const texts: string[] = [];
  const random = lcg(59);
  for (let i = 0; i < 1_000; i++) {
    texts.push(
      i % 2
        ? `track-${i % 1_500} gain ${random().toFixed(3)}`
        : `clip-${(i % 900) + 100}-a note ${i} -- é ${random().toFixed(2)}`,
    );
  }
  return () => {
    let sum = 0;
    for (let i = 0; i < 8_000; i++) {
      const text = texts[i % texts.length]!;
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        const found = pattern.exec(text);
        if (found) sum += found[0]!.length;
      }
    }
    for (let i = 0; i < 4_000; i++) {
      sum += texts[i % texts.length]!.replace(/--/g, '—').length;
    }
    sink += sum;
  };
}

// ----------------------------------------------------------------- classes

class Point {
  x: number;
  y: number;
  z: number;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  get magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  static origin(): Point {
    return new Point(0, 0, 0);
  }
}

/** Class construction, getters, `instanceof` and statics: 15,000 instances
 * per frame. */
function classesFrame(): FrameFunction {
  return () => {
    const points = new Array<Point>(15_000);
    for (let i = 0; i < 15_000; i++) {
      points[i] = new Point(i % 97, (i * 3) % 89, (i * 7) % 83);
    }
    let sum = 0;
    for (let i = 0; i < 15_000; i++) {
      const p = points[i]!;
      sum += p.magnitude;
      if (p instanceof Point) sum += p.x;
    }
    sum += Point.origin().magnitude;
    sink += sum;
  };
}

// -------------------------------------------------------------- generators

const chunk: number[] = [];

function* pipeline(values: number[]): Generator<number> {
  for (const v of values) yield v * 2;
  for (const v of values) yield v + 1;
}

/** Generator resume cost: eighteen pipelines of 4,000 yields each per
 * frame. */
function generatorsFrame(): FrameFunction {
  if (chunk.length === 0) {
    for (let i = 0; i < 2_000; i++) chunk.push((i * 37) % 991);
  }
  return () => {
    let sum = 0;
    for (let i = 0; i < 18; i++) {
      for (const value of pipeline(chunk)) sum += value;
    }
    sink += sum;
  };
}

// -------------------------------------------------------------------- keys

/** Wide objects: 144,000 `Object.keys` entries and 72,000 `for-in` steps
 * per frame. */
function keysFrame(): FrameFunction {
  const wide: Loose[] = [];
  for (let i = 0; i < 40; i++) {
    const o: Loose = {};
    for (let j = 0; j < 1_200; j++) o[`k${j}`] = j;
    wide.push(o);
  }
  return () => {
    let sum = 0;
    for (let i = 0; i < 120; i++) sum += Object.keys(wide[i % 40]!).length;
    for (let i = 0; i < 60; i++) {
      for (const key in wide[i % 40]) {
        if (key.length > 3) sum += 1;
      }
    }
    sink += sum;
  };
}

// ------------------------------------------------------------------ export

export const JS_SCENARIOS: readonly Scenario[] = [
  scenario(
    'dispatch',
    'Dispatch',
    '180,000 integer and 55,000 float operations, no allocation',
    dispatchFrame,
  ),
  scenario(
    'alloc-small',
    'Alloc small',
    '80,000 short-lived objects per frame',
    allocSmallFrame,
  ),
  scenario(
    'props',
    'Properties',
    'monomorphic, polymorphic, megamorphic reads and shape transitions',
    propsFrame,
  ),
  scenario(
    'calls',
    'Calls',
    'closures, bound and spread calls, deep recursion, thrown errors',
    callsFrame,
  ),
  scenario(
    'strings',
    'Strings',
    'templates, concatenation, split/join, ASCII and UTF-16',
    stringsFrame,
  ),
  scenario(
    'async',
    'Async',
    '7,500 promises and 2,500 async/await state machines per frame',
    asyncFrame,
  ),
  scenario(
    'alloc-large',
    'Alloc large',
    'megabytes of typed arrays, a 60,000 array and a 500 KB string',
    allocLargeFrame,
  ),
  scenario(
    'retained',
    'Retained',
    'an 8,000-node graph walked with 900 nodes replaced every frame',
    retainedFrame,
  ),
  scenario(
    'arrays',
    'Arrays',
    'sort, filter, map and reduce over 12,000 numbers',
    arraysFrame,
  ),
  scenario(
    'json',
    'JSON',
    'stringify and parse of a 700-track configuration',
    jsonFrame,
  ),
  scenario(
    'errors',
    'Errors',
    '9,000 thrown errors with stack capture per frame',
    errorsFrame,
  ),
  scenario(
    'collections',
    'Collections',
    '60,000 Map gets, 24,000 updates and 32,000 Set tests',
    collectionsFrame,
  ),
  scenario(
    'regex',
    'Regex',
    '36,000 matches and 4,000 replaces over 1,000 texts',
    regexFrame,
  ),
  scenario(
    'classes',
    'Classes',
    '15,000 instances, getters, instanceof and statics',
    classesFrame,
  ),
  scenario(
    'generators',
    'Generators',
    '72,000 yields through eighteen pipelines',
    generatorsFrame,
  ),
  scenario(
    'keys',
    'Keys',
    '144,000 Object.keys entries and 72,000 for-in steps',
    keysFrame,
  ),
];
