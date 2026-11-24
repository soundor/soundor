interface GestureNode {
  parent: GestureNode | null;
  isConnected: boolean;
  inputDisabled: boolean;
  type: string;
}

export function canHold(
  target: GestureNode,
  button: number,
  buttons: number,
  pointerType: string,
): boolean;

export function longPressed(
  pointerType: string,
  dispatch: (type: 'longpress' | 'contextmenu') => boolean,
  available: () => boolean,
): boolean;

export class LongPresses {
  setDelay(node: GestureNode, value: number): () => void;
  start(
    id: number,
    target: GestureNode,
    x: number,
    y: number,
    recognized: () => void,
  ): void;
  pending(id: number): boolean;
  move(id: number, x: number, y: number, buttons: number): void;
  nativeHold(id: number): void;
  cancel(id: number): void;
  cancelWithin(ancestor: GestureNode): void;
  clear(): void;
}
