// What --pr writes into .soundor/bench/: the paired comparison as Markdown,
// ready to paste into the change's PR description — what was before, what is
// now, and everything about the run. Nothing benchmark-shaped is committed:
// the numbers live in PR descriptions, and in no report.

export interface Statistic {
  median: number;
  spread: number;
}

/** Medians per scenario, and per measure (the startup row's differ). */
export type Summary = Record<string, Record<string, Statistic>>;

export interface MeasureInfo {
  label: string;
  timing: boolean;
  compare?: boolean;
}

/** What one measure's rows show, per scenario: the CLI's `measuresOf`. */
export type MeasureSource = (scenario: string) => Record<string, MeasureInfo>;

/** One compared measure: `change` in percent, or null when it appeared. */
export interface Change {
  scenario: string;
  measure: string;
  before: number;
  after: number;
  change: number | null;
  noise: number;
  significant: boolean;
  worse: boolean;
}

export interface RunFacts {
  platform: string;
  cpu: string;
  cores: number;
  backend: string;
  vendor: string;
  renderer: string;
  software: boolean;
  node: string;
}

export interface BuildFacts {
  commit: string;
  dirty: boolean;
  hermesRevision?: string;
  execution?: string;
}

export interface PrInput {
  scope: string;
  against: string;
  base: BuildFacts;
  candidate: BuildFacts;
  run: RunFacts;
  config: {
    runs: number;
    frames: number;
    warmup: number;
    size: string;
    animations?: string;
  };
  regressed: boolean;
  changes: Change[];
  summary: Summary;
  baseSummary: Summary;
}

/** The measures a record's tables show, in this order; the rest is in the
 * full report (`.soundor/bench/`). */
const SHOWN_TIMING = [
  'frame',
  'frameP95',
  'frameP99',
  'tick',
  'allTick',
  'script',
  'nativeMs',
  'layoutMs',
  'build',
  'composite',
  'idleTick',
];
const SHOWN_WORK = [
  'uiCalls',
  'canvasCalls',
  'webglCalls',
  'styleChanges',
  'layouts',
  'invalidations',
  'rasterized',
  'uploadedKB',
  'readbacks',
  'collections',
];

function format(value: number): string {
  if (!Number.isFinite(value)) return 'unavailable';
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function markdownTable(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map((_, column) => (column === 0 ? '---' : '---:')).join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

/** The measured rows of one summary, split the way they are presented. */
function summaryTables(
  summary: Summary,
  measures: MeasureSource,
): { title: string; table: string }[] {
  const shown = Object.entries(measures('')).filter(
    ([measure]) =>
      SHOWN_TIMING.includes(measure) || SHOWN_WORK.includes(measure),
  );
  const timing = shown
    .filter(
      ([measure, info]) =>
        SHOWN_TIMING.includes(measure) && (info.timing || info.label === 'fps'),
    )
    .sort((a, b) => SHOWN_TIMING.indexOf(a[0]) - SHOWN_TIMING.indexOf(b[0]));
  const work = shown
    .filter(
      ([measure, info]) =>
        SHOWN_WORK.includes(measure) && !info.timing && info.label !== 'fps',
    )
    .sort((a, b) => SHOWN_WORK.indexOf(a[0]) - SHOWN_WORK.indexOf(b[0]));
  const tables: { title: string; table: string }[] = [];
  for (const [title, group] of [
    ['Time per frame', timing],
    ['Work per frame', work],
  ] as const) {
    const rows: string[][] = [];
    for (const [scenario, values] of Object.entries(summary)) {
      if (!values || scenario === '(startup)') continue;
      rows.push([
        scenario,
        ...group.map(([measure, info]) => {
          const value = values[measure];
          if (!value) return 'unavailable';
          return info.timing
            ? `${format(value.median)} ±${value.spread.toFixed(0)}%`
            : format(value.median);
        }),
      ]);
    }
    if (rows.length > 0 && group.length > 0) {
      tables.push({
        title,
        table: markdownTable(
          ['scenario', ...group.map(([, info]) => info.label)],
          rows,
        ),
      });
    }
  }
  return tables;
}

function startup(summary: Summary): string | undefined {
  const values = summary['(startup)'] as
    | Partial<Record<'startupMs' | 'heapKB' | 'rssKB', Statistic>>
    | undefined;
  if (!values?.startupMs || !values.heapKB) return undefined;
  const rss = values.rssKB?.median;
  return `${format(values.startupMs.median)} ms ±${values.startupMs.spread.toFixed(0)}%, engine heap ${format(values.heapKB.median)} KB${rss === undefined ? '' : `, resident ${format(rss)} KB`}`;
}

/** The PR description's benchmark section: what was, what is, what it ran on.
 * The diff leads — verdict, marked changes and their chart — and the full
 * medians fold into a `<details>` block. */
export function prMarkdown(input: PrInput, measures: MeasureSource): string {
  const { candidate, base, run, config } = input;
  const short = (commit: string) => (commit ? commit.slice(0, 8) : 'unknown');
  const lines: string[] = [
    `## Benchmarks — ${input.scope}`,
    '',
    `This build ${short(candidate.commit)}${candidate.dirty ? ' (uncommitted changes)' : ''} against \`${input.against}\` (${short(base.commit)}), run alternately in the same session.`,
    '',
    `**Environment:** ${run.platform}, ${run.cpu} (${run.cores} cores), ${run.backend}${run.vendor ? ` (${run.vendor})` : ''}${run.software ? ' (software)' : ''} — ${run.renderer}, Node ${run.node}`,
    '',
    `**Config:** ${config.runs} runs, ${config.frames} frames after ${config.warmup} warmup, ${config.size}${config.animations ? `, animations: ${config.animations}` : ''}${candidate.execution ? `, ${candidate.execution}` : ''}${candidate.hermesRevision ? `, Hermes ${candidate.hermesRevision.slice(0, 8)}` : ''}`,
    '',
  ];
  const marked = input.changes.filter((change) => change.significant);
  if (marked.length > 0) {
    lines.push(
      '**Marked changes** (larger than both sides’ spread and the threshold):',
      '',
      markdownTable(
        ['scenario', 'measure', 'before', 'after', 'change', 'noise'],
        marked.map((change) => [
          change.scenario,
          change.measure,
          format(change.before),
          format(change.after),
          change.change === null
            ? 'new'
            : `${change.change > 0 ? '+' : ''}${change.change.toFixed(1)}%`,
          `±${change.noise.toFixed(0)}%`,
        ]),
      ),
      '',
      input.regressed ? '**Something got worse.**' : '',
      '',
    );
    const chart = mermaidDiff(marked);
    if (chart) lines.push(chart, '');
  } else {
    lines.push('Nothing changed beyond noise.', '');
  }
  lines.push(
    '<details>',
    `<summary>Full medians — <code>${input.against}</code> (${short(base.commit)}) vs this build (${short(candidate.commit)})</summary>`,
    '',
  );
  for (const [title, summary, commit] of [
    [`\`${input.against}\` (before)`, input.baseSummary, base.commit],
    ['This build (after)', input.summary, candidate.commit],
  ] as const) {
    lines.push(`#### ${title} — ${short(commit)}`, '');
    for (const table of summaryTables(summary, measures)) {
      lines.push(
        `**${table.title}** (median ± spread across runs):`,
        '',
        table.table,
        '',
      );
    }
    const started = startup(summary);
    if (started) lines.push(`Startup: ${started}.`, '');
  }
  lines.push('</details>');
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

/** A bar chart of the marked changes, in percent. Linear scale fits the
 * diff; it says nothing about the medians, which the tables carry. A long
 * list of changes is unreadable as a chart — the table stands alone. */
function mermaidDiff(changes: Change[]): string | undefined {
  const finite = changes.filter(
    (change) => change.change !== null && Number.isFinite(change.change),
  );
  if (finite.length === 0 || finite.length > 12) return undefined;
  const values = finite.map((change) => change.change!.toFixed(1));
  const low = Math.min(0, ...finite.map((change) => change.change!));
  const high = Math.max(0, ...finite.map((change) => change.change!));
  const pad = Math.max(10, (high - low) * 0.1);
  const labels = finite.map(
    (change) =>
      `${change.scenario.replace(/^animation-/, '')} · ${change.measure}`,
  );
  return [
    '```mermaid',
    'xychart-beta',
    `    title "Marked changes, %"`,
    `    x-axis [${labels.map((label) => JSON.stringify(label)).join(', ')}]`,
    `    y-axis "change %" ${(low - pad).toFixed(0)} --> ${(high + pad).toFixed(0)}`,
    `    bar [${values.join(', ')}]`,
    '```',
  ].join('\n');
}
