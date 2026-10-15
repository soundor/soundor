import { useSyncExternalStore } from 'react';

import type { Inspector } from './controller';
import { DetailsView } from './details-view';
import { DiagnosticsView } from './diagnostics-view';
import { TreeView } from './tree-view';

export function App({ inspector }: { inspector: Inspector }) {
  useSyncExternalStore(inspector.subscribe, inspector.getSnapshot);
  const { state, ui, actions } = inspector;
  const target = state.currentTarget();
  const ownsControl = state.ownsControl();
  return (
    <>
      <header>
        <h1>
          Soundor{' '}
          <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
            DevTools
          </span>
        </h1>
        <span id="status" role="status">
          {ui.status}
        </span>
      </header>
      <form
        id="auth"
        hidden={!ui.authRequired}
        onSubmit={(event) => {
          event.preventDefault();
          const key = event.currentTarget.elements.namedItem(
            'key',
          ) as HTMLInputElement;
          actions.authorize(key.value);
          key.value = '';
        }}
      >
        <strong>Authorize this browser</strong>
        <p>
          Enter the browserKey from the protected session file shown in your
          terminal. Enabling devtools.open authorizes the first tab
          automatically.
        </p>
        <label htmlFor="key">Browser key</label>
        <br />
        <input
          id="key"
          name="key"
          type="password"
          autoComplete="off"
          required
        />
        <button>Connect</button>
      </form>
      <div className="toolbar">
        <label htmlFor="targets">Target</label>
        <select
          id="targets"
          value={state.targetId}
          onChange={(event) => actions.switchTarget(event.currentTarget.value)}
        >
          {!state.targets.length && (
            <option value="">No connected runtimes</option>
          )}
          {state.targets.map((item) => (
            <option
              value={item.id}
              key={item.id}
            >{`${item.name} — ${item.runtime}${state.targets.some((other) => other.id !== item.id && other.name === item.name && other.runtime === item.runtime) ? ` [${item.id.slice(0, 8)}]` : ''}`}</option>
          ))}
        </select>
        <span id="target-meta">
          {target
            ? `${target.runtime} · instance ${target.id.slice(0, 8)} · generation ${target.generation} · ${target.capabilities.join(', ')}${target.processId ? ` · PID ${target.processId}` : ''}`
            : ''}
        </span>
        <span id="ownership">
          {ownsControl
            ? 'You control this target'
            : target?.controller
              ? 'Observer · another tab controls'
              : 'Observer · control available'}
        </span>
        <button
          id="control"
          disabled={!state.connected || !target}
          onClick={actions.control}
        >
          {ownsControl ? 'Release control' : 'Request control'}
        </button>
      </div>
      <div className="toolbar">
        <button
          id="picker"
          aria-pressed={state.picker}
          disabled={
            !state.connected ||
            !ownsControl ||
            !state.supports('inspector') ||
            ui.diagnosticsBusy
          }
          onClick={actions.picker}
        >
          {state.picker ? 'Cancel picker (Escape)' : 'Select element'}
        </button>
        <button
          id="refresh"
          disabled={!state.connected || !state.supports('inspector')}
          onClick={actions.refresh}
        >
          Refresh
        </button>
        <button
          id="clear-selection"
          disabled={!state.selected}
          onClick={actions.clearSelection}
        >
          Clear selection
        </button>
        <input
          id="search"
          type="search"
          placeholder="Search type, text, role or ID"
          aria-label="Search nodes"
          value={ui.search}
          onInput={(event) => actions.search(event.currentTarget.value)}
        />
        <span style={{ color: 'var(--muted)' }}>
          Native UI stays in its own window
        </span>
      </div>
      <div id="notice" role="alert" hidden={!ui.notice}>
        {ui.notice}
      </div>
      <main>
        <section className="elements">
          <h2>Elements</h2>
          <TreeView inspector={inspector} />
          <div id="tree-note" hidden={!ui.treeNote}>
            {ui.treeNote}
          </div>
        </section>
        <DetailsView inspector={inspector} />
      </main>
      <DiagnosticsView inspector={inspector} />
    </>
  );
}
