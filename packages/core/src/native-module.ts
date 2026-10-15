// Preserve the shared toolchain API; Hermes lowering belongs to the engine.
export {
  toNativeModule,
  type NativeModuleOptions,
  type NativeModuleResult,
} from '@soundor/engine/native-module';
