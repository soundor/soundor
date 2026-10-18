import type {
  AnimationChange,
  DebugAnimation,
  DebugMetrics,
  DebugNode,
  DebugTarget,
  DebugTree,
  NodeRef,
  ServerMessage,
  eventPayloads,
} from '@soundor/devtools-protocol';

import { mergeMetrics } from './diagnostics';

export interface LogEntry {
  level: string;
  message: string;
  source: string;
  timestamp: number;
  scope: string;
}
export interface SelectionRequest {
  viewEpoch: number;
  selectionEpoch: number;
  changed: boolean;
}
type Event = Extract<ServerMessage, { type: 'event' }>;
type Payload<E extends keyof typeof eventPayloads> =
  (typeof eventPayloads)[E]['_output'];
export type EventEffect =
  | { type: 'ignored' | 'logs' | 'controls' | 'metrics' }
  | { type: 'targets'; targets: DebugTarget[] }
  | { type: 'generation'; generation: number }
  | { type: 'selection'; node: NodeRef }
  | {
      type: 'tree';
      structure: boolean;
      patched: boolean;
      metadataIncomplete: boolean;
    }
  | { type: 'animations'; truncated: boolean };

/** Protocol state and stale-response guards, independent of the DOM and transport. */
export class InspectorState {
  targets: DebugTarget[] = [];
  targetId = '';
  clientId = '';
  connected = false;
  tree: DebugTree | undefined;
  nodes = new Map<string, DebugNode>();
  selected: NodeRef | undefined;
  readonly expanded = new Set<string>();
  readonly logs: LogEntry[] = [];
  performance: DebugMetrics | undefined;
  activeAnimations: DebugAnimation[] = [];
  readonly animationHistory: AnimationChange[] = [];
  picker = false;
  viewEpoch = 0;
  selectionEpoch = 0;
  inspectedGeneration = 0;

  currentTarget() {
    return this.targets.find((target) => target.id === this.targetId);
  }
  supports(capability: string) {
    return (
      this.currentTarget()?.capabilities.some(
        (value) => value === capability,
      ) ?? false
    );
  }
  clearInspection() {
    ++this.viewEpoch;
    ++this.selectionEpoch;
    this.inspectedGeneration = 0;
    this.performance = undefined;
    this.activeAnimations = [];
    this.animationHistory.length = 0;
    this.tree = undefined;
    this.nodes.clear();
    this.selected = undefined;
    this.expanded.clear();
    this.picker = false;
  }
  clearSelection() {
    this.selected = undefined;
    ++this.selectionEpoch;
  }
  beginSelection(ref: NodeRef): SelectionRequest | undefined {
    if (ref.generation !== this.currentTarget()?.generation) return;
    const changed =
      this.selected?.id !== ref.id ||
      this.selected?.generation !== ref.generation;
    this.selected = ref;
    return {
      changed,
      viewEpoch: this.viewEpoch,
      selectionEpoch: ++this.selectionEpoch,
    };
  }
  isCurrentSelection(request: SelectionRequest): boolean {
    return (
      request.viewEpoch === this.viewEpoch &&
      request.selectionEpoch === this.selectionEpoch
    );
  }
  acceptTree(
    snapshot: DebugTree,
    epoch: number,
  ): 'ignored' | 'updated' | 'selection-removed' {
    if (
      epoch !== this.viewEpoch ||
      snapshot.generation !== this.currentTarget()?.generation
    )
      return 'ignored';
    this.tree = snapshot;
    this.nodes = new Map(snapshot.nodes.map((node) => [node.ref.id, node]));
    for (const root of snapshot.roots) this.expanded.add(root);
    if (this.selected && !this.nodes.has(this.selected.id)) {
      this.clearSelection();
      return 'selection-removed';
    }
    return 'updated';
  }
  acceptMetrics(metrics: DebugMetrics, full = false): boolean {
    if (metrics.generation !== this.currentTarget()?.generation) return false;
    this.performance = mergeMetrics(this.performance, metrics, full);
    return true;
  }
  applyEvent(message: Event): EventEffect {
    if (message.event === 'Runtime.targetsChanged')
      return { type: 'targets', targets: message.data };
    if (message.event === 'Console.message') {
      const data = message.data as Payload<'Console.message'>;
      this.logs.push({
        ...data,
        scope:
          message.scope === 'session' ? 'session' : (message.targetId ?? ''),
      });
      if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000);
      return { type: 'logs' };
    }
    if (message.targetId !== this.targetId) return { type: 'ignored' };
    switch (message.event) {
      case 'Runtime.generationChanged':
        return {
          type: 'generation',
          generation: (message.data as Payload<'Runtime.generationChanged'>)
            .generation,
        };
      case 'UI.pickerChanged':
        this.picker = (message.data as Payload<'UI.pickerChanged'>).enabled;
        return { type: 'controls' };
      case 'UI.nodeSelected': {
        const { node } = message.data as Payload<'UI.nodeSelected'>;
        // This tab's own pick: the instance sends picks to their picker.
        if (node.generation !== this.currentTarget()?.generation)
          return { type: 'ignored' };
        this.picker = false;
        return { type: 'selection', node };
      }
      case 'UI.treeChanged': {
        const change = message.data as Payload<'UI.treeChanged'>;
        if (change.generation !== this.currentTarget()?.generation)
          return { type: 'ignored' };
        for (const node of change.nodes ?? [])
          if (this.nodes.has(node.ref.id)) this.nodes.set(node.ref.id, node);
        return {
          type: 'tree',
          structure: change.kind !== 'properties',
          patched: !!change.nodes?.length,
          metadataIncomplete: !!change.metadataIncomplete,
        };
      }
      case 'Diagnostics.metrics':
        return {
          type: this.acceptMetrics(message.data as DebugMetrics)
            ? 'metrics'
            : 'ignored',
        };
      case 'Animation.changed': {
        const change = message.data as Payload<'Animation.changed'>;
        if (change.generation !== this.currentTarget()?.generation)
          return { type: 'ignored' };
        this.animationHistory.push(...change.changes);
        if (this.animationHistory.length > 100)
          this.animationHistory.splice(0, this.animationHistory.length - 100);
        return { type: 'animations', truncated: change.truncated };
      }
    }
  }
}
