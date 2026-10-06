/**
 * What assistive technology perceives of the view, on the DOM: the JUCE
 * runtime's semantic tree (`a11y::SurfaceSemantics`), rule for rule, set as
 * ARIA on the elements that draw the nodes. No second, hidden DOM: the
 * browser builds its accessibility tree from these elements, and native
 * elements (an input, an image) keep their own semantics.
 */

import type { NormalizedAccessibility } from './accessibility';
import { UiNode } from './node';
import type { AccessibilityRole } from './types';

/** The attributes this module owns on an element. */
const OWNED = [
  'role',
  'aria-label',
  'aria-description',
  'aria-disabled',
  'aria-selected',
  'aria-checked',
  'aria-pressed',
  'aria-expanded',
  'aria-busy',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuenow',
  'aria-valuetext',
  'aria-modal',
  'aria-hidden',
  'aria-owns',
] as const;

type Attributes = Partial<
  Record<(typeof OWNED)[number] | 'alt' | 'id', string>
>;

/** A role of the semantic tree: plugin code's, or one the runtime gives. */
type Role =
  | Exclude<AccessibilityRole, 'none'>
  | 'group'
  | 'textinput'
  | 'scrollview';

/** ARIA roles by Soundor role; null: the element's own (or none). */
const ARIA_ROLES: Readonly<Record<Role, string | null>> = {
  text: null,
  image: 'img',
  button: 'button',
  link: 'link',
  adjustable: 'slider',
  checkbox: 'checkbox',
  switch: 'switch',
  togglebutton: 'button',
  radio: 'radio',
  radiogroup: 'radiogroup',
  progressbar: 'progressbar',
  search: 'search',
  combobox: 'combobox',
  menu: 'menu',
  menubar: 'menubar',
  menuitem: 'menuitem',
  scrollbar: 'scrollbar',
  spinbutton: 'spinbutton',
  tab: 'tab',
  tablist: 'tablist',
  header: 'heading',
  summary: 'region',
  keyboardkey: 'button',
  timer: 'timer',
  toolbar: 'toolbar',
  alert: 'alert',
  dialog: 'dialog',
  group: 'group',
  textinput: null,
  scrollview: 'group',
};

/** Roles read as a whole: descendants are their content, not elements. */
const LEAF_ROLES: ReadonlySet<Role> = new Set<Role>([
  'text',
  'image',
  'button',
  'link',
  'adjustable',
  'checkbox',
  'switch',
  'togglebutton',
  'radio',
  'progressbar',
  'combobox',
  'menuitem',
  'scrollbar',
  'spinbutton',
  'tab',
  'header',
  'keyboardkey',
  'timer',
  'textinput',
]);

/** Roles ARIA gives a value range. */
const RANGE_ROLES: ReadonlySet<string> = new Set([
  'slider',
  'progressbar',
  'scrollbar',
  'spinbutton',
]);

/** Roles ARIA gives aria-checked. */
const CHECKED_ROLES: ReadonlySet<string> = new Set([
  'checkbox',
  'switch',
  'radio',
  'menuitemcheckbox',
  'menuitemradio',
]);

const semanticsOf = (node: UiNode): NormalizedAccessibility =>
  UiNode.semanticsOf(node);
const elementOf = (node: UiNode): HTMLElement => UiNode.elementOf(node);
const displayed = (node: UiNode): boolean => node.style.display !== 'none';

function isElement(node: UiNode): boolean {
  const semantics = semanticsOf(node);
  if (semantics.accessible !== null) return semantics.accessible;
  if (semantics.modal) return true;
  if (semantics.role !== null) return semantics.role !== 'none';
  if (semantics.label !== '') return true;
  if (node.type === 'text') return node.text !== '';
  return node.type === 'input';
}

function roleOf(node: UiNode): Role {
  const semantics = semanticsOf(node);
  if (semantics.role !== null && semantics.role !== 'none')
    return semantics.role;
  if (semantics.modal) return 'dialog';
  switch (node.type) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'input':
      return 'textinput';
    case 'scroll':
      return 'scrollview';
    default:
      return 'group';
  }
}

function appendText(label: string, text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return label;
  return label === '' ? trimmed : `${label} ${trimmed}`;
}

/** One pass over the view: its elements, and the DOM made to match. */
class Pass {
  /** Nodes read at their accessibility parent, by that parent. */
  readonly #owned = new Map<UiNode, UiNode[]>();
  readonly #relocated = new Set<UiNode>();
  /** Elements in reading order, and which are read whole. */
  readonly #order: UiNode[] = [];
  readonly #children = new Map<UiNode, UiNode[]>();
  readonly #labels = new Map<UiNode, string>();

  constructor(readonly roots: readonly UiNode[]) {
    for (const root of roots) this.#indexOwnership(root);
    for (const root of roots) this.#visit(root, []);
  }

  #readParent(node: UiNode): UiNode | null {
    return node.accessibilityParent ?? node.parent;
  }

  /** An accessibility parent counts when in the view and not looping. */
  #readsElsewhere(node: UiNode): boolean {
    const parent = node.accessibilityParent;
    if (parent === null || !parent.isConnected) return false;
    const seen = new Set<UiNode>([node]);
    for (let at: UiNode | null = parent; at !== null; at = this.#readParent(at))
      if (seen.has(at)) return false;
      else seen.add(at);
    return true;
  }

  #indexOwnership(node: UiNode): void {
    if (node.accessibilityParent !== null && this.#readsElsewhere(node)) {
      const owner = node.accessibilityParent;
      this.#owned.set(owner, [...(this.#owned.get(owner) ?? []), node]);
      this.#relocated.add(node);
    }
    for (const child of node.children) this.#indexOwnership(child);
  }

  /** The children `node` is read with. */
  readChildren(node: UiNode): UiNode[] {
    return [
      ...node.children.filter((child) => !this.#relocated.has(child)),
      ...(this.#owned.get(node) ?? []),
    ];
  }

  owned(node: UiNode): readonly UiNode[] {
    return this.#owned.get(node) ?? [];
  }

  #collectText(node: UiNode, label: string): string {
    for (const child of this.readChildren(node)) {
      if (!displayed(child)) continue;
      const own = semanticsOf(child).label;
      if (own !== '') {
        label = appendText(label, own);
        continue;
      }
      if (child.type === 'text') label = appendText(label, child.text);
      label = this.#collectText(child, label);
    }
    return label;
  }

  #visit(node: UiNode, into: UiNode[]): void {
    if (!displayed(node)) return;
    if (!isElement(node)) {
      for (const child of this.readChildren(node)) this.#visit(child, into);
      return;
    }
    const semantics = semanticsOf(node);
    const role = roleOf(node);
    this.#order.push(node);
    into.push(node);
    const children: UiNode[] = [];
    this.#children.set(node, children);
    const whole =
      LEAF_ROLES.has(role) ||
      (semantics.accessible === true && role === 'group');
    if (whole) {
      if (semantics.label === '' && node.type !== 'text')
        this.#labels.set(node, this.#collectText(node, ''));
    } else
      for (const child of this.readChildren(node)) this.#visit(child, children);
  }

  isElement(node: UiNode): boolean {
    return this.#children.has(node);
  }

  /** The label read from descendants, for an element read whole. */
  implicitLabel(node: UiNode): string {
    return this.#labels.get(node) ?? '';
  }

  /** The modal element read alone: the last one shown. */
  activeModal(): UiNode | null {
    return this.#order.findLast((node) => semanticsOf(node).modal) ?? null;
  }

  /** `modal` and every node read under it. */
  readUnder(modal: UiNode): Set<UiNode> {
    const kept = new Set<UiNode>();
    const add = (node: UiNode): void => {
      kept.add(node);
      for (const child of this.readChildren(node)) add(child);
    };
    add(modal);
    return kept;
  }
}

let ids = 0;

/** A stable id for an element another one owns (aria-owns). */
function idOf(element: HTMLElement): string {
  if (element.id === '') element.id = `sd-a11y-${++ids}`;
  return element.id;
}

function attributesOf(node: UiNode, pass: Pass): Attributes {
  const out: Attributes = {};
  const owned = pass.owned(node);
  if (owned.length > 0)
    out['aria-owns'] = owned.map((child) => idOf(elementOf(child))).join(' ');
  const semantics = semanticsOf(node);

  if (!pass.isElement(node)) {
    // The node itself is not perceived; what it holds still is.
    if (node.type === 'text' && semantics.accessible === false)
      out['aria-hidden'] = 'true';
    if (node.type === 'image') out.alt = '';
    return out;
  }

  const role = roleOf(node);
  const aria =
    node.type === 'image' && role === 'image' ? null : ARIA_ROLES[role];
  const labelled = role !== 'text' || semantics.label !== '';
  if (aria !== null) out.role = aria;
  else if (role === 'text' && labelled) out.role = 'group';
  const label = semantics.label || pass.implicitLabel(node);
  if (node.type === 'image') out.alt = label;
  else if (label !== '' && (aria !== null || labelled))
    out['aria-label'] = label;
  if (semantics.hint !== '') out['aria-description'] = semantics.hint;

  const { state, value } = semantics;
  if (state.disabled) out['aria-disabled'] = 'true';
  if (state.busy) out['aria-busy'] = 'true';
  if (state.selected !== null) out['aria-selected'] = String(state.selected);
  if (state.expanded !== null) out['aria-expanded'] = String(state.expanded);
  if (state.checked !== null) {
    const checked = String(state.checked);
    if (role === 'togglebutton') out['aria-pressed'] = checked;
    else if (aria !== null && CHECKED_ROLES.has(aria))
      out['aria-checked'] = checked;
  }
  if (aria !== null && RANGE_ROLES.has(aria)) {
    if (value.min !== null) out['aria-valuemin'] = String(value.min);
    if (value.max !== null) out['aria-valuemax'] = String(value.max);
    if (value.now !== null) out['aria-valuenow'] = String(value.now);
  }
  if (value.text !== '' && node.type !== 'input')
    out['aria-valuetext'] = value.text;
  if (semantics.modal) out['aria-modal'] = 'true';
  return out;
}

/** The attributes last set, by node. */
const applied = new WeakMap<UiNode, Attributes>();

function apply(node: UiNode, attributes: Attributes): void {
  const element = elementOf(node);
  const before = applied.get(node) ?? {};
  for (const name of Object.keys(before) as (keyof Attributes)[]) {
    if (name === 'id' || attributes[name] !== undefined) continue;
    element.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(attributes))
    if (before[name as keyof Attributes] !== value)
      element.setAttribute(name, value);
  applied.set(node, attributes);
}

/**
 * Brings the ARIA of the view's trees up to date. While a modal element
 * shows, everything but it and what is read under it is hidden.
 */
export function updateSemantics(roots: readonly UiNode[]): void {
  const pass = new Pass(roots);
  const modal = pass.activeModal();
  const kept = modal === null ? null : pass.readUnder(modal);
  /** Nodes holding something kept, which stay for their kept part. */
  const holding = new Set<UiNode>();
  if (kept !== null)
    for (const node of kept)
      for (let at = node.parent; at !== null; at = at.parent) holding.add(at);

  const walk = (node: UiNode, hidden: boolean): void => {
    const attributes = attributesOf(node, pass);
    // The topmost node outside the modal hides its whole subtree.
    const hide =
      !hidden && kept !== null && !kept.has(node) && !holding.has(node);
    if (hide) attributes['aria-hidden'] = 'true';
    apply(node, attributes);
    for (const child of node.children) walk(child, hidden || hide);
  };
  for (const root of roots) walk(root, false);
}
