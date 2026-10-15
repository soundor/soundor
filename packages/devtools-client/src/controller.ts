import type {
  DebugTarget,
  NodeRef,
  ServerMessage,
  EventName,
  DebugMetrics,
  DebugNode,
} from '@soundor/devtools-protocol';

import { createBrowserSession } from './browser-session';
import { createConnectionRequests } from './connection';
import { InspectorState } from './state';
/** Async protocol orchestration and a revision subscription for the React views. */
export function createInspector(win: Window & typeof globalThis) {
  const state = new InspectorState();
  const listeners = new Set<() => void>();
  let revision = 0;
  let disposed = false;
  let animationLoading = false;
  const ui = {
    status: 'Connecting…',
    notice: '',
    authRequired: false,
    treeMessage: 'Waiting for a runtime to connect.',
    treeNote: '',
    search: '',
    dock: 'console',
    diagnosticsBusy: false,
    details: undefined as DebugNode | undefined,
    detailAnimations: undefined as Record<string, unknown> | undefined,
    reveal: 0,
  };
  function notify() {
    if (disposed) return;
    revision++;
    for (const listener of listeners) listener();
  }
  function emptyTree(message: string) {
    ui.treeMessage = message;
    notify();
  }
  function updateTree() {
    if (state.tree) ui.treeMessage = '';
    notify();
  }
  function setDetails(node?: DebugNode) {
    ui.details = node;
    ui.detailAnimations = undefined;
    notify();
  }
  let refreshTimer = 0;
  let logTimer = 0;
  let highlightTimer = 0;
  let refreshing = false;
  let refreshAgain = false;
  let highlighting = false;
  let nextHighlight: NodeRef | null | undefined;
  function report(message: string) {
    ui.notice = message;
    notify();
  }
  function currentTarget() {
    return state.currentTarget();
  }
  function ownsControl() {
    return state.ownsControl();
  }
  function supports(capability: string) {
    return state.supports(capability);
  }
  function fail(error: unknown) {
    report(error instanceof Error ? error.message : String(error));
  }
  function run(task: Promise<unknown>) {
    void task.catch(fail);
  }
  const { request, cancelRequests, settle } = createConnectionRequests({
    win,
    getSocket: () => session.socket,
    getTargetId: () => state.targetId,
    isConnected: () => state.connected,
  });
  const session = createBrowserSession({
    win,
    state,
    onMessage: receive,
    report,
    isAuthorizing: () => ui.authRequired,
    setAuthRequired(value) {
      ui.authRequired = value;
      notify();
    },
    setStatus(value) {
      ui.status = value;
      notify();
    },
    onDisconnect() {
      cancelRequests(undefined);
      state.targets = [];
      state.targetId = '';
      clearInspection();
      emptyTree('Development session disconnected. Reconnecting…');
    },
  });
  function clearInspection() {
    state.clearInspection();
    animationLoading = false;
    ui.diagnosticsBusy = false;
    nextHighlight = undefined;
    win.clearTimeout(refreshTimer);
    win.clearTimeout(highlightTimer);
    refreshing = false;
    refreshAgain = false;
    ui.treeNote = '';
    setDetails();
  }
  async function switchTarget(id: string) {
    const previous = state.targetId;
    if (previous === id) return;
    // Release only our own lease; observers never clear somebody else's overlay.
    const wasController = ownsControl();
    clearInspection();
    if (state.connected && previous) {
      cancelRequests(previous);
      void request(
        'Events.subscribe',
        {
          events: [],
        },
        previous,
      ).catch(() => {});
      if (wasController)
        void request('Control.release', {}, previous).catch(() => {});
    }
    state.targetId = id;
    state.inspectedGeneration = currentTarget()?.generation ?? 0;
    report('');
    emptyTree(id ? 'Loading native UI…' : 'Waiting for a runtime to connect.');
    if (!id || !state.connected) return;
    const epoch = state.viewEpoch;
    const events: EventName[] = [
      'UI.treeChanged',
      'UI.nodeSelected',
      'UI.pickerChanged',
      'Runtime.generationChanged',
      'Console.message',
    ];
    if (supports('animations')) events.push('Animation.changed');
    if (supports('performance')) events.push('Diagnostics.metrics');
    try {
      await request(
        'Events.subscribe',
        {
          events,
        },
        id,
      );
      if (epoch !== state.viewEpoch) return;
      if (supports('performance')) {
        const metrics = await request('Diagnostics.getMetrics', {});
        if (epoch !== state.viewEpoch) return;
        acceptMetrics(metrics, true);
      }
      if (ui.dock === 'animations') run(loadAnimations());
      if (supports('inspector')) await refreshTree();
      else emptyTree('This target does not support native UI inspection.');
    } catch (error) {
      if (epoch === state.viewEpoch) fail(error);
    }
  }
  function updateTargets(updated: DebugTarget[]) {
    const before = currentTarget();
    state.targets = updated;
    const after = currentTarget();
    if (!after && state.targetId) {
      cancelRequests(state.targetId);
      state.targetId = '';
      clearInspection();
      emptyTree('Target disconnected. Select another connected runtime.');
      report(
        'The selected runtime disconnected; its node references are invalid.',
      );
    }
    if (!state.targetId && state.targets.length)
      run(switchTarget(state.targets[0]?.id ?? ''));
    else if (after && before?.generation !== after.generation)
      generationChanged(after.generation);
    if (!ownsControl()) {
      state.picker = false;
      nextHighlight = undefined;
    }
    notify();
  }
  function generationChanged(generation: number) {
    const target = currentTarget();
    if (!target || state.inspectedGeneration === generation) return;
    target.generation = generation;
    cancelRequests(state.targetId);
    clearInspection();
    state.inspectedGeneration = generation;
    report('Runtime reloaded. Previous node references have been cleared.');
    emptyTree('Loading the new runtime generation…');
    run(refreshTree());
  }
  async function refreshTree() {
    if (!supports('inspector') || !state.connected) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    const epoch = state.viewEpoch;
    refreshing = true;
    try {
      const snapshot = await request('UI.getTree', {});
      const update = state.acceptTree(snapshot, epoch);
      if (update === 'ignored') return;
      ui.treeNote = snapshot.truncated
        ? 'Snapshot limit reached. Use the native picker to inspect omitted nodes.'
        : '';
      if (update === 'selection-removed') {
        setDetails();
      }
      updateTree();
      if (state.selected) await selectNode(state.selected, false, false);
    } catch (error) {
      if (epoch === state.viewEpoch) fail(error);
    } finally {
      if (epoch === state.viewEpoch) {
        refreshing = false;
        if (refreshAgain) {
          refreshAgain = false;
          queueRefresh(true);
        }
      }
    }
  }
  function queueRefresh(structure: boolean) {
    if (structure) refreshAgain = true;
    if (refreshTimer) return;
    refreshTimer = win.setTimeout(() => {
      refreshTimer = 0;
      if (refreshAgain) {
        refreshAgain = false;
        run(refreshTree());
      } else if (state.selected) run(selectNode(state.selected, false, false));
    }, 120);
  }
  async function selectNode(ref: NodeRef, highlight: boolean, reveal: boolean) {
    const selection = state.beginSelection(ref);
    if (!selection) return;
    if (selection.changed) setDetails();
    if (highlight) queueHighlight(ref);
    if (reveal) ui.search = '';
    updateTree();
    try {
      const node = await request('UI.getNode', {
        node: ref,
      });
      if (!state.isCurrentSelection(selection)) return;
      state.nodes.set(ref.id, node);
      if (reveal) {
        // Picker selections may be beyond the bounded full-tree snapshot.
        let ancestor = node;
        const seen = new Set();
        while (
          ancestor.parent &&
          !seen.has(ancestor.parent) &&
          seen.size < 128
        ) {
          seen.add(ancestor.parent);
          const parent =
            state.nodes.get(ancestor.parent) ??
            (await request('UI.getNode', {
              node: {
                id: ancestor.parent,
                generation: ref.generation,
              },
            }));
          if (!state.isCurrentSelection(selection)) return;
          state.nodes.set(parent.ref.id, parent);
          state.expanded.add(parent.ref.id);
          ancestor = parent;
        }
      }
      updateTree();
      setDetails(node);
      if (reveal) {
        ui.reveal++;
        notify();
      }
      if (supports('animations')) {
        const animations = await request('Animation.getActive', {
          node: ref,
        });
        if (state.isCurrentSelection(selection)) {
          ui.detailAnimations = { active: animations };
          state.activeAnimations = animations;
          notify();
        }
      }
    } catch (error) {
      if (state.isCurrentSelection(selection)) {
        fail(error);
        if (error instanceof Error && error.message.startsWith('STALE_NODE')) {
          state.selected = undefined;
          setDetails();
          updateTree();
        }
      }
    }
  }
  function queueHighlight(ref: NodeRef | null) {
    if (
      !ownsControl() ||
      state.picker ||
      ui.diagnosticsBusy ||
      !supports('inspector')
    )
      return;
    nextHighlight = ref;
    if (!highlightTimer)
      highlightTimer = win.setTimeout(() => {
        highlightTimer = 0;
        run(flushHighlight());
      }, 70);
  }
  async function flushHighlight() {
    if (
      highlighting ||
      nextHighlight === undefined ||
      !ownsControl() ||
      state.picker
    )
      return;
    const ref = nextHighlight;
    nextHighlight = undefined;
    highlighting = true;
    const epoch = state.viewEpoch;
    try {
      if (ref)
        await request('UI.highlightNode', {
          node: ref,
        });
      else await request('UI.clearHighlight', {});
    } catch (error) {
      if (epoch === state.viewEpoch && ownsControl()) fail(error);
    } finally {
      highlighting = false;
      if (epoch === state.viewEpoch && nextHighlight !== undefined)
        run(flushHighlight());
    }
  }
  function renderLogs() {
    logTimer = 0;
    notify();
  }
  function acceptMetrics(metrics: DebugMetrics, full = false) {
    if (!state.acceptMetrics(metrics, full)) return;
    notify();
  }
  async function loadAnimations() {
    if (!supports('animations') || !state.connected || animationLoading) return;
    animationLoading = true;
    const epoch = state.viewEpoch;
    const selection = {
      viewEpoch: epoch,
      selectionEpoch: state.selectionEpoch,
      changed: false,
    };
    try {
      const result = await request(
        'Animation.getActive',
        state.selected
          ? {
              node: state.selected,
            }
          : {},
      );
      if (state.isCurrentSelection(selection)) {
        state.activeAnimations = result;
        notify();
      }
    } catch (error) {
      if (epoch === state.viewEpoch) fail(error);
    } finally {
      if (epoch === state.viewEpoch) animationLoading = false;
    }
  }
  function showDock(name: string) {
    ui.dock = name;
    notify();
    if (name === 'animations') run(loadAnimations());
    if (name === 'performance') {
      if (supports('performance')) {
        const epoch = state.viewEpoch;
        void request('Diagnostics.getMetrics', {})
          .then((value) => {
            if (epoch === state.viewEpoch) acceptMetrics(value, true);
          })
          .catch((error) => {
            if (epoch === state.viewEpoch) fail(error);
          });
      }
    }
  }
  function receive(message: ServerMessage) {
    if (message.type === 'hello') {
      if (message.version !== 1) {
        report('Unsupported debug protocol version');
        session.socket?.close();
        return;
      }
      state.clientId = message.clientId;
      state.connected = true;
      ui.status = `Connected · ${message.project}`;
      session.socket?.send(
        JSON.stringify({
          type: 'hello',
          version: 1,
        }),
      );
      ui.authRequired = false;
      notify();
      return;
    }
    if (message.type === 'response') {
      settle(message);
      return;
    }
    if (message.type === 'error') {
      report(`${message.error.code}: ${message.error.message}`);
      return;
    }
    if (message.type !== 'event') return;
    const effect = state.applyEvent(message);
    switch (effect.type) {
      case 'targets':
        updateTargets(effect.targets);
        break;
      case 'generation':
        generationChanged(effect.generation);
        break;
      case 'logs':
        if (!logTimer) logTimer = win.setTimeout(renderLogs, 80);
        break;
      case 'controls':
        notify();
        break;
      case 'selection':
        notify();
        run(selectNode(effect.node, false, true));
        break;
      case 'metrics':
        notify();
        break;
      case 'tree':
        if (effect.patched) updateTree();
        if (effect.metadataIncomplete) {
          ui.treeNote =
            'Some properties changed beyond the notification limit. Refresh for a full snapshot.';
        }
        notify();
        queueRefresh(effect.structure);
        break;
      case 'animations':
        if (effect.truncated)
          report(
            'Animation lifecycle notifications reached their bound. Refresh active animations for current state.',
          );
        notify();
        if (ui.dock === 'animations') run(loadAnimations());
        if (state.selected) queueRefresh(false);
        break;
    }
  }

  const actions = {
    switchTarget(id: string) {
      run(switchTarget(id));
      renderLogs();
    },
    authorize(key: string) {
      void session.authorize(key);
    },
    search(value: string) {
      ui.search = value;
      updateTree();
    },
    selectNode(ref: NodeRef) {
      run(selectNode(ref, true, false));
    },
    queueHighlight,
    expand(id: string, open: boolean) {
      if (open) state.expanded.add(id);
      else state.expanded.delete(id);
      updateTree();
    },
    control: () =>
      run(
        (async () => {
          const epoch = state.viewEpoch;
          try {
            const method = ownsControl()
              ? 'Control.release'
              : 'Control.acquire';
            await request(method, {});
            if (epoch !== state.viewEpoch) return;
            report('');
            if (method === 'Control.release') state.picker = false;
            notify();
          } catch (error) {
            if (epoch === state.viewEpoch) fail(error);
          }
        })(),
      ),
    picker: () =>
      run(
        (async () => {
          if (!ownsControl()) return;
          const epoch = state.viewEpoch;
          // Native interactive commands are serialized: finish a highlight first.
          nextHighlight = undefined;
          while (highlighting && epoch === state.viewEpoch)
            await new Promise((resolve) => win.setTimeout(resolve, 15));
          if (epoch !== state.viewEpoch) return;
          const enabled = !state.picker;
          await request('UI.setPickerEnabled', {
            enabled,
          });
          if (epoch === state.viewEpoch) {
            state.picker = enabled;
            report('');
            notify();
          }
        })(),
      ),
    showDock,
    clearSelection: () => {
      state.clearSelection();
      setDetails();
      updateTree();
      queueHighlight(null);
      if (ui.dock === 'animations') run(loadAnimations());
    },
    record: () =>
      run(
        (async () => {
          if (!ownsControl() || ui.diagnosticsBusy) return;
          const epoch = state.viewEpoch;
          ui.diagnosticsBusy = true;
          nextHighlight = undefined;
          notify();
          try {
            while (highlighting && epoch === state.viewEpoch)
              await new Promise((resolve) => win.setTimeout(resolve, 15));
            if (epoch !== state.viewEpoch) return;
            await request('Diagnostics.setRecording', {
              enabled: !state.performance?.recording,
            });
            const metrics = await request('Diagnostics.getMetrics', {});
            if (epoch === state.viewEpoch) {
              acceptMetrics(metrics, true);
              report('');
            }
          } finally {
            if (epoch === state.viewEpoch) {
              ui.diagnosticsBusy = false;
              notify();
            }
          }
        })(),
      ),
    refresh: () => {
      report('');
      run(refreshTree());
    },
    clearLogs() {
      state.logs.length = 0;
      renderLogs();
    },
  };
  function escapePicker(event: KeyboardEvent) {
    if (event.key === 'Escape' && state.picker && ownsControl()) {
      actions.picker();
      event.preventDefault();
    }
  }

  // Used by tests and page lifecycle; server heartbeat/disconnect releases control.
  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.clear();
    win.removeEventListener('pagehide', dispose);
    win.clearTimeout(refreshTimer);
    win.clearTimeout(logTimer);
    win.clearTimeout(highlightTimer);
    win.document.removeEventListener('keydown', escapePicker);
    cancelRequests(undefined);
    session.dispose();
  }
  return {
    state,
    ui,
    actions,
    getSnapshot: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      win.document.addEventListener('keydown', escapePicker);
      win.addEventListener('pagehide', dispose, { once: true });
      session.start();
    },
    dispose,
  };
}
export type Inspector = ReturnType<typeof createInspector>;
