// What a runtime package needs of Soundor, from one dependency: the SDK's own
// defineRuntime, and all of @soundor/config and @soundor/core, re-exported.
// A runtime depends on this package alone, so its declarations name no other
// Soundor package. Its soundor peer dependency declares the supported host versions.

export { defineRuntime } from './runtime';
export type { RuntimeDefinition } from './runtime';

export * from '@soundor/config';
export * from '@soundor/core';
