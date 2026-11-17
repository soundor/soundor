// Writes the trees of corpus.json: plugin UIs in miniature, generated from a
// seed so that they reach what nobody would think to write by hand. Their frames
// are the engine's (LayoutCorpusTests.cpp, with UPDATE_GOLDEN=1), which the web
// runtime's tests then have to match to the last bit (layout-corpus.test.ts).
//
//   node tests/layout/generate.mjs
//   UPDATE_GOLDEN=1 ctest --test-dir build/dev -R soundor_runtime_tests
import { writeFileSync } from 'node:fs';

const TREES = 180;
const SCALES = [1, 1.5, 2];

function random(seed) {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

const WORDS = [
  'Gain',
  'Cutoff frequency',
  'Dry/Wet',
  'Resonance',
  'A longer label that has to wrap when its box is narrow',
  'two\nlines',
  '  leading spaces',
  'trailing space ',
  'unbreakable-with-hyphens-all-the-way',
  '',
];

// Each family is only in some of the trees, so that a difference in one still
// shows without another hiding it.
const FAMILIES = [
  'percent',
  'minmax',
  'aspect',
  'wrap',
  'absolute',
  'shrink',
  'basis',
  'marginAuto',
  'alignSelf',
  'grow',
  'overflow',
  'edges',
  'display',
  'contentBox',
  'textStyle',
];

function tree(seed) {
  const r = random(seed);
  const pick = (...values) => values[Math.floor(r() * values.length)];
  const families = new Set(FAMILIES.filter(() => r() < 0.3));
  const has = (family, chance) => families.has(family) && r() < chance;

  const style = (container) => {
    const s = {};
    if (container && r() < 0.5)
      s.flexDirection = pick(
        'row',
        'row',
        'column',
        'row-reverse',
        'column-reverse',
      );
    if (container && r() < 0.35)
      s.justifyContent = pick(
        'center',
        'flex-end',
        'space-between',
        'space-around',
        'space-evenly',
      );
    if (container && r() < 0.35)
      s.alignItems = pick('center', 'flex-start', 'flex-end', 'stretch');
    if (r() < 0.3) s.flex = pick(1, 1, 2, -1);
    if (r() < 0.25) s.width = pick(40, 60, 80, 120, 200);
    if (r() < 0.25) s.height = pick(20, 30, 50, 80, 120);
    if (r() < 0.3) s.padding = pick(2, 4, 8, 12);
    if (r() < 0.15) s.paddingHorizontal = pick(3, 10);
    if (r() < 0.2) s.margin = pick(1, 3, 6);
    if (r() < 0.15) s.borderWidth = pick(1, 2);
    if (container && r() < 0.25) s.gap = pick(2, 4, 8);
    if (has('percent', 0.4))
      s[pick('width', 'height', 'flexBasis', 'padding', 'margin')] = pick(
        '25%',
        '50%',
        '100%',
      );
    if (has('minmax', 0.45))
      s[pick('minWidth', 'maxWidth', 'minHeight', 'maxHeight')] = pick(
        20,
        50,
        100,
        200,
        '50%',
      );
    if (has('aspect', 0.4)) s.aspectRatio = pick(1, 2, 0.5, 1.5);
    if (container && has('wrap', 0.5)) {
      s.flexWrap = pick('wrap', 'wrap', 'wrap-reverse');
      if (r() < 0.4)
        s.alignContent = pick('center', 'space-between', 'stretch');
    }
    if (has('absolute', 0.3)) {
      s.position = pick('absolute', 'absolute', 'static');
      for (const key of ['left', 'top', 'right', 'bottom'])
        if (r() < 0.45) s[key] = pick(0, 5, 10, '10%');
      if (r() < 0.2) s.inset = pick(2, '5%');
    }
    if (has('shrink', 0.5)) s.flexShrink = pick(1, 2);
    if (has('basis', 0.4)) s.flexBasis = pick(10, 40, 100, 'auto');
    if (has('marginAuto', 0.3))
      s[pick('marginLeft', 'marginTop', 'margin', 'marginHorizontal')] = 'auto';
    if (has('alignSelf', 0.4))
      s.alignSelf = pick('center', 'flex-end', 'stretch', 'flex-start', 'auto');
    if (has('grow', 0.5)) s.flexGrow = pick(1, 2, 3);
    if (has('overflow', 0.4)) s.overflow = pick('hidden', 'scroll', 'visible');
    if (has('edges', 0.5)) {
      s[
        pick(
          'marginTop',
          'marginRight',
          'marginVertical',
          'paddingBottom',
          'paddingLeft',
          'paddingVertical',
        )
      ] = pick(1, 5, 9);
      s[
        pick(
          'borderTopWidth',
          'borderLeftWidth',
          'borderHorizontalWidth',
          'borderVerticalWidth',
        )
      ] = pick(1, 3);
    }
    if (container && has('edges', 0.3))
      s[pick('rowGap', 'columnGap')] = pick(1, 6);
    if (has('display', 0.12)) s.display = 'none';
    if (has('contentBox', 0.4)) s.boxSizing = 'content-box';
    return s;
  };

  const text = () => {
    const s = style(false);
    if (r() < 0.5) s.fontSize = pick(10, 12, 18, 24);
    if (has('textStyle', 0.5)) {
      s[pick('lineHeight', 'letterSpacing', 'numberOfLines')] = pick(1, 2, 3);
    }
    return { type: 'text', text: pick(...WORDS), style: s, children: [] };
  };

  const build = (depth) => {
    if (depth > 0 && (depth >= 3 || r() < 0.35))
      return r() < 0.75
        ? text()
        : { type: 'view', style: style(false), children: [] };
    // A draw that once picked a scroll node, a type of its own then: kept,
    // so the same seed makes the same corpus.
    if (depth > 0) r();
    const node = {
      type: 'view',
      style: style(true),
      children: [],
    };
    const count = 1 + Math.floor(r() * 4);
    for (let i = 0; i < count; i++) node.children.push(build(depth + 1));
    return node;
  };
  const root = build(0);
  root.style = {};
  root.type = 'view';
  return root;
}

const entries = [];
for (let seed = 1; seed <= TREES; seed++)
  entries.push({
    tree: tree(seed),
    frames: Object.fromEntries(SCALES.map((scale) => [scale, []])),
  });

writeFileSync(
  new URL('./corpus.json', import.meta.url),
  `${JSON.stringify({ view: [800, 600], scales: SCALES, entries })}\n`,
);
console.log(`${TREES} trees at ${SCALES.length} scales`);
