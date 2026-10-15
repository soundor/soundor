import { metricSummary } from './diagnostics';
import type { InspectorState } from './state';
export function createDiagnosticsView(doc: Document, state: InspectorState) {
  function element<T extends HTMLElement = HTMLElement>(id: string): T {
    return doc.getElementById(id) as T;
  }
  const logFilter = element<HTMLInputElement>('log-filter');
  const logLevel = element<HTMLSelectElement>('log-level');
  const logsView = element('logs');
  const supports = (capability: string) => state.supports(capability);
  function renderLogs() {
    const query = logFilter.value.toLowerCase();
    const filtered = state.logs.filter(
      (entry) =>
        (logLevel.value === 'all' || entry.level === logLevel.value) &&
        `${entry.message} ${entry.source}`.toLowerCase().includes(query) &&
        (entry.scope === 'session' || entry.scope === state.targetId),
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
    element('log-count').textContent =
      `${filtered.length} / ${state.logs.length}`;
    if (nearBottom) logsView.scrollTop = logsView.scrollHeight;
  }
  function renderPerformance() {
    const summary = element('performance-summary');
    summary.replaceChildren();
    const chart = doc.getElementById('performance-chart');
    chart?.replaceChildren();
    const phasesView = element('performance-phases');
    phasesView.replaceChildren();
    if (!state.performance) return;
    const values = metricSummary(state.performance);
    for (const [name, value] of Object.entries(values)) {
      const item = doc.createElement('div');
      item.className = 'metric';
      item.textContent = name;
      const number = doc.createElement('strong');
      number.textContent = String(value);
      item.append(number);
      summary.append(item);
    }
    if (
      chart &&
      state.performance.frames.some((frame) => frame.frameMs !== undefined)
    ) {
      const frames = state.performance.frames.filter(
        (frame) => frame.frameMs !== undefined,
      );
      const first = frames[0]?.timestampMs ?? 0;
      const span = Math.max(1, (frames.at(-1)?.timestampMs ?? 0) - first);
      const peak = Math.max(...frames.map((frame) => frame.frameMs ?? 0));
      const axis = Math.max(1, peak);
      const line = doc.createElementNS(
        'http://www.w3.org/2000/svg',
        'polyline',
      );
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', 'var(--accent)');
      line.setAttribute('stroke-width', '2');
      line.setAttribute(
        'points',
        frames
          .map(
            (frame) =>
              `${((frame.timestampMs - first) / span) * 790 + 5},${75 - ((frame.frameMs ?? 0) / axis) * 65}`,
          )
          .join(' '),
      );
      const title = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `Measured CPU frame duration, ${frames.length} samples, peak ${peak.toFixed(2)} ms`;
      chart.append(title, line);
    }
    if (Object.keys(state.performance.phases).length) {
      const text = doc.createElement('pre');
      text.className = 'diagnostic-note';
      text.textContent = `Measured UI tick phases and work counters (latest sampling window)\n${JSON.stringify(state.performance.phases, null, 2)}`;
      phasesView.append(text);
    }
  }
  function renderAnimations() {
    const panel = element('animations');
    panel.replaceChildren();
    const note = doc.createElement('div');
    note.className = 'diagnostic-note';
    note.textContent = !supports('animations')
      ? 'This target does not support animation inspection.'
      : `${state.selected ? 'Selected node' : 'All nodes'} · ${state.activeAnimations.length} active or paused animations (up to 256). Presentation values come from the engine.`;
    if (state.activeAnimations.some((animation) => animation.snapshotTruncated))
      note.textContent += ' Snapshot limit reached.';
    panel.append(note);
    for (const animation of state.activeAnimations) {
      const row = doc.createElement('div');
      row.className = 'animation-row';
      row.textContent =
        `#${animation.id} · ${animation.kind} · ${animation.state} · ${animation.elapsedMs.toFixed(1)} ms / ${animation.durationMs ?? 'infinite'} ms (${animation.durationScope}) · delay ${animation.delayMs} ms\n` +
        animation.targets
          .map(
            (target) =>
              `Node ${target.node.id}: ${target.properties.join(', ')} = ${JSON.stringify(target.presentation)}`,
          )
          .join('\n') +
        (animation.spring
          ? `\nSpring: ${JSON.stringify(animation.spring)}`
          : animation.easing
            ? `\nEasing: ${animation.easing}`
            : '');
      panel.append(row);
    }
    if (state.animationHistory.length) {
      const heading = doc.createElement('div');
      heading.className = 'diagnostic-note';
      heading.textContent = 'Recent lifecycle events (this target, up to 100)';
      panel.append(heading);
      for (const entry of state.animationHistory.toReversed()) {
        const row = doc.createElement('div');
        row.className = 'animation-row';
        row.textContent = `#${entry.id} · node ${entry.node.id} · ${entry.state} · playback ${entry.playbackGeneration}`;
        panel.append(row);
      }
    }
  }
  return { renderLogs, renderAnimations, renderPerformance };
}
