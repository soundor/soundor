// The plugin's native API (soundor:native) for the Web, in TypeScript. The
// plugin UI's calls arrive here as they are made: same values, exceptions
// and promises. WebNativeApi is generated from soundor.config, so a method
// added there is a type error here until it is implemented.
import type { WebNativeApi } from '../../../.soundor/generated/runtimes/web/native';

export const native: WebNativeApi = {};
