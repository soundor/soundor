import { useLayoutEffect, useRef, useState } from 'react';

import type { Inspector } from './controller';
import { metricSummary } from './diagnostics';

function Logs({ inspector: { state, actions } }: { inspector: Inspector }) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const container = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const filtered = state.logs.filter(
    (entry) =>
      (level === 'all' || entry.level === level) &&
      `${entry.message} ${entry.source}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (entry.scope === 'session' || entry.scope === state.targetId),
  );
  useLayoutEffect(() => {
    const view = container.current;
    if (view && nearBottom.current) view.scrollTop = view.scrollHeight;
  });
  return (
    <>
      <div className="console-tools">
        <strong>Console</strong>
        <select
          id="log-level"
          aria-label="Log severity"
          value={level}
          onChange={(event) => setLevel(event.currentTarget.value)}
        >
          <option value="all">All levels</option>
          <option value="error">Errors</option>
          <option value="warn">Warnings</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
        <input
          id="log-filter"
          type="search"
          placeholder="Filter logs"
          aria-label="Filter logs"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <button id="clear-logs" onClick={actions.clearLogs}>
          Clear
        </button>
        <span id="log-count">
          {filtered.length} / {state.logs.length}
        </span>
      </div>
      <div
        id="logs"
        role="log"
        aria-label="Application logs"
        ref={container}
        onScroll={() => {
          const view = container.current;
          if (view)
            nearBottom.current =
              view.scrollHeight - view.scrollTop - view.clientHeight < 60;
        }}
      >
        {filtered.map((entry, index) => (
          <div className="log" data-level={entry.level} key={index}>
            <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
            <div>
              <pre>{entry.message}</pre>
              <div className="log-source">
                {entry.level} · {entry.source} ·{' '}
                {entry.scope === 'session'
                  ? 'development session'
                  : 'selected target'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
function Animations({ inspector: { state } }: { inspector: Inspector }) {
  return (
    <div id="animations">
      <div className="diagnostic-note">
        {!state.supports('animations')
          ? 'This target does not support animation inspection.'
          : `${state.selected ? 'Selected node' : 'All nodes'} · ${state.activeAnimations.length} active or paused animations (up to 256). Presentation values come from the engine.`}
        {state.activeAnimations.some((animation) => animation.snapshotTruncated)
          ? ' Snapshot limit reached.'
          : ''}
      </div>
      {state.activeAnimations.map((animation) => (
        <div className="animation-row" key={animation.id}>
          {`#${animation.id} · ${animation.kind} · ${animation.state} · ${animation.elapsedMs.toFixed(1)} ms / ${animation.durationMs ?? 'infinite'} ms (${animation.durationScope}) · delay ${animation.delayMs} ms\n` +
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
                : '')}
        </div>
      ))}
      {!!state.animationHistory.length && (
        <>
          <div className="diagnostic-note">
            Recent lifecycle events (this target, up to 100)
          </div>
          {state.animationHistory.toReversed().map((entry, index) => (
            <div
              className="animation-row"
              key={index}
            >{`#${entry.id} · node ${entry.node.id} · ${entry.state} · playback ${entry.playbackGeneration}`}</div>
          ))}
        </>
      )}
    </div>
  );
}
function Performance({
  inspector: { state, ui, actions },
}: {
  inspector: Inspector;
}) {
  const frames =
    state.performance?.frames.filter((frame) => frame.frameMs !== undefined) ??
    [];
  const first = frames[0]?.timestampMs ?? 0;
  const span = Math.max(1, (frames.at(-1)?.timestampMs ?? 0) - first);
  const peak = Math.max(0, ...frames.map((frame) => frame.frameMs ?? 0));
  return (
    <>
      <div className="console-tools">
        <button
          id="record-performance"
          disabled={
            !state.connected ||
            !state.supports('performance') ||
            ui.diagnosticsBusy
          }
          onClick={actions.record}
        >
          {state.performance?.recording ? 'Stop recording' : 'Start recording'}
        </button>
        <span id="performance-status" role="status">
          {!state.supports('performance')
            ? 'This target does not support performance diagnostics'
            : state.performance?.recording
              ? 'Recording · 10 Hz samples'
              : 'Recording is off'}
        </span>
      </div>
      <div id="performance">
        <div id="performance-summary" className="metric-grid">
          {state.performance &&
            Object.entries(metricSummary(state.performance)).map(
              ([name, value]) => (
                <div className="metric" key={name}>
                  {name}
                  <strong>{String(value)}</strong>
                </div>
              ),
            )}
        </div>
        <svg
          id="performance-chart"
          viewBox="0 0 800 80"
          role="img"
          aria-label="Measured CPU frame duration over time"
        >
          {!!frames.length && (
            <>
              <title>{`Measured CPU frame duration, ${frames.length} samples, peak ${peak.toFixed(2)} ms`}</title>
              <polyline
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                points={frames
                  .map(
                    (frame) =>
                      `${((frame.timestampMs - first) / span) * 790 + 5},${75 - ((frame.frameMs ?? 0) / Math.max(1, peak)) * 65}`,
                  )
                  .join(' ')}
              />
            </>
          )}
        </svg>
        <div className="diagnostic-note">
          CPU frame work and submission time. GPU execution time and dropped GPU
          frames are not measured.
        </div>
        <div id="performance-phases">
          {state.performance &&
            !!Object.keys(state.performance.phases).length && (
              <pre className="diagnostic-note">{`Measured UI tick phases and work counters (latest sampling window)\n${JSON.stringify(state.performance.phases, null, 2)}`}</pre>
            )}
        </div>
      </div>
    </>
  );
}
export function DiagnosticsView({ inspector }: { inspector: Inspector }) {
  return (
    <section className="console" aria-label="Diagnostics">
      <nav className="dock-tabs" aria-label="Diagnostics panels">
        {['console', 'animations', 'performance'].map((name) => (
          <button
            id={`tab-${name}`}
            key={name}
            aria-pressed={inspector.ui.dock === name}
            onClick={() => inspector.actions.showDock(name)}
          >
            {name[0]!.toUpperCase() + name.slice(1)}
          </button>
        ))}
      </nav>
      <div
        id="panel-console"
        className="dock-panel"
        hidden={inspector.ui.dock !== 'console'}
      >
        <Logs inspector={inspector} />
      </div>
      <div
        id="panel-animations"
        className="dock-panel"
        hidden={inspector.ui.dock !== 'animations'}
      >
        <Animations inspector={inspector} />
      </div>
      <div
        id="panel-performance"
        className="dock-panel"
        hidden={inspector.ui.dock !== 'performance'}
      >
        <Performance inspector={inspector} />
      </div>
    </section>
  );
}
