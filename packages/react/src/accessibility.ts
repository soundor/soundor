/**
 * Accessibility props: what an element is to assistive technology (screen
 * readers and the like), named as in React Native. The host config turns
 * them into the node's `accessibility` (soundor:ui), which every runtime
 * presents to its platform.
 */

import type {
  Accessibility,
  AccessibilityAction,
  AccessibilityActionEvent,
  AccessibilityRole,
  AccessibilityState,
  AccessibilityValue,
} from 'soundor:ui';

export type {
  AccessibilityActionEvent,
  AccessibilityActionName,
  AccessibilityRole,
  AccessibilityState,
  AccessibilityValue,
} from 'soundor:ui';

/** An action an element offers: a standard one, or a custom one by label. */
export type AccessibilityActionInfo = AccessibilityAction;

export interface AccessibilityProps {
  /**
   * true: the element is one thing to assistive technology, its descendants'
   * text its label; false: the element itself is not perceived (its
   * descendants still are). By default text and text inputs are, pressables
   * are, and an element given a role or a label is.
   */
  accessible?: boolean;
  /** What is read for the element; by default, its text. */
  accessibilityLabel?: string;
  /** What acting on the element does, when the label does not say. */
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  /** A range's value ('adjustable', 'progressbar'), and how to read it. */
  accessibilityValue?: AccessibilityValue;
  /**
   * The actions the element responds to, through onAccessibilityAction:
   * 'increment', 'decrement', 'activate'... or custom ones, with a label.
   */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  /**
   * Assistive technology asks for an action of this element. Call
   * `event.preventDefault()` to keep the runtime's own response (a
   * Pressable's onPress for 'activate', focus for 'focus') from following.
   */
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}

/** A node's `accessibility` from an element's props. */
export function accessibilityOf(
  props: Readonly<Record<string, unknown>>,
): Accessibility {
  const out: Record<string, unknown> = {};
  const map = (prop: string, key: keyof Accessibility) => {
    if (props[prop] !== undefined) out[key] = props[prop];
  };
  map('accessible', 'accessible');
  map('accessibilityRole', 'role');
  map('accessibilityLabel', 'label');
  map('accessibilityHint', 'hint');
  map('accessibilityState', 'state');
  map('accessibilityValue', 'value');
  map('accessibilityActions', 'actions');
  return out as Accessibility;
}

/**
 * `actions` with the standard ones an element offers by itself first, unless
 * listed already (by name).
 */
export function withActions(
  implicit: readonly AccessibilityActionInfo[],
  actions: readonly AccessibilityActionInfo[] | undefined,
): readonly AccessibilityActionInfo[] {
  const listed = new Set((actions ?? []).map((action) => action.name));
  return [
    ...implicit.filter((action) => !listed.has(action.name)),
    ...(actions ?? []),
  ];
}
