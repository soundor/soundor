// The plugin's native API (soundor:native) for the Web. The analyzer declares
// no methods; its streams are published by the Rust processing in native/.
import type { WebNativeApi } from '../../../.soundor/generated/runtimes/web/native';

export const native: WebNativeApi = {};
