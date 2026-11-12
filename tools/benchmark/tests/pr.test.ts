import { describe, expect, it } from 'vitest';

import { prMarkdown, type Change } from '../scripts/pr.ts';

const measures = (scenario: string) =>
  scenario === '(startup)'
    ? { startupMs: { label: 'startup ms', timing: true } }
    : {
        frame: { label: 'frame ms', timing: true },
        uiCalls: { label: 'ui calls', timing: false },
      };

const changes: Change[] = [
  {
    scenario: 'animation-react-500',
    measure: 'frame ms',
    before: 10.3,
    after: 8.1,
    change: -21.4,
    noise: 6,
    significant: true,
    worse: false,
  },
  {
    scenario: 'animation-mixed-20',
    measure: 'build',
    before: 4.1,
    after: 4.6,
    change: 12.2,
    noise: 8,
    significant: true,
    worse: true,
  },
  {
    scenario: 'animation-opacity-50',
    measure: 'tick',
    before: 0.24,
    after: 0.25,
    change: 4.2,
    noise: 9,
    significant: false,
    worse: true,
  },
  {
    scenario: 'animation-new-1',
    measure: 'frame ms',
    before: 0,
    after: 1.2,
    change: null,
    noise: 1,
    significant: true,
    worse: true,
  },
];

const input = {
  scope: 'animation',
  against: 'main',
  base: { commit: '43a10cde33cd1b940e186c748c7132b5d1e9a7bb', dirty: false },
  candidate: {
    commit: '0729d4ca8899',
    dirty: true,
    execution: 'hermes-bytecode',
  },
  run: {
    platform: 'linux 7.0.0-43-generic',
    cpu: 'Intel(R) Core(TM) 5 210H',
    cores: 4,
    backend: 'OpenGL',
    vendor: 'NVIDIA',
    renderer: 'virgl (NVIDIA RTX 4050)',
    software: false,
    node: 'v24.22.2',
  },
  config: {
    runs: 5,
    frames: 600,
    warmup: 30,
    size: '700x520',
    animations: 'js',
  },
  regressed: true,
  changes,
  summary: {
    '(startup)': {
      startupMs: { median: 10.6, spread: 2 },
      heapKB: { median: 1975, spread: 0 },
    },
    'animation-react-500': {
      frame: { median: 8.1, spread: 2 },
      uiCalls: { median: 500, spread: 0 },
    },
  },
  baseSummary: {
    '(startup)': {
      startupMs: { median: 11.0, spread: 3 },
      heapKB: { median: 1975, spread: 0 },
    },
    'animation-react-500': {
      frame: { median: 10.3, spread: 3 },
      uiCalls: { median: 500, spread: 0 },
    },
  },
};

describe('prMarkdown', () => {
  const md = prMarkdown(input, measures);

  it('leads with the diff: verdict, marked changes, chart', () => {
    const verdict = md.indexOf('**Marked changes**');
    const details = md.indexOf('<details>');
    expect(verdict).toBeGreaterThan(0);
    expect(verdict).toBeLessThan(details);
    expect(md).toContain('animation-react-500 | frame ms');
    expect(md).toContain('-21.4%');
    expect(md).toContain('+12.2%');
    expect(md).toContain('**Something got worse.**');
  });

  it('draws the marked changes as a Mermaid bar chart, in percent', () => {
    const chart = md.match(/```mermaid\n([\s\S]*?)\n```/)![1]!;
    expect(chart).toContain('xychart-beta');
    expect(chart).toContain('"react-500 · frame ms"');
    expect(chart).toContain('y-axis "change %" ');
    // The insignificant change and the 'new' one are not chartable.
    expect(chart).not.toContain('opacity-50');
    expect(chart).not.toContain('new-1');
    expect(chart).toContain('bar [-21.4, 12.2]');
  });

  it('folds the full medians into <details>, with a blank line after <summary>', () => {
    const details = md.slice(md.indexOf('<details>'));
    expect(details).toContain('Full medians');
    expect(details).toContain('8.10 ±2%');
    expect(details).toContain('| animation-react-500 | 500 |');
    expect(details).toContain('Startup: 10.6 ms ±2%');
    expect(details).toMatch(/<summary>[^\n]*\n\n/);
    expect(details.trimEnd().endsWith('</details>')).toBe(true);
  });

  it('says nothing was marked when the runs agree', () => {
    const quiet = prMarkdown(
      { ...input, changes: [], regressed: false },
      measures,
    );
    expect(quiet).toContain('Nothing changed beyond noise.');
    expect(quiet).not.toContain('mermaid');
  });

  it('skips the chart when too many rows are marked', () => {
    const many = prMarkdown(
      {
        ...input,
        changes: Array.from({ length: 13 }, (_, index) => ({
          scenario: `scenario-${index}`,
          measure: 'frame ms',
          before: 1,
          after: 2,
          change: 100,
          noise: 3,
          significant: true,
          worse: true,
        })),
        regressed: true,
      },
      measures,
    );
    expect(many).toContain('**Marked changes**');
    expect(many).not.toContain('mermaid');
  });
});
