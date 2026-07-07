// A minimal in-memory runtime for fixtures. Structurally satisfies the
// `Runtime` contract (id + five lifecycle methods) without importing
// `@soundor/config`, which is shimmed away while a config is being loaded.

const noop = async (): Promise<void> => {};

export function fakeRuntime(id: string) {
  return {
    id,
    init: noop,
    gen: noop,
    dev: noop,
    build: noop,
    doctor: async () => ({ checks: [] }),
  };
}
