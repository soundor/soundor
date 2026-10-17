export { connect, Driver, type ConnectOptions } from './driver';
export { DriverError, isDriverError, type DriverErrorCode } from './errors';
export {
  Keyboard,
  Pointer,
  type InputResult,
  type Modifier,
  type MouseButton,
  type PointerOptions,
  type WheelOptions,
} from './input';
export {
  Locator,
  type ActionOptions,
  type Bounds,
  type ClickOptions,
  type DragOptions,
  type ScrollOptions,
  type Selector,
} from './locator';
export { BROWSER_KEY_ENV, DESCRIPTOR_ENV } from './session';
export type { CallOptions } from './transport';
export type {
  DebugNode,
  DebugTarget,
  DebugTree,
  HitTest,
  NodeRef,
} from '@soundor/devtools-protocol';
