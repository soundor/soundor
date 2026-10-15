import type {
  DebugTarget,
  NodeRef,
  ServerMessage,
  EventName,
  DebugMetrics,
} from '@soundor/devtools-protocol';

import { createBrowserSession } from './browser-session';
import { createConnectionRequests } from './connection';
import { createDetailsView } from './details-view';
import { createDiagnosticsView } from './diagnostics-view';
import { InspectorState } from './state';
import { createTreeView } from './tree-view';
export function startInspector(win: Window & typeof globalThis) {
  const doc = win.document;
  const state = new InspectorState();
  function element<T extends HTMLElement = HTMLElement>(id: string): T {
    return doc.getElementById(id) as T;
  }
  const status = element('status');
  const notice = element('notice');
  const auth: HTMLFormElement = element('auth');
  const targetsInput: HTMLSelectElement = element('targets');
  const control: HTMLButtonElement = element('control');
  const pickerButton: HTMLButtonElement = element('picker');
  const refreshButton: HTMLButtonElement = element('refresh');
  const search: HTMLInputElement = element('search');
  const treeView = element('tree');
  const treeNote = element('tree-note');
  const recordButton: HTMLButtonElement = element('record-performance');
  let dock = 'console';
  let animationLoading = false;
  let diagnosticsBusy = false;
  const logFilter: HTMLInputElement = element('log-filter');
  const logLevel: HTMLSelectElement = element('log-level');
  let refreshTimer = 0;
  let logTimer = 0;
  let highlightTimer = 0;
  let refreshing = false;
  let refreshAgain = false;
  let highlighting = false;
  let nextHighlight: NodeRef | null | undefined;
  function report(message: string) {
    notice.textContent = message;
    notice.hidden = !message;
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
    onDisconnect() {
      cancelRequests(undefined);
      state.targets = [];
      state.targetId = '';
      clearInspection();
      targetsInput.replaceChildren();
      emptyTree('Development session disconnected. Reconnecting…');
    },
  });
  function updateControls() {
    const target = currentTarget();
    control.disabled = !state.connected || !target;
    control.textContent = ownsControl() ? 'Release control' : 'Request control';
    element('ownership').textContent = ownsControl()
      ? 'You control this target'
      : target?.controller
        ? 'Observer · another tab controls'
        : 'Observer · control available';
    pickerButton.disabled =
      !state.connected ||
      !ownsControl() ||
      !supports('inspector') ||
      diagnosticsBusy;
    pickerButton.setAttribute('aria-pressed', String(state.picker));
    pickerButton.textContent = state.picker
      ? 'Cancel picker (Escape)'
      : 'Select element';
    refreshButton.disabled = !state.connected || !supports('inspector');
    (element('clear-selection') as HTMLButtonElement).disabled =
      !state.selected;
    recordButton.disabled =
      !state.connected ||
      !ownsControl() ||
      !supports('performance') ||
      diagnosticsBusy;
    recordButton.textContent = state.performance?.recording
      ? 'Stop recording'
      : 'Start recording';
    element('performance-status').textContent = !supports('performance')
      ? 'This target does not support performance diagnostics'
      : state.performance?.recording
        ? 'Recording · 10 Hz samples'
        : 'Recording is off';
    element('target-meta').textContent = target
      ? `${target.runtime} · instance ${target.id.slice(0, 8)} · generation ${target.generation} · ${target.capabilities.join(', ')}${target.processId ? ` · PID ${target.processId}` : ''}`
      : '';
  }
  const { render: renderTree, empty: emptyTree } = createTreeView({
    win,
    state,
    treeView,
    search,
    selectNode,
    queueHighlight,
    run,
  });
  const { render: renderDetails, group: detailGroup } = createDetailsView(
    doc,
    state,
  );
  const diagnostics = createDiagnosticsView(doc, state);
  const renderPerformance = diagnostics.renderPerformance;
  const renderAnimations = diagnostics.renderAnimations;
  function clearInspection() {
    state.clearInspection();
    animationLoading = false;
    diagnosticsBusy = false;
    renderPerformance();
    renderAnimations();
    nextHighlight = undefined;
    win.clearTimeout(refreshTimer);
    win.clearTimeout(highlightTimer);
    refreshing = false;
    refreshAgain = false;
    treeNote.hidden = true;
    renderDetails();
    updateControls();
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
    updateControls();
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
      if (dock === 'animations') run(loadAnimations());
      if (supports('inspector')) await refreshTree();
      else emptyTree('This target does not support native UI inspection.');
    } catch (error) {
      if (epoch === state.viewEpoch) fail(error);
    }
  }
  function updateTargets(updated: DebugTarget[]) {
    const before = currentTarget();
    state.targets = updated;
    targetsInput.replaceChildren();
    if (!state.targets.length) {
      const option = doc.createElement('option');
      option.value = '';
      option.textContent = 'No connected runtimes';
      targetsInput.append(option);
    }
    for (const target of state.targets) {
      const option = doc.createElement('option');
      option.value = target.id;
      const duplicate = state.targets.some(
        (other) =>
          other.id !== target.id &&
          other.name === target.name &&
          other.runtime === target.runtime,
      );
      option.textContent = `${target.name} — ${target.runtime}${duplicate ? ` [${target.id.slice(0, 8)}]` : ''}`;
      targetsInput.append(option);
    }
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
    targetsInput.value = state.targetId;
    updateControls();
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
      treeNote.hidden = !snapshot.truncated;
      treeNote.textContent =
        'Snapshot limit reached. Use the native picker to inspect omitted nodes.';
      if (update === 'selection-removed') {
        updateControls();
        renderDetails();
      }
      renderTree();
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
    updateControls();
    if (selection.changed) renderDetails();
    if (highlight) queueHighlight(ref);
    if (reveal) search.value = '';
    renderTree();
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
      renderTree();
      renderDetails(node);
      if (reveal) {
        const row = [...treeView.querySelectorAll('.tree-row')].find(
          (item) => (item as HTMLElement).dataset.nodeId === ref.id,
        );
        row?.scrollIntoView?.({
          block: 'nearest',
        });
      }
      if (supports('animations')) {
        const animations = await request('Animation.getActive', {
          node: ref,
        });
        if (state.isCurrentSelection(selection)) {
          detailGroup('Animations', {
            active: animations,
          });
          state.activeAnimations = animations;
          renderAnimations();
        }
      }
    } catch (error) {
      if (state.isCurrentSelection(selection)) {
        fail(error);
        if (error instanceof Error && error.message.startsWith('STALE_NODE')) {
          state.selected = undefined;
          renderDetails();
          renderTree();
        }
      }
    }
  }
  function queueHighlight(ref: NodeRef | null) {
    if (
      !ownsControl() ||
      state.picker ||
      diagnosticsBusy ||
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
    diagnostics.renderLogs();
  }
  function acceptMetrics(metrics: DebugMetrics, full = false) {
    if (!state.acceptMetrics(metrics, full)) return;
    updateControls();
    renderPerformance();
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
        renderAnimations();
      }
    } catch (error) {
      if (epoch === state.viewEpoch) fail(error);
    } finally {
      if (epoch === state.viewEpoch) animationLoading = false;
    }
  }
  function showDock(name: string) {
    dock = name;
    for (const panel of ['console', 'animations', 'performance']) {
      element(`panel-${panel}`).hidden = panel !== name;
      element(`tab-${panel}`).setAttribute(
        'aria-pressed',
        String(panel === name),
      );
    }
    if (name === 'animations') run(loadAnimations());
    if (name === 'performance') {
      renderPerformance();
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
      status.textContent = `Connected · ${message.project}`;
      session.socket?.send(
        JSON.stringify({
          type: 'hello',
          version: 1,
        }),
      );
      auth.hidden = true;
      updateControls();
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
        updateControls();
        break;
      case 'selection':
        updateControls();
        run(selectNode(effect.node, false, true));
        break;
      case 'metrics':
        updateControls();
        renderPerformance();
        break;
      case 'tree':
        if (effect.patched) renderTree();
        if (effect.metadataIncomplete) {
          treeNote.hidden = false;
          treeNote.textContent =
            'Some properties changed beyond the notification limit. Refresh for a full snapshot.';
        }
        queueRefresh(effect.structure);
        break;
      case 'animations':
        if (effect.truncated)
          report(
            'Animation lifecycle notifications reached their bound. Refresh active animations for current state.',
          );
        renderAnimations();
        if (dock === 'animations') run(loadAnimations());
        if (state.selected) queueRefresh(false);
        break;
    }
  }

  targetsInput.onchange = () => {
    run(switchTarget(targetsInput.value));
    renderLogs();
  };
  control.onclick = () =>
    run(
      (async () => {
        const epoch = state.viewEpoch;
        try {
          const method = ownsControl() ? 'Control.release' : 'Control.acquire';
          await request(method, {});
          if (epoch !== state.viewEpoch) return;
          report('');
          if (method === 'Control.release') state.picker = false;
          updateControls();
        } catch (error) {
          if (epoch === state.viewEpoch) fail(error);
        }
      })(),
    );
  pickerButton.onclick = () =>
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
          updateControls();
        }
      })(),
    );
  for (const panel of ['console', 'animations', 'performance'])
    element(`tab-${panel}`).onclick = () => showDock(panel);
  element('clear-selection').onclick = () => {
    state.clearSelection();
    renderDetails();
    renderTree();
    updateControls();
    queueHighlight(null);
    if (dock === 'animations') run(loadAnimations());
  };
  recordButton.onclick = () =>
    run(
      (async () => {
        if (!ownsControl() || diagnosticsBusy) return;
        const epoch = state.viewEpoch;
        diagnosticsBusy = true;
        nextHighlight = undefined;
        updateControls();
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
            diagnosticsBusy = false;
            updateControls();
          }
        }
      })(),
    );
  refreshButton.onclick = () => {
    report('');
    run(refreshTree());
  };
  search.oninput = renderTree;
  treeView.onmouseleave = () => queueHighlight(state.selected ?? null);
  logFilter.oninput = renderLogs;
  logLevel.onchange = renderLogs;
  element('clear-logs').onclick = () => {
    state.logs.length = 0;
    renderLogs();
  };
  function escapePicker(event: KeyboardEvent) {
    if (event.key === 'Escape' && state.picker && ownsControl()) {
      pickerButton.click();
      event.preventDefault();
    }
  }
  doc.addEventListener('keydown', escapePicker);
  updateControls();
  renderLogs();
  session.start();
  // Used by tests and page lifecycle; server heartbeat/disconnect releases control.
  function dispose() {
    win.clearTimeout(refreshTimer);
    win.clearTimeout(logTimer);
    win.clearTimeout(highlightTimer);
    doc.removeEventListener('keydown', escapePicker);
    cancelRequests(undefined);
    session.dispose();
  }
  win.addEventListener('pagehide', dispose, {
    once: true,
  });
  return dispose;
}
