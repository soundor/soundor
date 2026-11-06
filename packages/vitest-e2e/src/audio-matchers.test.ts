import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { sine } from './audio';
import { audioMatchers } from './audio-matchers';
import { readWav } from './wav';

const channel = (...samples: number[]) => Float32Array.from(samples);

describe('toBeSilent', () => {
  test('takes a channel or a bus, with a threshold', () => {
    expect(new Float32Array(8)).toBeSilent();
    expect([new Float32Array(8), new Float32Array(8)]).toBeSilent();
    expect(channel(0.001)).toBeSilent({ threshold: 0.01 });
    expect(channel(0.5)).not.toBeSilent();
  });

  test('says how loud it was', () => {
    expect(() => expect([channel(0), channel(-0.5)]).toBeSilent()).toThrow(
      'the peak is 0.5',
    );
    expect(() => expect(new Float32Array(8)).not.toBeSilent()).toThrow(
      'Expected sound',
    );
  });

  test('wants audio', () => {
    expect(() => expect([1, 2]).toBeSilent()).toThrow('a channel or a bus');
    expect(() => expect('quiet').toBeSilent()).toThrow('a channel or a bus');
  });
});

describe('toBeCloseToAudio', () => {
  test('allows the tolerance', () => {
    expect(channel(0.5)).toBeCloseToAudio(channel(0.50001));
    expect(channel(0.5)).toBeCloseToAudio([channel(0.5)]);
    expect(channel(0.5)).toBeCloseToAudio(channel(0.6), { tolerance: 0.2 });
    expect(channel(0.5)).not.toBeCloseToAudio(channel(0.6));
  });

  test('says where it first differs, and how many', () => {
    expect(() =>
      expect([channel(0, 0.5), channel(0.5, 0)]).toBeCloseToAudio(
        [channel(0, 0), channel(0, 0)],
        { tolerance: 0.1 },
      ),
    ).toThrow(
      '2 samples differ by over 0.1: first, channel 0, frame 1, is 0.5, not 0',
    );
  });

  test('says when the shape differs', () => {
    expect(() =>
      expect([channel(0)]).toBeCloseToAudio([channel(0), channel(0)]),
    ).toThrow('it has 1 channels, not 2');
    expect(() => expect(channel(0)).toBeCloseToAudio(channel(0, 0))).toThrow(
      'channel 0 has 1 frames, not 2',
    );
  });
});

describe('toMatchAudioSnapshot', () => {
  let dir: string;
  const file = () => join(dir, 'a.test.ts');
  const saved = (name: string) =>
    join(dir, '__snapshots__', 'a.test.ts', `${name}.wav`);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'soundor-vitest-e2e-snap-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** As Vitest calls it, in a chosen snapshot mode. */
  function match(
    audio: unknown,
    update: 'all' | 'new' | 'none',
    name = 'tone',
    options = {},
  ) {
    return audioMatchers.toMatchAudioSnapshot.call(
      {
        testPath: file(),
        currentTestName: 'a test',
        snapshotState: { _updateSnapshot: update },
      },
      audio,
      name,
      options,
    );
  }

  test('saves the first time, exactly', () => {
    const tone = sine(440, { frames: 256 });
    expect(match([tone, tone], 'new').pass).toBe(true);
    expect(readWav(saved('tone')).channels).toEqual([tone, tone]);
  });

  test('passes when it matches, on CI too', () => {
    const tone = sine(440, { frames: 256 });
    match(tone, 'new');
    expect(match(tone, 'new').pass).toBe(true);
    expect(match(tone, 'none').pass).toBe(true);
  });

  test('fails with no file on CI, writing nothing', () => {
    const result = match(sine(440, { frames: 8 }), 'none');
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('on CI none is written');
    expect(existsSync(saved('tone'))).toBe(false);
  });

  test('fails on a difference, keeping what was saved', () => {
    const tone = sine(440, { frames: 256 });
    match(tone, 'new');
    const result = match(sine(880, { frames: 256 }), 'new');
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('samples differ');
    expect(result.message()).toContain('run Vitest with -u');
    expect(readWav(saved('tone')).channels).toEqual([tone]);
  });

  test('takes a tolerance', () => {
    match(channel(0.5), 'new');
    expect(match(channel(0.6), 'new', 'tone', { tolerance: 0.2 }).pass).toBe(
      true,
    );
  });

  test('with -u replaces it', () => {
    match(channel(0.5), 'new');
    expect(match(channel(0.25), 'all').pass).toBe(true);
    expect(readWav(saved('tone')).channels).toEqual([channel(0.25)]);
  });

  test('records the sample rate given', () => {
    match(channel(0.5), 'new', 'rate', { sampleRate: 44_100 });
    expect(readWav(saved('rate')).sampleRate).toBe(44_100);
  });

  test('names unnamed ones by the test, in order', () => {
    const call = (audio: unknown) =>
      audioMatchers.toMatchAudioSnapshot.call(
        {
          testPath: file(),
          currentTestName: 'unnamed test',
          snapshotState: { _updateSnapshot: 'new' },
        },
        audio,
      );
    call(channel(0));
    call(channel(0.5));
    expect(existsSync(saved('unnamed-test'))).toBe(true);
    expect(existsSync(saved('unnamed-test-2'))).toBe(true);
  });

  test('has no .not', () => {
    expect(() => expect(channel(0)).not.toMatchAudioSnapshot('x')).toThrow(
      'has no .not',
    );
  });
});
