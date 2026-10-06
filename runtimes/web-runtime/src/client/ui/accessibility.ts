/**
 * `UiNode.accessibility`: what a node is to assistive technology. Checked
 * as the JUCE runtime checks it, with the same errors.
 */

import type { Accessibility, AccessibilityRole } from './types';

const ROLES: ReadonlySet<string> = new Set<AccessibilityRole>([
  'none',
  'text',
  'image',
  'button',
  'link',
  'adjustable',
  'checkbox',
  'switch',
  'togglebutton',
  'radio',
  'radiogroup',
  'progressbar',
  'search',
  'combobox',
  'menu',
  'menubar',
  'menuitem',
  'scrollbar',
  'spinbutton',
  'tab',
  'tablist',
  'header',
  'summary',
  'keyboardkey',
  'timer',
  'toolbar',
  'alert',
  'dialog',
]);

/** `accessibility` with every key present: null where unset. */
export interface NormalizedAccessibility {
  readonly accessible: boolean | null;
  readonly role: AccessibilityRole | null;
  readonly label: string;
  readonly hint: string;
  readonly state: {
    readonly disabled: boolean;
    readonly busy: boolean;
    readonly checked: boolean | 'mixed' | null;
    readonly selected: boolean | null;
    readonly expanded: boolean | null;
  };
  readonly value: {
    readonly min: number | null;
    readonly max: number | null;
    readonly now: number | null;
    readonly text: string;
  };
  readonly actions: readonly {
    readonly name: string;
    readonly label: string;
  }[];
  readonly modal: boolean;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object')
    return (value as object).constructor?.name ?? 'object';
  return typeof value;
}

type Primitive = 'string' | 'number' | 'boolean';
type TypeOf<T extends Primitive> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : boolean;

function optional<T extends Primitive>(
  object: object,
  key: string,
  type: T,
  path: string,
): TypeOf<T> | null {
  const value = (object as Record<string, unknown>)[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== type)
    throw new TypeError(
      `${path}.${key}: expected a ${type}, got ${describe(value)}`,
    );
  return value as TypeOf<T>;
}

function expectObject(value: unknown, path: string): object {
  if (typeof value !== 'object' || value === null)
    throw new TypeError(`${path}: expected an object, got ${describe(value)}`);
  return value;
}

/** Checks `accessibility`; throws a TypeError naming what is wrong. */
export function normalizeAccessibility(
  value: Readonly<Accessibility> | null | undefined,
): NormalizedAccessibility {
  const given: object = value ?? {};
  if (typeof given !== 'object')
    throw new TypeError(
      `accessibility must be an object, got ${describe(value)}`,
    );
  const fields = given as Record<string, unknown>;
  const role = optional(given, 'role', 'string', 'accessibility');
  if (role !== null && !ROLES.has(role))
    throw new TypeError(`accessibility.role: unknown role '${role}'`);
  const state = expectObject(fields['state'] ?? {}, 'accessibility.state');
  const checked = (state as Record<string, unknown>)['checked'] ?? null;
  if (checked !== null && typeof checked !== 'boolean' && checked !== 'mixed')
    throw new TypeError(
      `accessibility.state.checked: expected a boolean or 'mixed', got ${describe(checked)}`,
    );
  const range = expectObject(fields['value'] ?? {}, 'accessibility.value');
  const number = (key: string): number | null => {
    const at = optional(range, key, 'number', 'accessibility.value');
    if (at !== null && !Number.isFinite(at))
      throw new TypeError(
        `accessibility.value.${key}: expected a finite number, got ${at}`,
      );
    return at;
  };
  const actions = fields['actions'] ?? [];
  if (!Array.isArray(actions))
    throw new TypeError(
      `accessibility.actions: expected an array, got ${describe(actions)}`,
    );
  return {
    accessible: optional(given, 'accessible', 'boolean', 'accessibility'),
    role: role as AccessibilityRole | null,
    label: optional(given, 'label', 'string', 'accessibility') ?? '',
    hint: optional(given, 'hint', 'string', 'accessibility') ?? '',
    state: {
      disabled:
        optional(state, 'disabled', 'boolean', 'accessibility.state') ?? false,
      busy: optional(state, 'busy', 'boolean', 'accessibility.state') ?? false,
      checked: checked as boolean | 'mixed' | null,
      selected: optional(state, 'selected', 'boolean', 'accessibility.state'),
      expanded: optional(state, 'expanded', 'boolean', 'accessibility.state'),
    },
    value: {
      min: number('min'),
      max: number('max'),
      now: number('now'),
      text: optional(range, 'text', 'string', 'accessibility.value') ?? '',
    },
    actions: (actions as unknown[]).map((action, i) => {
      const path = `accessibility.actions[${i}]`;
      const entry = expectObject(action, path);
      const name = (entry as Record<string, unknown>)['name'];
      if (typeof name !== 'string')
        throw new TypeError(
          `${path}.name: expected a string, got ${describe(name)}`,
        );
      if (name === '') throw new TypeError(`${path}.name: must not be empty`);
      return { name, label: optional(entry, 'label', 'string', path) ?? '' };
    }),
    modal: optional(given, 'modal', 'boolean', 'accessibility') ?? false,
  };
}

/** A frozen copy of what plugin code gave. */
export function freezeAccessibility(
  value: Readonly<Accessibility> | null | undefined,
): Readonly<Accessibility> {
  const copy: Accessibility = { ...value };
  if (copy.state !== undefined) copy.state = Object.freeze({ ...copy.state });
  if (copy.value !== undefined) copy.value = Object.freeze({ ...copy.value });
  if (copy.actions !== undefined)
    copy.actions = Object.freeze(
      copy.actions.map((action) => Object.freeze({ ...action })),
    );
  return Object.freeze(copy);
}
