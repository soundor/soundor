// Library-test declarations matching vitest.config.ts. Application consumers use
// their generated project declarations (verified by the packed consumer test).
declare module 'soundor:parameters' {
  export const parameters: {
    readonly voices: import('@soundor/test-runtime').TestRuntime['parameters']['byId'][string];
    readonly gain: import('@soundor/test-runtime').TestRuntime['parameters']['byId'][string];
  };
}
declare module 'soundor:host' {
  export const snapshot: import('@soundor/test-runtime').TestRuntime['snapshot'];
  export const subscribe: import('@soundor/test-runtime').TestRuntime['subscribe'];
}
declare module 'soundor:native' {
  export function loadPreset(): Promise<string>;
  export function probe(): number;
}
