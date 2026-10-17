import type { DebugNode, DebugTree, NodeRef } from '@soundor/devtools-protocol';

import { DriverError, isDriverError } from './errors';
import type { CallOptions } from './transport';

/** What a locator finds: a query, resolved against the live tree each time. */
export type Selector =
  /** The node whose `debugId` prop is this. */
  | { debugId: string }
  /**
   * A node exposed to assistive technology with this role (`button`,
   * `adjustable`, …), and this accessible name if given.
   */
  | { role: string; name?: string; exact?: boolean }
  /** A text or input node showing this text. */
  | { text: string; exact?: boolean };

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a locator needs from its Driver. */
export interface LocatorHost {
  getTree(options?: CallOptions): Promise<DebugTree>;
  getNode(ref: NodeRef, options?: CallOptions): Promise<DebugNode>;
  getLayout(
    ref: NodeRef,
    options?: CallOptions,
  ): Promise<Record<string, unknown>>;
  getStyles(
    ref: NodeRef,
    options?: CallOptions,
  ): Promise<Record<string, unknown>>;
  getAccessibility(
    ref: NodeRef,
    options?: CallOptions,
  ): Promise<Record<string, unknown>>;
}

// A node can go between finding it and reading it (a re-render, a reload):
// reads are safe to retry, from the query.
const ATTEMPTS = 3;

function text(value: string | undefined, wanted: string, exact = true) {
  if (value === undefined) return false;
  return exact
    ? value === wanted
    : value.toLowerCase().includes(wanted.toLowerCase());
}

export function matches(node: DebugNode, selector: Selector): boolean {
  if ('debugId' in selector) return node.debugId === selector.debugId;
  if ('role' in selector) {
    const accessibility = node.accessibility ?? {};
    if (accessibility['exposed'] === false) return false;
    if (accessibility['role'] !== selector.role) return false;
    const name = accessibility['name'];
    return (
      selector.name === undefined ||
      text(
        typeof name === 'string' ? name : undefined,
        selector.name,
        selector.exact,
      )
    );
  }
  return text(node.text, selector.text, selector.exact);
}

export function describe(selector: Selector): string {
  if ('debugId' in selector)
    return `getByDebugId(${JSON.stringify(selector.debugId)})`;
  const exact = selector.exact === false ? ', exact: false' : '';
  if ('role' in selector)
    return `getByRole(${JSON.stringify(selector.role)}${selector.name === undefined ? '' : `, { name: ${JSON.stringify(selector.name)}${exact} }`})`;
  return `getByText(${JSON.stringify(selector.text)}${exact ? ', { exact: false }' : ''})`;
}

/**
 * A lazy query for one node of the selected target. It holds no node
 * reference: every call finds the node again in the live tree, so it follows
 * re-renders and reloads, and fails when the node is gone or not unique.
 */
export class Locator {
  readonly #host: LocatorHost;
  readonly selector: Readonly<Selector>;

  constructor(host: LocatorHost, selector: Selector) {
    this.#host = host;
    this.selector = Object.freeze({ ...selector });
  }

  toString(): string {
    return describe(this.selector);
  }

  /** The matching nodes of a current tree snapshot (summaries). */
  async all(options?: CallOptions): Promise<DebugNode[]> {
    const tree = await this.#host.getTree(options);
    return tree.nodes.filter((node) => matches(node, this.selector));
  }

  /** How many nodes match now. */
  async count(options?: CallOptions): Promise<number> {
    return (await this.all(options)).length;
  }

  /** The unique matching node now, with all its details. */
  async getNode(options?: CallOptions): Promise<DebugNode> {
    for (let attempt = 1; ; ++attempt) {
      const ref = await this.#find(options);
      try {
        const node = await this.#host.getNode(ref, options);
        // Read again if it changed into something else in between.
        if (matches(node, this.selector) || attempt === ATTEMPTS) return node;
      } catch (error) {
        if (
          attempt === ATTEMPTS ||
          !(
            isDriverError(error, 'STALE_NODE') ||
            isDriverError(error, 'GENERATION_CHANGED')
          )
        )
          throw error;
      }
    }
  }

  /** Its box, in the view's logical pixels (as `getBoundingClientRect()`). */
  async getBounds(options?: CallOptions): Promise<Bounds> {
    return (await this.getNode(options)).bounds;
  }

  async getLayout(options?: CallOptions): Promise<Record<string, unknown>> {
    return this.#read((ref) => this.#host.getLayout(ref, options), options);
  }

  async getStyles(options?: CallOptions): Promise<Record<string, unknown>> {
    return this.#read((ref) => this.#host.getStyles(ref, options), options);
  }

  async getAccessibility(
    options?: CallOptions,
  ): Promise<Record<string, unknown>> {
    return this.#read(
      (ref) => this.#host.getAccessibility(ref, options),
      options,
    );
  }

  async #read<T>(
    read: (ref: NodeRef) => Promise<T>,
    options: CallOptions | undefined,
  ): Promise<T> {
    for (let attempt = 1; ; ++attempt) {
      const ref = await this.#find(options);
      try {
        return await read(ref);
      } catch (error) {
        if (
          attempt === ATTEMPTS ||
          !(
            isDriverError(error, 'STALE_NODE') ||
            isDriverError(error, 'GENERATION_CHANGED')
          )
        )
          throw error;
      }
    }
  }

  /** The reference of the unique match in a fresh snapshot. */
  async #find(options?: CallOptions): Promise<NodeRef> {
    const tree = await this.#host.getTree(options);
    const found = tree.nodes.filter((node) => matches(node, this.selector));
    if (found.length === 1) return found[0]!.ref;
    if (found.length === 0)
      throw new DriverError(
        'ELEMENT_NOT_FOUND',
        `${this} matches no node${tree.truncated ? ` of the ${tree.nodes.length} in the (truncated) snapshot` : ''}`,
      );
    const listed = found
      .slice(0, 5)
      .map((node) => `${node.type} ${node.ref.id}`)
      .join(', ');
    throw new DriverError(
      'AMBIGUOUS_ELEMENT',
      `${this} matches ${found.length} nodes (${listed}${found.length > 5 ? ', …' : ''}); make the query unique`,
    );
  }
}
