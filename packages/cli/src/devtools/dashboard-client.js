/**
 * A browser view of Soundor protocol data. It never inspects the native app's DOM.
 * @typedef {import('@soundor/devtools-protocol').DebugTarget} DebugTarget
 * @typedef {import('@soundor/devtools-protocol').DebugNode} DebugNode
 * @typedef {import('@soundor/devtools-protocol').DebugTree} DebugTree
 * @typedef {import('@soundor/devtools-protocol').NodeRef} NodeRef
 * @typedef {import('@soundor/devtools-protocol').ServerMessage} ServerMessage
 * @typedef {import('@soundor/devtools-protocol').EventName} EventName
 * @typedef {{level:string,message:string,source:string,timestamp:number,scope:string}} Log
 */
/** @param {Window & typeof globalThis} win */
export function startInspector(win) {
  const doc = win.document;
  /** @template {HTMLElement} T @param {string} id @returns {T} */
  function element(id) {
    return /** @type {T} */ (doc.getElementById(id));
  }
  const status = element('status');
  const notice = element('notice');
  /** @type {HTMLFormElement} */ const auth = element('auth');
  /** @type {HTMLInputElement} */ const keyInput = element('key');
  /** @type {HTMLSelectElement} */ const targetsInput = element('targets');
  /** @type {HTMLButtonElement} */ const control = element('control');
  /** @type {HTMLButtonElement} */ const pickerButton = element('picker');
  /** @type {HTMLButtonElement} */ const refreshButton = element('refresh');
  /** @type {HTMLInputElement} */ const search = element('search');
  const treeView = element('tree');
  const details = element('details');
  const treeNote = element('tree-note');
  const logsView = element('logs');
  /** @type {HTMLInputElement} */ const logFilter = element('log-filter');
  /** @type {HTMLSelectElement} */ const logLevel = element('log-level');
  /** @type {WebSocket | undefined} */ let socket;
  /** @type {DebugTarget[]} */ let targets = [];
  /** @type {Map<string, DebugNode>} */ let nodes = new Map();
  /** @type {DebugTree | undefined} */ let tree;
  /** @type {NodeRef | undefined} */ let selected;
  /** @type {Set<string>} */ const expanded = new Set();
  /** @type {Log[]} */ const logs = [];
  /** @type {Map<string,{resolve:(value:unknown)=>void,reject:(error:Error)=>void,timer:number,targetId:string|undefined}>} */
  const pending = new Map();
  let clientId = '';
  let targetId = '';
  let viewEpoch = 0;
  let inspectedGeneration = 0;
  let selectionEpoch = 0;
  let requestSequence = 0;
  let connected = false;
  let picker = false;
  let disposed = false;
  let reconnectTimer = 0;
  let refreshTimer = 0;
  let logTimer = 0;
  let highlightTimer = 0;
  let refreshing = false;
  let refreshAgain = false;
  let highlighting = false;
  /** @type {NodeRef | null | undefined} */ let nextHighlight;

  /** @param {string} message */
  function report(message) {
    notice.textContent = message;
    notice.hidden = !message;
  }
  function currentTarget() {
    return targets.find((target) => target.id === targetId);
  }
  function ownsControl() {
    return !!clientId && currentTarget()?.controller === clientId;
  }
  /** @param {string} capability */
  function supports(capability) {
    return (
      currentTarget()?.capabilities.some((value) => value === capability) ??
      false
    );
  }
  /** @param {unknown} error */
  function fail(error) {
    report(error instanceof Error ? error.message : String(error));
  }
  /** @param {Promise<unknown>} task */
  function run(task) {
    void task.catch(fail);
  }
  /** @template {import('@soundor/devtools-protocol').DebugMethod} M
   * @param {M} method
   * @param {import('@soundor/devtools-protocol').Params<M>} params
   * @param {string | undefined} [id]
   * @returns {Promise<import('@soundor/devtools-protocol').MethodResults[M]>}
   */
  function request(method, params, id = targetId || undefined) {
    return new Promise((resolve, reject) => {
      if (!connected || socket?.readyState !== win.WebSocket.OPEN) {
        reject(new Error('Development session is disconnected'));
        return;
      }
      const requestId = String(++requestSequence);
      const timer = win.setTimeout(() => {
        pending.delete(requestId);
        socket?.send(JSON.stringify({ type: 'cancel', id: requestId }));
        reject(
          new Error(`${method} timed out; refresh or reconnect the runtime`),
        );
      }, 7000);
      pending.set(requestId, {
        resolve: (value) =>
          resolve(
            /** @type {import('@soundor/devtools-protocol').MethodResults[M]} */ (
              value
            ),
          ),
        reject,
        timer,
        targetId: id,
      });
      socket.send(
        JSON.stringify({
          type: 'request',
          id: requestId,
          targetId: id,
          method,
          params,
        }),
      );
    });
  }
  /** @param {string | undefined} id */
  function cancelRequests(id) {
    for (const [requestId, entry] of pending) {
      if (id && entry.targetId !== id) continue;
      win.clearTimeout(entry.timer);
      pending.delete(requestId);
      if (socket?.readyState === win.WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'cancel', id: requestId }));
      entry.reject(new Error('Inspection changed or connection closed'));
    }
  }
  function updateControls() {
    const target = currentTarget();
    control.disabled = !connected || !target;
    control.textContent = ownsControl() ? 'Release control' : 'Request control';
    element('ownership').textContent = ownsControl()
      ? 'You control this target'
      : target?.controller
        ? 'Observer · another tab controls'
        : 'Observer · control available';
    pickerButton.disabled =
      !connected || !ownsControl() || !supports('inspector');
    pickerButton.setAttribute('aria-pressed', String(picker));
    pickerButton.textContent = picker
      ? 'Cancel picker (Escape)'
      : 'Select element';
    refreshButton.disabled = !connected || !supports('inspector');
    element('target-meta').textContent = target
      ? `${target.runtime} · generation ${target.generation} · ${target.capabilities.join(', ')}${target.processId ? ` · PID ${target.processId}` : ''}`
      : '';
  }
  /** @param {string} message */
  function emptyTree(message) {
    const empty = doc.createElement('div');
    empty.className = 'empty';
    empty.textContent = message;
    treeView.replaceChildren(empty);
  }
  function clearInspection() {
    ++viewEpoch;
    ++selectionEpoch;
    inspectedGeneration = 0;
    tree = undefined;
    nodes.clear();
    selected = undefined;
    expanded.clear();
    picker = false;
    nextHighlight = undefined;
    win.clearTimeout(refreshTimer);
    win.clearTimeout(highlightTimer);
    refreshing = false;
    refreshAgain = false;
    treeNote.hidden = true;
    renderDetails();
    updateControls();
  }
  /** @param {string} id */
  async function switchTarget(id) {
    const previous = targetId;
    if (previous === id) return;
    // Release only our own lease; observers never clear somebody else's overlay.
    const wasController = ownsControl();
    clearInspection();
    if (connected && previous) {
      cancelRequests(previous);
      void request('Events.subscribe', { events: [] }, previous).catch(
        () => {},
      );
      if (wasController)
        void request('Control.release', {}, previous).catch(() => {});
    }
    targetId = id;
    inspectedGeneration = currentTarget()?.generation ?? 0;
    report('');
    updateControls();
    emptyTree(id ? 'Loading native UI…' : 'Waiting for a runtime to connect.');
    if (!id || !connected) return;
    const epoch = viewEpoch;
    /** @type {EventName[]} */ const events = [
      'UI.treeChanged',
      'UI.nodeSelected',
      'UI.pickerChanged',
      'Runtime.generationChanged',
      'Console.message',
    ];
    if (supports('animations')) events.push('Animation.changed');
    if (supports('performance')) events.push('Diagnostics.metrics');
    try {
      await request('Events.subscribe', { events }, id);
      if (epoch !== viewEpoch) return;
      if (supports('inspector')) await refreshTree();
      else emptyTree('This target does not support native UI inspection.');
    } catch (error) {
      if (epoch === viewEpoch) fail(error);
    }
  }
  /** @param {DebugTarget[]} updated */
  function updateTargets(updated) {
    const before = currentTarget();
    targets = updated;
    targetsInput.replaceChildren();
    if (!targets.length) {
      const option = doc.createElement('option');
      option.value = '';
      option.textContent = 'No connected runtimes';
      targetsInput.append(option);
    }
    for (const target of targets) {
      const option = doc.createElement('option');
      option.value = target.id;
      option.textContent = `${target.name} — ${target.runtime}`;
      targetsInput.append(option);
    }
    const after = currentTarget();
    if (!after && targetId) {
      cancelRequests(targetId);
      targetId = '';
      clearInspection();
      emptyTree('Target disconnected. Select another connected runtime.');
      report(
        'The selected runtime disconnected; its node references are invalid.',
      );
    }
    if (!targetId && targets.length) run(switchTarget(targets[0]?.id ?? ''));
    else if (after && before?.generation !== after.generation)
      generationChanged(after.generation);
    if (!ownsControl()) {
      picker = false;
      nextHighlight = undefined;
    }
    targetsInput.value = targetId;
    updateControls();
  }
  /** @param {number} generation */
  function generationChanged(generation) {
    const target = currentTarget();
    if (!target || inspectedGeneration === generation) return;
    target.generation = generation;
    cancelRequests(targetId);
    clearInspection();
    inspectedGeneration = generation;
    report('Runtime reloaded. Previous node references have been cleared.');
    emptyTree('Loading the new runtime generation…');
    run(refreshTree());
  }
  async function refreshTree() {
    if (!supports('inspector') || !connected) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    const epoch = viewEpoch;
    refreshing = true;
    try {
      const snapshot = await request('UI.getTree', {});
      if (
        epoch !== viewEpoch ||
        snapshot.generation !== currentTarget()?.generation
      )
        return;
      tree = snapshot;
      nodes = new Map(snapshot.nodes.map((node) => [node.ref.id, node]));
      for (const root of snapshot.roots) expanded.add(root);
      treeNote.hidden = !snapshot.truncated;
      treeNote.textContent =
        'Snapshot limit reached. Use the native picker to inspect omitted nodes.';
      if (selected && !nodes.has(selected.id)) {
        selected = undefined;
        ++selectionEpoch;
        renderDetails();
      }
      renderTree();
      if (selected) await selectNode(selected, false, false);
    } catch (error) {
      if (epoch === viewEpoch) fail(error);
    } finally {
      if (epoch === viewEpoch) {
        refreshing = false;
        if (refreshAgain) {
          refreshAgain = false;
          queueRefresh(true);
        }
      }
    }
  }
  /** @param {boolean} structure */
  function queueRefresh(structure) {
    if (structure) refreshAgain = true;
    if (refreshTimer) return;
    refreshTimer = win.setTimeout(() => {
      refreshTimer = 0;
      if (refreshAgain) {
        refreshAgain = false;
        run(refreshTree());
      } else if (selected) run(selectNode(selected, false, false));
    }, 120);
  }
  /** @param {DebugNode} node */
  function label(node) {
    return `${node.type}${node.debugId ? ` #${node.debugId}` : ''}${node.text ? ` "${node.text.slice(0, 90)}"` : ''}`;
  }
  /** @param {DebugNode} node */
  function searchable(node) {
    return [
      node.type,
      node.debugId,
      node.ref.id,
      node.text,
      node.accessibility?.role,
      node.accessibility?.name,
    ]
      .join(' ')
      .toLowerCase();
  }
  function renderTree() {
    if (!tree) return;
    const retainFocus = treeView.contains(doc.activeElement);
    const query = search.value.trim().toLowerCase();
    /** @type {Set<string> | undefined} */ let matches;
    if (query) {
      matches = new Set();
      for (const node of nodes.values()) {
        if (!searchable(node).includes(query)) continue;
        let ancestor = node;
        const seen = new Set();
        while (ancestor && !seen.has(ancestor.ref.id)) {
          seen.add(ancestor.ref.id);
          matches.add(ancestor.ref.id);
          ancestor = /** @type {DebugNode} */ (
            ancestor.parent ? nodes.get(ancestor.parent) : undefined
          );
        }
      }
    }
    const fragment = doc.createDocumentFragment();
    const seen = new Set();
    const stack = tree.roots.toReversed().map((id) => ({ id, depth: 0 }));
    while (stack.length && seen.size < 5000) {
      const entry = stack.pop();
      if (!entry || seen.has(entry.id) || (matches && !matches.has(entry.id)))
        continue;
      const node = nodes.get(entry.id);
      if (!node) continue;
      seen.add(entry.id);
      const row = doc.createElement('div');
      row.className = 'tree-row';
      row.dataset.nodeId = entry.id;
      row.style.paddingLeft = `${Math.min(entry.depth, 80) * 16 + 8}px`;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(entry.depth + 1));
      row.setAttribute('aria-selected', String(selected?.id === entry.id));
      row.tabIndex = selected?.id === entry.id ? 0 : -1;
      const open = !!query || expanded.has(entry.id);
      const toggle = doc.createElement('button');
      toggle.tabIndex = -1;
      toggle.textContent = node.children.length ? (open ? '▾' : '▸') : '·';
      toggle.setAttribute(
        'aria-label',
        `${open ? 'Collapse' : 'Expand'} ${node.type}`,
      );
      if (node.children.length) row.setAttribute('aria-expanded', String(open));
      toggle.disabled = !node.children.length;
      toggle.onclick = (event) => {
        event.stopPropagation();
        if (open) expanded.delete(entry.id);
        else expanded.add(entry.id);
        renderTree();
      };
      const title = doc.createElement('span');
      title.className = 'node-label';
      title.textContent = label(node);
      const identity = doc.createElement('span');
      identity.className = 'node-id';
      identity.textContent = node.ref.id;
      row.append(toggle, title, identity);
      row.onclick = () => run(selectNode(node.ref, true, false));
      row.onmouseenter = () => queueHighlight(node.ref);
      row.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          run(selectNode(node.ref, true, false));
        }
        if (event.key === 'ArrowRight') {
          expanded.add(entry.id);
          renderTree();
        }
        if (event.key === 'ArrowLeft') {
          expanded.delete(entry.id);
          renderTree();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const rows = [...treeView.querySelectorAll('.tree-row')];
          const next =
            rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
          if (next instanceof win.HTMLElement) {
            next.focus();
            const id = next.dataset.nodeId;
            const item = id && nodes.get(id);
            if (item) run(selectNode(item.ref, true, false));
          }
        }
      };
      fragment.append(row);
      if (open)
        for (const child of node.children.toReversed())
          stack.push({ id: child, depth: entry.depth + 1 });
    }
    if (!fragment.childNodes.length)
      emptyTree(query ? 'No matching nodes.' : 'The UI tree is empty.');
    else {
      treeView.replaceChildren(fragment);
      if (retainFocus && selected) {
        const row = [...treeView.querySelectorAll('.tree-row')].find(
          (item) =>
            /** @type {HTMLElement} */ (item).dataset.nodeId === selected?.id,
        );
        /** @type {HTMLElement | undefined} */ (row)?.focus();
      }
      if (!selected)
        /** @type {HTMLElement | null} */ (
          treeView.querySelector('.tree-row')
        )?.setAttribute('tabindex', '0');
    }
  }
  /** @param {NodeRef} ref @param {boolean} highlight @param {boolean} reveal */
  async function selectNode(ref, highlight, reveal) {
    if (ref.generation !== currentTarget()?.generation) return;
    const changed =
      selected?.id !== ref.id || selected?.generation !== ref.generation;
    selected = ref;
    if (changed) renderDetails();
    const epoch = viewEpoch;
    const selection = ++selectionEpoch;
    if (highlight) queueHighlight(ref);
    if (reveal) search.value = '';
    renderTree();
    try {
      const node = await request('UI.getNode', { node: ref });
      if (epoch !== viewEpoch || selection !== selectionEpoch) return;
      nodes.set(ref.id, node);
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
            nodes.get(ancestor.parent) ??
            (await request('UI.getNode', {
              node: { id: ancestor.parent, generation: ref.generation },
            }));
          if (epoch !== viewEpoch || selection !== selectionEpoch) return;
          nodes.set(parent.ref.id, parent);
          expanded.add(parent.ref.id);
          ancestor = parent;
        }
      }
      renderTree();
      renderDetails(node);
      if (reveal) {
        const row = [...treeView.querySelectorAll('.tree-row')].find(
          (item) => /** @type {HTMLElement} */ (item).dataset.nodeId === ref.id,
        );
        row?.scrollIntoView?.({ block: 'nearest' });
      }
      if (supports('animations')) {
        const animations = await request('Animation.getActive', { node: ref });
        if (epoch === viewEpoch && selection === selectionEpoch)
          detailGroup('Animations', { active: animations });
      }
    } catch (error) {
      if (epoch === viewEpoch && selection === selectionEpoch) {
        fail(error);
        if (error instanceof Error && error.message.startsWith('STALE_NODE')) {
          selected = undefined;
          renderDetails();
          renderTree();
        }
      }
    }
  }
  /** @param {NodeRef | null} ref */
  function queueHighlight(ref) {
    if (!ownsControl() || picker || !supports('inspector')) return;
    nextHighlight = ref;
    if (!highlightTimer)
      highlightTimer = win.setTimeout(() => {
        highlightTimer = 0;
        run(flushHighlight());
      }, 70);
  }
  async function flushHighlight() {
    if (highlighting || nextHighlight === undefined || !ownsControl() || picker)
      return;
    const ref = nextHighlight;
    nextHighlight = undefined;
    highlighting = true;
    const epoch = viewEpoch;
    try {
      if (ref) await request('UI.highlightNode', { node: ref });
      else await request('UI.clearHighlight', {});
    } catch (error) {
      if (epoch === viewEpoch && ownsControl()) fail(error);
    } finally {
      highlighting = false;
      if (epoch === viewEpoch && nextHighlight !== undefined)
        run(flushHighlight());
    }
  }
  /** @param {string} heading @param {Record<string,unknown>} data */
  function detailGroup(heading, data) {
    if (!Object.keys(data).length) return;
    const group = doc.createElement('details');
    group.className = 'detail-group';
    group.open = true;
    const summary = doc.createElement('summary');
    summary.textContent = heading;
    const table = doc.createElement('table');
    for (const [name, value] of Object.entries(data)) {
      const row = doc.createElement('tr');
      const key = doc.createElement('td');
      const cell = doc.createElement('td');
      key.textContent = name;
      cell.textContent =
        typeof value === 'object'
          ? JSON.stringify(value, null, 2)
          : String(value);
      row.append(key, cell);
      table.append(row);
    }
    group.append(summary, table);
    details.append(group);
  }
  /** @param {DebugNode} [node] */
  function renderDetails(node) {
    const heading = doc.createElement('h2');
    heading.textContent = 'Details';
    details.replaceChildren(heading);
    if (!node) {
      const empty = doc.createElement('div');
      empty.className = 'empty';
      empty.textContent = selected
        ? 'Loading node…'
        : 'Select a node to inspect its live engine state.';
      details.append(empty);
      return;
    }
    const title = doc.createElement('div');
    title.className = 'node-heading';
    title.textContent = label(node);
    details.append(title);
    detailGroup('Properties', {
      type: node.type,
      identity: `${targetId} / ${node.ref.generation} / ${node.ref.id}`,
      ...(node.debugId ? { debugId: node.debugId } : {}),
      ...(node.text !== undefined ? { text: node.text } : {}),
      focused: node.focused,
      visible: node.visible,
      ...node.properties,
    });
    detailGroup('Layout', { bounds: node.bounds, ...node.layout });
    if (node.styles) detailGroup('Base styles', node.styles);
    if (node.presentation)
      detailGroup('Presentation values', node.presentation);
    if (supports('accessibility') && node.accessibility)
      detailGroup('Accessibility', node.accessibility);
  }
  function renderLogs() {
    logTimer = 0;
    const query = logFilter.value.toLowerCase();
    const filtered = logs.filter(
      (entry) =>
        (logLevel.value === 'all' || entry.level === logLevel.value) &&
        `${entry.message} ${entry.source}`.toLowerCase().includes(query) &&
        (entry.scope === 'session' || entry.scope === targetId),
    );
    const nearBottom =
      logsView.scrollHeight - logsView.scrollTop - logsView.clientHeight < 60;
    const fragment = doc.createDocumentFragment();
    for (const entry of filtered) {
      const row = doc.createElement('div');
      row.className = 'log';
      row.dataset.level = entry.level;
      const time = doc.createElement('time');
      time.textContent = new Date(entry.timestamp).toLocaleTimeString();
      const content = doc.createElement('div');
      const message = doc.createElement('pre');
      message.textContent = entry.message;
      const source = doc.createElement('div');
      source.className = 'log-source';
      source.textContent = `${entry.level} · ${entry.source} · ${entry.scope === 'session' ? 'development session' : 'selected target'}`;
      content.append(message, source);
      row.append(time, content);
      fragment.append(row);
    }
    logsView.replaceChildren(fragment);
    element('log-count').textContent = `${filtered.length} / ${logs.length}`;
    if (nearBottom) logsView.scrollTop = logsView.scrollHeight;
  }
  /** @param {ServerMessage} message */
  function receive(message) {
    if (message.type === 'hello') {
      if (message.version !== 1) {
        report('Unsupported debug protocol version');
        socket?.close();
        return;
      }
      clientId = message.clientId;
      connected = true;
      status.textContent = `Connected · ${message.project}`;
      socket?.send(JSON.stringify({ type: 'hello', version: 1 }));
      auth.hidden = true;
      updateControls();
      return;
    }
    if (message.type === 'response') {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      win.clearTimeout(entry.timer);
      if (message.error)
        entry.reject(
          new Error(`${message.error.code}: ${message.error.message}`),
        );
      else entry.resolve(message.result);
      return;
    }
    if (message.type === 'error') {
      report(`${message.error.code}: ${message.error.message}`);
      return;
    }
    if (message.type !== 'event') return;
    if (message.event === 'Runtime.targetsChanged') {
      updateTargets(message.data);
      return;
    }
    if (message.event === 'Console.message') {
      const data = /** @type {Omit<Log,'scope'>} */ (message.data);
      logs.push({
        ...data,
        scope:
          message.scope === 'session' ? 'session' : (message.targetId ?? ''),
      });
      if (logs.length > 1000) logs.splice(0, logs.length - 1000);
      if (!logTimer) logTimer = win.setTimeout(renderLogs, 80);
      return;
    }
    if (message.targetId !== targetId) return;
    if (message.event === 'Runtime.generationChanged')
      generationChanged(
        /** @type {{generation:number}} */ (message.data).generation,
      );
    if (message.event === 'UI.pickerChanged') {
      picker = /** @type {{enabled:boolean}} */ (message.data).enabled;
      updateControls();
    }
    if (message.event === 'UI.nodeSelected' && ownsControl()) {
      picker = false;
      updateControls();
      run(
        selectNode(
          /** @type {{node:NodeRef}} */ (message.data).node,
          false,
          true,
        ),
      );
    }
    if (message.event === 'UI.treeChanged') {
      const change =
        /** @type {{generation:number,kind?:string,nodes?:DebugNode[],metadataIncomplete?:boolean}} */ (
          message.data
        );
      if (change.generation !== currentTarget()?.generation) return;
      for (const patch of change.nodes ?? []) {
        if (nodes.has(patch.ref.id)) nodes.set(patch.ref.id, patch);
      }
      if (change.nodes?.length) renderTree();
      if (change.metadataIncomplete) {
        treeNote.hidden = false;
        treeNote.textContent =
          'Some properties changed beyond the notification limit. Refresh for a full snapshot.';
      }
      queueRefresh(change.kind !== 'properties');
    }
    if (message.event === 'Animation.changed' && selected) queueRefresh(false);
  }
  async function checkSession() {
    if (disposed || socket || !auth.hidden) return;
    try {
      const response = await win.fetch('/browser/session');
      if (response.ok && (await response.json()).authenticated) connect();
      else {
        auth.hidden = false;
        status.textContent = 'Authorization required';
      }
    } catch {
      status.textContent = 'Session unavailable · reconnecting';
      scheduleReconnect();
    }
  }
  function scheduleReconnect() {
    win.clearTimeout(reconnectTimer);
    if (!disposed)
      reconnectTimer = win.setTimeout(() => {
        auth.hidden = true;
        void checkSession();
      }, 1500);
  }
  function connect() {
    if (disposed || socket) return;
    const ws = new win.WebSocket(
      win.location.origin.replace(/^http/, 'ws') + '/browser',
    );
    socket = ws;
    status.textContent = 'Connecting…';
    ws.onmessage = (event) => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 1024 * 1024)
          throw new Error('Oversized protocol message');
        receive(JSON.parse(event.data));
      } catch (error) {
        fail(error);
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = undefined;
      connected = false;
      clientId = '';
      cancelRequests(undefined);
      targets = [];
      targetId = '';
      clearInspection();
      targetsInput.replaceChildren();
      emptyTree('Development session disconnected. Reconnecting…');
      status.textContent = 'Disconnected · reconnecting';
      auth.hidden = true;
      scheduleReconnect();
    };
    ws.onerror = () => {
      status.textContent = 'Connection failed · reconnecting';
    };
  }
  /** @param {string} key */
  async function authorize(key) {
    try {
      const response = await win.fetch('/browser/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!response.ok) throw new Error('Invalid or expired browser key');
      auth.hidden = true;
      report('');
      connect();
    } catch (error) {
      auth.hidden = false;
      fail(error);
    }
  }
  auth.onsubmit = (event) => {
    event.preventDefault();
    const key = keyInput.value;
    keyInput.value = '';
    run(authorize(key));
  };
  targetsInput.onchange = () => {
    run(switchTarget(targetsInput.value));
    renderLogs();
  };
  control.onclick = () =>
    run(
      (async () => {
        const epoch = viewEpoch;
        try {
          const method = ownsControl() ? 'Control.release' : 'Control.acquire';
          await request(method, {});
          if (epoch !== viewEpoch) return;
          report('');
          if (method === 'Control.release') picker = false;
          updateControls();
        } catch (error) {
          if (epoch === viewEpoch) fail(error);
        }
      })(),
    );
  pickerButton.onclick = () =>
    run(
      (async () => {
        if (!ownsControl()) return;
        const epoch = viewEpoch;
        // Native interactive commands are serialized: finish a highlight first.
        nextHighlight = undefined;
        while (highlighting && epoch === viewEpoch)
          await new Promise((resolve) => win.setTimeout(resolve, 15));
        if (epoch !== viewEpoch) return;
        const enabled = !picker;
        await request('UI.setPickerEnabled', { enabled });
        if (epoch === viewEpoch) {
          picker = enabled;
          report('');
          updateControls();
        }
      })(),
    );
  refreshButton.onclick = () => {
    report('');
    run(refreshTree());
  };
  search.oninput = renderTree;
  treeView.onmouseleave = () => queueHighlight(selected ?? null);
  logFilter.oninput = renderLogs;
  logLevel.onchange = renderLogs;
  element('clear-logs').onclick = () => {
    logs.length = 0;
    renderLogs();
  };
  /** @param {KeyboardEvent} event */
  function escapePicker(event) {
    if (event.key === 'Escape' && picker && ownsControl()) {
      pickerButton.click();
      event.preventDefault();
    }
  }
  doc.addEventListener('keydown', escapePicker);
  const ticket = new URLSearchParams(win.location.hash.slice(1)).get('connect');
  win.history.replaceState(null, '', win.location.pathname);
  updateControls();
  renderLogs();
  if (ticket) run(authorize(ticket));
  else {
    auth.hidden = true;
    void checkSession();
  }
  // Used by tests and page lifecycle; server heartbeat/disconnect releases control.
  function dispose() {
    disposed = true;
    win.clearTimeout(reconnectTimer);
    win.clearTimeout(refreshTimer);
    win.clearTimeout(logTimer);
    win.clearTimeout(highlightTimer);
    doc.removeEventListener('keydown', escapePicker);
    cancelRequests(undefined);
    socket?.close();
    socket = undefined;
  }
  win.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
if (typeof window !== 'undefined') startInspector(window);
