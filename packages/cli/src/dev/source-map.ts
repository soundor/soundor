/**
 * Just enough of Source Map v3 to map a stack frame in the plugin bundle back
 * to the TypeScript that produced it: VLQ decoding and position lookup.
 */

import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

export interface RawSourceMap {
  readonly version: number;
  readonly sources: readonly string[];
  readonly sourceRoot?: string;
  readonly mappings: string;
}

/** A position in an original source; 1-based line and column. */
export interface OriginalPosition {
  readonly source: string;
  readonly line: number;
  readonly column: number;
}

/** [generatedColumn, sourceIndex, originalLine, originalColumn], all 0-based. */
type Segment = readonly [number, number, number, number];

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map([...BASE64].map((char, index) => [char, index]));

function decodeVlq(text: string, position: { at: number }): number {
  let result = 0;
  let shift = 0;
  for (;;) {
    const digit = DIGIT.get(text[position.at++] ?? '');
    if (digit === undefined) throw new Error('invalid source map mapping');
    result += (digit & 31) << shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  return result & 1 ? -(result >>> 1) : result >>> 1;
}

export class SourceMap {
  /** Segments per generated line, sorted by generated column. */
  readonly #lines: Segment[][] = [];
  readonly #sources: string[];

  /** `sources` are resolved against `mapDirectory` and made relative to `root`. */
  constructor(map: RawSourceMap, mapDirectory: string, root: string) {
    this.#sources = map.sources.map((source) =>
      relative(root, resolve(mapDirectory, map.sourceRoot ?? '', source))
        .split('\\')
        .join('/'),
    );
    let sourceIndex = 0;
    let originalLine = 0;
    let originalColumn = 0;
    for (const line of map.mappings.split(';')) {
      const segments: Segment[] = [];
      let generatedColumn = 0;
      for (const encoded of line.split(',')) {
        if (encoded === '') continue;
        const position = { at: 0 };
        generatedColumn += decodeVlq(encoded, position);
        if (position.at >= encoded.length) continue; // unmapped segment
        sourceIndex += decodeVlq(encoded, position);
        originalLine += decodeVlq(encoded, position);
        originalColumn += decodeVlq(encoded, position);
        segments.push([
          generatedColumn,
          sourceIndex,
          originalLine,
          originalColumn,
        ]);
      }
      this.#lines.push(segments);
    }
  }

  static async load(mapFile: string, root: string): Promise<SourceMap> {
    const raw = JSON.parse(await readFile(mapFile, 'utf8')) as RawSourceMap;
    return new SourceMap(raw, dirname(mapFile), root);
  }

  /** The original position of a 1-based generated line and column. */
  originalPosition(line: number, column: number): OriginalPosition | undefined {
    const segments = this.#lines[line - 1];
    if (segments === undefined || segments.length === 0) return undefined;
    let match: Segment | undefined;
    for (const segment of segments) {
      if (segment[0] > column - 1) break;
      match = segment;
    }
    match ??= segments[0]!;
    const source = this.#sources[match[1]];
    if (source === undefined) return undefined;
    return { source, line: match[2] + 1, column: match[3] + 1 };
  }
}

/**
 * Rewrites `<bundle>:line:column` locations in `text` (QuickJS stack frames are
 * 1-based) to the original source positions.
 */
export function rewriteLocations(
  text: string,
  map: SourceMap,
  bundle = '/bundle.js',
): string {
  const pattern = new RegExp(
    `${bundle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`,
    'g',
  );
  return text.replace(pattern, (whole, line: string, column: string) => {
    const original = map.originalPosition(Number(line), Number(column));
    return original === undefined
      ? whole
      : `${original.source}:${original.line}:${original.column}`;
  });
}
