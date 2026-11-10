import { useId } from 'preact/hooks';

import type { WebParameter } from '../parameters';
import { useParameterValue } from './hooks';

/** Slider positions of a continuous parameter. */
const POSITIONS = 1000;

/**
 * One parameter's control, kept in step with its value however it changes:
 * a slider for numbers (a gesture while dragging), a checkbox, or a menu. A
 * slider moves through the parameter's mapping, as a host's would, and shows
 * the parameter's own text. A read-only parameter is shown, not edited.
 */
export function ParameterControl({
  parameter,
}: {
  readonly parameter: WebParameter;
}) {
  const id = useId();
  const value = useParameterValue(parameter);
  const info = parameter.info;
  const readOnly = info.access === 'readOnly';
  const label = <label for={id}>{info.label}</label>;

  switch (info.type) {
    case 'boolean':
      return (
        <div class="soundor-param">
          {label}
          <input
            id={id}
            type="checkbox"
            checked={value as boolean}
            disabled={readOnly}
            onChange={(event) => parameter.set(event.currentTarget.checked)}
          />
        </div>
      );
    case 'choice':
      return (
        <div class="soundor-param">
          {label}
          <select
            id={id}
            class="soundor-field"
            value={value as string}
            disabled={readOnly}
            onChange={(event) => parameter.set(event.currentTarget.value)}
          >
            {info.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    default: {
      // Integers have one position per value; floats move continuously.
      const positions =
        info.type === 'float32'
          ? POSITIONS
          : Math.round((info.max - info.min) / (info.step ?? 1));
      const position = Math.round(parameter.toNormalized() * positions);
      return (
        <div class="soundor-param">
          {label}
          <output for={id}>{parameter.format(value as never)}</output>
          <input
            id={id}
            type="range"
            min={0}
            max={positions}
            step={1}
            value={position}
            disabled={readOnly}
            onInput={(event) =>
              parameter.set(
                parameter.fromNormalized(
                  Number(event.currentTarget.value) / positions,
                ) as never,
              )
            }
            onPointerDown={() => parameter.beginGesture()}
            onPointerUp={() => parameter.endGesture()}
            onLostPointerCapture={() => parameter.endGesture()}
          />
        </div>
      );
    }
  }
}
