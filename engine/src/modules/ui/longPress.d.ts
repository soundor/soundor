interface GestureNode {
  parent: GestureNode | null;
  isConnected: boolean;
  inputDisabled: boolean;
}

export class LongPresses {
  setDelay(node: GestureNode, value: number): () => void;
  start(
    id: number,
    target: GestureNode,
    x: number,
    y: number,
    recognized: () => void,
  ): void;
  move(id: number, x: number, y: number, buttons: number): void;
  nativeHold(id: number): void;
  cancel(id: number): void;
  cancelWithin(ancestor: GestureNode): void;
  clear(): void;
}
