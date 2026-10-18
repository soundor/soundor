import { useSyncExternalStore } from 'react';

import type { Inspector } from './controller';
import { DetailsView } from './details-view';
import { DiagnosticsView } from './diagnostics-view';
import { TreeView } from './tree-view';

export function App({ inspector }: { inspector: Inspector }) {
  useSyncExternalStore(inspector.subscribe, inspector.getSnapshot);
  const { state, ui, actions } = inspector;
  const target = state.currentTarget();
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
      </div>
      <div className="toolbar">
        <button
          id="picker"
          aria-pressed={state.picker}
          disabled={
            !state.connected ||
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
          id="screenshot"
          hidden={!state.supports('capture')}
          disabled={!state.connected || ui.capturing}
          onClick={actions.screenshot}
        >
          {ui.capturing ? 'Capturing…' : 'Screenshot'}
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
      {ui.capture && (
        <section
          id="capture"
          role="dialog"
          aria-label="Screenshot"
          className="capture"
        >
          <div className="capture-bar">
            <strong>Screenshot</strong>
            <span id="capture-meta">
              {`${ui.capture.width}×${ui.capture.height} px · scale ${ui.capture.scale} · ${Math.ceil(ui.capture.bytes / 1024)} KB · as the engine renders it`}
            </span>
            <a
              id="capture-download"
              className="button"
              href={ui.capture.url}
              download={`${ui.capture.target.replace(/[^\w.-]+/g, '-')}-${new Date(ui.capture.taken).toISOString().replace(/[:.]/g, '-')}.png`}
            >
              Download
            </a>
            <button id="capture-close" onClick={actions.closeCapture}>
              Close
            </button>
          </div>
          <img
            id="capture-image"
            src={ui.capture.url}
            alt={`Screenshot of ${ui.capture.target}`}
            width={ui.capture.width / ui.capture.scale}
          />
        </section>
      )}
    </>
  );
}
