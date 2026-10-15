// Unknown bases run all native coverage. Keep shared codegen and CI inputs broad.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const base = process.env.BASE_SHA;
let engine = true;
let juce = true;
if (base && !/^0+$/.test(base)) {
  const paths = execFileSync(
    'git',
    ['diff', '--name-only', base, process.env.HEAD_SHA],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  engine = paths.some((path) =>
    /^(runtimes\/engine\/|runtimes\/juce-runtime\/(src\/native-codegen|scripts\/webgl-codegen)|packages\/(core|config|runtime-sdk)\/|configs\/|scripts\/|examples\/benchmark\/|\.github\/|\.clang|pnpm-|package\.json$|turbo\.json$)/.test(
      path,
    ),
  );
  juce =
    engine ||
    paths.some((path) =>
      /^(runtimes\/juce-runtime\/|examples\/(basic|primitives)\/)/.test(path),
    );
}
appendFileSync(process.env.GITHUB_OUTPUT, `native=${engine}\njuce=${juce}\n`);
