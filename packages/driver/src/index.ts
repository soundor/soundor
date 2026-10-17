export { connect, Driver, type ConnectOptions } from './driver';
export { DriverError, isDriverError, type DriverErrorCode } from './errors';
export { Locator, type Bounds, type Selector } from './locator';
export { BROWSER_KEY_ENV, DESCRIPTOR_ENV } from './session';
export type { CallOptions } from './transport';
export type {
  DebugNode,
  DebugTarget,
  DebugTree,
  NodeRef,
} from '@soundor/devtools-protocol';
