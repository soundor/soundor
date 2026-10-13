import {
  getTestRuntime,
  semanticSnapshot,
  type TestNode,
  type SemanticNode,
  type SemanticRole,
} from '@soundor/test-runtime';

import {
  waitFor,
  direct,
  type UpdateWrapper,
  type WaitOptions,
} from '../async';

export type NodeTarget =
  | TestNode
  | { readonly children: readonly unknown[]; readonly isConnected: boolean };
export function resolveNode(target: NodeTarget): TestNode {
  const node = target as TestNode;
  getTestRuntime().assertNode(node);
  return node;
}
export type TextMatch =
  | string
  | RegExp
  | ((text: string, node: TestNode) => boolean);
export interface MatchOptions {
  exact?: boolean;
  hidden?: boolean;
  normalizer?: (text: string) => string;
}
export interface RoleOptions extends MatchOptions {
  name?: TextMatch;
  description?: TextMatch;
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  expanded?: boolean;
  busy?: boolean;
  value?: { min?: number; max?: number; now?: number; text?: TextMatch };
}
function matches(
  text: string,
  match: TextMatch,
  node: TestNode,
  options: MatchOptions,
): boolean {
  const normalized = (
    options.normalizer ?? ((value) => value.trim().replace(/\s+/g, ' '))
  )(text);
  if (typeof match === 'function') return match(normalized, node);
  if (typeof match === 'string')
    return options.exact === false
      ? normalized.toLowerCase().includes(match.toLowerCase())
      : normalized === match;
  const previous = match.lastIndex;
  match.lastIndex = 0;
  try {
    return match.test(normalized);
  } finally {
    match.lastIndex = previous;
  }
}
function flatten(tree: SemanticNode[]): SemanticNode[] {
  return tree.flatMap((entry) => [entry, ...flatten(entry.children)]);
}
function ownedBy(node: TestNode, scope: TestNode): boolean {
  const seen = new Set<TestNode>();
  for (
    let at: TestNode | null = node;
    at && !seen.has(at);
    at = at.accessibilityParent ?? at.parent
  ) {
    if (at === scope) return true;
    seen.add(at);
  }
  return false;
}
function snapshot(scope?: NodeTarget) {
  const runtime = getTestRuntime();
  const root = scope ? resolveNode(scope) : undefined;
  const snapshot = semanticSnapshot([runtime.root, runtime.overlayRoot]);
  return {
    ...snapshot,
    entries: flatten(snapshot.tree).filter(
      (entry) => !root || ownedBy(entry.node, root),
    ),
    root,
  };
}
export function formatTree(scope?: NodeTarget): string {
  const { entries } = snapshot(scope);
  return (
    entries
      .filter((entry) => !entry.hidden)
      .map((entry) => {
        const states = Object.entries(entry.state)
          .map(([key, value]) => `${key}=${value}`)
          .join(' ');
        let depth = 0;
        const seen = new Set<TestNode>([entry.node]);
        for (
          let at = entry.node.accessibilityParent ?? entry.node.parent;
          at && !seen.has(at);
          at = at.accessibilityParent ?? at.parent
        ) {
          seen.add(at);
          depth++;
        }
        return `${'  '.repeat(Math.min(depth, 20))}${entry.role} ${JSON.stringify(entry.name)}${entry.description ? ` description=${JSON.stringify(entry.description)}` : ''}${states ? ` ${states}` : ''}${Object.keys(entry.value).length ? ` value=${JSON.stringify(entry.value)}` : ''}`;
      })
      .join('\n')
      .slice(0, 10000) || '(empty semantic tree)'
  );
}
function family<Args extends unknown[]>(
  find: (...args: Args) => TestNode[],
  label: string,
  scope: NodeTarget | undefined,
) {
  const describe = (args: Args) =>
    args
      .map((value) =>
        typeof value === 'object' && value !== null
          ? JSON.stringify(value, (_, item) =>
              item instanceof RegExp
                ? String(item)
                : typeof item === 'function'
                  ? '[matcher]'
                  : item,
            )
          : String(value),
      )
      .join(' ');
  const all = (...args: Args) => {
    const nodes = find(...args);
    if (!nodes.length)
      throw new Error(
        `Unable to find ${label} matching ${describe(args)}\n${formatTree(scope)}`,
      );
    return nodes;
  };
  const one = (...args: Args) => {
    const nodes = all(...args);
    if (nodes.length !== 1)
      throw new Error(
        `Found ${nodes.length} elements for ${label} matching ${describe(args)}\n${formatTree(scope)}`,
      );
    return nodes[0]!;
  };
  return {
    get: one,
    getAll: all,
    queryAll: find,
    query: (...args: Args) => {
      const nodes = find(...args);
      if (!nodes.length) return null;
      return one(...args);
    },
  };
}
export function createQueries(
  scope?: NodeTarget,
  wrap: UpdateWrapper = direct,
) {
  const role = family(
    (role: SemanticRole, options: RoleOptions = {}) =>
      snapshot(scope)
        .entries.filter((entry) => {
          if (entry.role !== role || (!options.hidden && entry.hidden))
            return false;
          if (
            options.name !== undefined &&
            !matches(entry.name, options.name, entry.node, options)
          )
            return false;
          if (
            options.description !== undefined &&
            !matches(
              entry.description,
              options.description,
              entry.node,
              options,
            )
          )
            return false;
          for (const key of [
            'disabled',
            'selected',
            'checked',
            'expanded',
            'busy',
          ] as const)
            if (
              options[key] !== undefined &&
              (entry.state[key] ?? false) !== options[key]
            )
              return false;
          for (const key of ['min', 'max', 'now'] as const)
            if (
              options.value?.[key] !== undefined &&
              entry.value[key] !== options.value[key]
            )
              return false;
          return (
            options.value?.text === undefined ||
            matches(
              entry.value.text ?? '',
              options.value.text,
              entry.node,
              options,
            )
          );
        })
        .map((entry) => entry.node),
    'role',
    scope,
  );
  const text = family(
    (match: TextMatch, options: MatchOptions = {}) => {
      const { hidden, root } = snapshot(scope),
        runtime = getTestRuntime();
      const nodes: TestNode[] = [];
      const cache = new Map<TestNode, string>();
      const textContent = (node: TestNode): string => {
        if (cache.has(node)) return cache.get(node)!;
        const value =
          !options.hidden && hidden.has(node)
            ? ''
            : node.type === 'text'
              ? node.text
              : node.type === 'input'
                ? node.value || node.placeholder
                : node.children.map(textContent).join(' ');
        cache.set(node, value);
        return value;
      };
      const walk = (node: TestNode) => {
        if (
          (!root || ownedBy(node, root)) &&
          (options.hidden || !hidden.has(node)) &&
          textContent(node) &&
          matches(textContent(node), match, node, options) &&
          !node.children.some((child) =>
            matches(textContent(child), match, child, options),
          )
        )
          nodes.push(node);
        node.children.forEach(walk);
      };
      walk(runtime.root);
      walk(runtime.overlayRoot);
      return nodes;
    },
    'text',
    scope,
  );
  const label = family(
    (match: TextMatch, options: MatchOptions = {}) =>
      snapshot(scope)
        .entries.filter(
          (entry) =>
            (options.hidden || !entry.hidden) &&
            entry.node.accessibility.label !== undefined &&
            matches(entry.node.accessibility.label, match, entry.node, options),
        )
        .map((entry) => entry.node),
    'label',
    scope,
  );
  return {
    getByRole: role.get,
    getAllByRole: role.getAll,
    queryByRole: role.query,
    queryAllByRole: role.queryAll,
    findByRole: (
      match: SemanticRole,
      options?: RoleOptions,
      wait?: WaitOptions,
    ) => waitFor(() => role.get(match, options), wait, wrap),
    findAllByRole: (
      match: SemanticRole,
      options?: RoleOptions,
      wait?: WaitOptions,
    ) => waitFor(() => role.getAll(match, options), wait, wrap),
    getByText: text.get,
    getAllByText: text.getAll,
    queryByText: text.query,
    queryAllByText: text.queryAll,
    findByText: (
      match: TextMatch,
      options?: MatchOptions,
      wait?: WaitOptions,
    ) => waitFor(() => text.get(match, options), wait, wrap),
    findAllByText: (
      match: TextMatch,
      options?: MatchOptions,
      wait?: WaitOptions,
    ) => waitFor(() => text.getAll(match, options), wait, wrap),
    getByLabelText: label.get,
    getAllByLabelText: label.getAll,
    queryByLabelText: label.query,
    queryAllByLabelText: label.queryAll,
    findByLabelText: (
      match: TextMatch,
      options?: MatchOptions,
      wait?: WaitOptions,
    ) => waitFor(() => label.get(match, options), wait, wrap),
    findAllByLabelText: (
      match: TextMatch,
      options?: MatchOptions,
      wait?: WaitOptions,
    ) => waitFor(() => label.getAll(match, options), wait, wrap),
    debug: (target?: NodeTarget) => {
      console.log(formatTree(target ?? scope));
    },
  };
}
export const within = (scope: NodeTarget) => createQueries(scope);
export const screen = createQueries();
