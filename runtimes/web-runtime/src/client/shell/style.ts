/** The host page's styles, added to the document's head with the shell. */
export const STYLE = `
body { margin: 0; background: var(--sd-bg); }
.soundor-host {
  --sd-bg: #0b0c0f; --sd-surface: #15161a; --sd-raised: #1d1f24;
  --sd-line: #2a2c33; --sd-text: #e6e7ea; --sd-muted: #8b8f98;
  --sd-accent: #3a7bfd; --sd-ok: #34c77b; --sd-warn: #f2b13a; --sd-bad: #ff6b5e;
  position: relative; display: flex; height: 100vh; overflow: hidden;
  background: var(--sd-bg); color: var(--sd-text);
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: dark;
}
.soundor-host button, .soundor-host select, .soundor-host input { font: inherit; color: inherit; }
.soundor-host svg { width: 18px; height: 18px; fill: currentColor; flex: none; }

/* Stage: the plugin, centred, with room under it for the dock. */
.soundor-stage {
  position: relative; flex: 1; min-width: 0; display: flex;
  align-items: center; justify-content: center;
  padding: 16px 16px 76px; box-sizing: border-box;
  background-image: radial-gradient(circle, #ffffff0d 1px, transparent 1px);
  background-size: 20px 20px;
}
.soundor-frame { position: relative; flex: none; }
/* A resizable view's handle: just outside its bottom-right corner. */
.soundor-resize {
  position: absolute; right: -14px; bottom: -14px; width: 14px; height: 14px;
  display: flex; align-items: center; justify-content: center; padding: 0;
  border: 0; border-radius: 3px; background: none; color: var(--sd-muted);
  cursor: nwse-resize; touch-action: none;
}
.soundor-host .soundor-resize svg { width: 10px; height: 10px; }
.soundor-resize:hover, .soundor-resize:active { color: var(--sd-text); }
.soundor-resize:focus-visible { outline: 2px solid var(--sd-accent); outline-offset: 1px; }
/* Embedded: the plugin view is the page. */
.soundor-fill { padding: 0; background: none; }
.soundor-fill .soundor-viewport { inset: 0; border-radius: 0; box-shadow: none; }
.soundor-viewport {
  position: absolute; left: 0; top: 0; overflow: hidden; background: #17181c;
  transform-origin: 0 0; border-radius: 6px;
  box-shadow: 0 0 0 1px var(--sd-line), 0 20px 60px rgb(0 0 0 / 0.5);
}
.soundor-message {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; padding: 24px;
  text-align: center; color: var(--sd-muted);
}
.soundor-message strong { color: var(--sd-text); font-size: 14px; }
.soundor-message pre {
  max-width: 100%; overflow: auto; margin: 0; text-align: left;
  white-space: pre-wrap; font-size: 12px; color: var(--sd-bad);
}

/* Dock: floats under the plugin. */
.soundor-dock {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 4px; padding: 4px;
  max-width: calc(100% - 32px); box-sizing: border-box;
  background: rgb(29 31 36 / 0.88); backdrop-filter: blur(12px);
  border: 1px solid var(--sd-line); border-radius: 12px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.4); white-space: nowrap;
}
.soundor-divider { width: 1px; height: 20px; background: var(--sd-line); margin: 0 4px; flex: none; }
.soundor-icon {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 32px; min-width: 32px; padding: 0 7px; box-sizing: border-box;
  border: 0; border-radius: 8px; background: transparent; cursor: pointer;
}
.soundor-icon:hover { background: #ffffff14; }
.soundor-icon:focus-visible { outline: 2px solid var(--sd-accent); outline-offset: 1px; }
.soundor-icon[aria-pressed="true"] { background: #3a7bfd33; color: #8fb3ff; }
.soundor-audio { position: relative; }
.soundor-audio[data-state="failed"] { color: var(--sd-bad); }
.soundor-volume { width: 84px; accent-color: var(--sd-accent); margin: 0 6px 0 2px; }
.soundor-position {
  font-variant-numeric: tabular-nums; min-width: 40px; padding: 0 6px;
  color: var(--sd-muted); text-align: center;
}
.soundor-position.soundor-playing { color: var(--sd-text); }
@media (max-width: 480px) { .soundor-volume { display: none; } }

/* Panel: host settings, closed by default. */
.soundor-panel {
  flex: none; width: 300px; display: flex; flex-direction: column;
  background: var(--sd-surface); border-left: 1px solid var(--sd-line);
  overflow: hidden;
}
.soundor-panel[hidden] { display: none; }
@media (max-width: 720px) {
  .soundor-panel {
    position: absolute; inset: 0 0 0 auto; width: min(300px, 100%); z-index: 1;
    box-shadow: -12px 0 32px rgb(0 0 0 / 0.5);
  }
}
.soundor-panel-header {
  display: flex; align-items: center; gap: 8px; padding: 10px 8px 10px 16px;
  border-bottom: 1px solid var(--sd-line); flex: none;
}
.soundor-heading { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.soundor-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.soundor-subtitle { font-size: 11px; color: var(--sd-muted); }
.soundor-panel-body { overflow: auto; flex: 1; }
.soundor-section { padding: 14px 16px; border-bottom: 1px solid var(--sd-line); }
.soundor-section h2 {
  margin: 0 0 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--sd-muted);
}
.soundor-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.soundor-row + .soundor-row { margin-top: 6px; }
.soundor-row > label, .soundor-row > .soundor-label { flex: 1; min-width: 0; color: var(--sd-muted); }
.soundor-field {
  height: 28px; box-sizing: border-box; padding: 0 8px; min-width: 0;
  background: var(--sd-raised); border: 1px solid var(--sd-line); border-radius: 6px;
}
.soundor-field:focus-visible { outline: 2px solid var(--sd-accent); outline-offset: -1px; }
select.soundor-field { width: 132px; }
input.soundor-field[type="number"] { width: 72px; }
.soundor-status { color: var(--sd-muted); font-size: 12px; margin-top: 8px; }
.soundor-status > span { display: block; }
.soundor-audio-error { color: var(--sd-bad); }
.soundor-audio-error:empty { display: none; }
.soundor-param { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; }
.soundor-param + .soundor-param { margin-top: 10px; }
.soundor-param label { color: var(--sd-text); }
.soundor-param output { color: var(--sd-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.soundor-param input[type="range"] { grid-column: 1 / -1; width: 100%; margin: 0; accent-color: var(--sd-accent); }
.soundor-param select { grid-column: 1 / -1; width: 100%; }
.soundor-empty { color: var(--sd-muted); }
.soundor-inspector summary { cursor: pointer; color: var(--sd-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.soundor-inspector pre {
  margin: 10px 0 0; font: 11px/1.5 ui-monospace, 'SF Mono', Menlo, monospace;
  color: var(--sd-text); white-space: pre-wrap;
}
`;
