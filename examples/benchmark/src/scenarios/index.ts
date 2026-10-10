// Every scenario, in the order "Run all" runs them.

import { CANVAS_SCENARIOS } from './canvas';
import { MIXED_SCENARIOS } from './mixed';
import { THREE_SCENARIOS } from './three';
import { GROUPS, type Scenario } from './types';
import { UI_SCENARIOS } from './ui';
import { WEBGL_SCENARIOS } from './webgl';

const all = [
  ...THREE_SCENARIOS,
  ...WEBGL_SCENARIOS,
  ...CANVAS_SCENARIOS,
  ...UI_SCENARIOS,
  ...MIXED_SCENARIOS,
];

export const SCENARIOS: readonly Scenario[] = GROUPS.flatMap((group) =>
  all.filter((scenario) => scenario.group === group),
);

export * from './types';
