import { expect, it } from 'vitest';

import type {
  HistoryOption,
  HistoryOptions,
  StateHistory,
} from '../src/history';
import cases from './history-cases.json';
interface Field {
  get(): unknown;
  set(value: any, options?: HistoryOptions): void;
  beginGesture(options?: HistoryOptions): void;
  endGesture(): void;
}
interface Step {
  op: string;
  field?: string;
  value?: unknown;
  history?: HistoryOption;
  label?: string;
  steps?: Step[];
}
export function historyConformance(
  factory: () => {
    history: Pick<
      StateHistory,
      | 'undo'
      | 'redo'
      | 'transaction'
      | 'canUndo'
      | 'canRedo'
      | 'undoLabel'
      | 'redoLabel'
    >;
    bypass: Field;
    selected: Field;
    host(value: boolean): void;
  },
): void {
  for (const test of cases)
    it(`${test.name}`, () => {
      const runtime = factory();
      const execute = (steps: Step[]) => {
        for (const step of steps) {
          const field =
            step.field === 'bypass' ? runtime.bypass : runtime.selected;
          const options = { history: step.history };
          switch (step.op) {
            case 'set':
              field.set(step.value, options);
              break;
            case 'begin':
              field.beginGesture(options);
              break;
            case 'end':
              field.endGesture();
              break;
            case 'undo':
              runtime.history.undo();
              break;
            case 'redo':
              runtime.history.redo();
              break;
            case 'host':
              runtime.host(step.value as boolean);
              break;
            case 'transaction':
              runtime.history.transaction(step.label!, () =>
                execute(step.steps!),
              );
              break;
            default:
              throw new Error(`unknown operation ${step.op}`);
          }
        }
      };
      execute(test.steps as Step[]);
      expect(runtime.bypass.get()).toBe(test.bypass);
      expect(runtime.selected.get()).toBe(test.selected);
      expect(runtime.history.undoLabel()).toBe(test.undo);
      expect(runtime.history.redoLabel()).toBe(test.redo);
      expect(runtime.history.canUndo()).toBe(test.undo !== null);
      expect(runtime.history.canRedo()).toBe(test.redo !== null);
    });
}
