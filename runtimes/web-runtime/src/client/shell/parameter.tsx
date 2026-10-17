import { useId } from 'preact/hooks';

import type { WebParameter } from '../parameters';
import { useParameterValue } from './hooks';

/**
 * One parameter's control, kept in step with its value however it changes:
 * a slider for numbers (a gesture while dragging), a checkbox, or a menu.
 */
export function ParameterControl({
  parameter,
}: {
  readonly parameter: WebParameter;
}) {
  const id = useId();
  const value = useParameterValue(parameter);
  const info = parameter.info;
  const label = <label for={id}>{info.label}</label>;

  switch (info.type) {
    case 'float':
    case 'int': {
      const number = value as number;
      return (
        <div class="soundor-param">
          {label}
          <output for={id}>
            {formatNumber(number)}
            {info.unit === undefined ? '' : ` ${info.unit}`}
          </output>
          <input
            id={id}
            type="range"
            min={info.min}
            max={info.max}
            step={info.type === 'int' ? 1 : (info.max - info.min) / 1000}
            value={number}
            onInput={(event) =>
              parameter.set(Number(event.currentTarget.value))
            }
            onPointerDown={() => parameter.beginGesture()}
            onPointerUp={() => parameter.endGesture()}
            onLostPointerCapture={() => parameter.endGesture()}
          />
        </div>
      );
    }
    case 'bool':
      return (
        <div class="soundor-param">
          {label}
          <input
            id={id}
            type="checkbox"
            checked={value as boolean}
            onChange={(event) => parameter.set(event.currentTarget.checked)}
          />
        </div>
      );
    case 'enum':
      return (
        <div class="soundor-param">
          {label}
          <select
            id={id}
            class="soundor-field"
            value={value as string}
            onChange={(event) => parameter.set(event.currentTarget.value)}
          >
            {info.values.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
  }
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
