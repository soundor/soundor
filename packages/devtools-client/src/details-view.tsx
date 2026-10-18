import type { Inspector } from './controller';
import { label } from './tree';

function DetailGroup({
  heading,
  data,
}: {
  heading: string;
  data: Record<string, unknown>;
}) {
  if (!Object.keys(data).length) return null;
  return (
    <details className="detail-group" open>
      <summary>{heading}</summary>
      <table>
        <tbody>
          {Object.entries(data).map(([name, value]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>
                {typeof value === 'object'
                  ? JSON.stringify(value, null, 2)
                  : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
/** This tab's synthetic input on the selected node. */
function NodeActions({ inspector }: { inspector: Inspector }) {
  const { state, ui, actions } = inspector;
  const node = ui.details;
  if (!node) return null;
  if (!state.supports('input'))
    return (
      <div className="node-actions" id="node-actions">
        <span className="hint">This target does not accept input.</span>
      </div>
    );
  const enabled = state.connected && !ui.interacting;
  return (
    <div
      className="node-actions"
      id="node-actions"
      role="group"
      aria-label="Interact with the node"
    >
      <button
        id="node-click"
        disabled={!enabled}
        onClick={() => actions.interact('click')}
      >
        Click
      </button>
      <button
        id="node-hover"
        disabled={!enabled}
        onClick={() => actions.interact('hover')}
      >
        Hover
      </button>
      <button
        id="node-focus"
        disabled={!enabled || node.properties?.['focusable'] !== true}
        onClick={() => actions.interact('focus')}
      >
        Focus
      </button>
      <span className="hint" id="interaction" role="status">
        {ui.interaction}
      </span>
    </div>
  );
}

export function DetailsView({ inspector }: { inspector: Inspector }) {
  const { state, ui } = inspector;
  const node = ui.details;
  return (
    <section id="details" aria-label="Node details">
      <h2>Details</h2>
      {!node ? (
        <div className="empty">
          {state.selected
            ? 'Loading node…'
            : 'Select a node to inspect its live engine state.'}
        </div>
      ) : (
        <>
          <div className="node-heading">{label(node)}</div>
          <NodeActions inspector={inspector} />
          <DetailGroup
            heading="Properties"
            data={{
              type: node.type,
              identity: `${state.targetId} / ${node.ref.generation} / ${node.ref.id}`,
              ...(node.debugId ? { debugId: node.debugId } : {}),
              ...(node.text !== undefined ? { text: node.text } : {}),
              focused: node.focused,
              visible: node.visible,
              ...node.properties,
            }}
          />
          <DetailGroup
            heading="Layout"
            data={{ bounds: node.bounds, ...node.layout }}
          />
          {node.styles && (
            <DetailGroup heading="Base styles" data={node.styles} />
          )}
          {node.presentation && (
            <DetailGroup
              heading="Presentation values"
              data={node.presentation}
            />
          )}
          {state.supports('accessibility') && node.accessibility && (
            <DetailGroup heading="Accessibility" data={node.accessibility} />
          )}
          {ui.detailAnimations && (
            <DetailGroup heading="Animations" data={ui.detailAnimations} />
          )}
        </>
      )}
    </section>
  );
}
