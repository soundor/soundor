// Declarations matching vitest.config.ts, which declares them without a
// project config (a project's own come from its generated declarations).
declare module 'soundor:native' {
  export const streams: {
    readonly level: {
      get(): number | undefined;
      subscribe(
        listener: (value: number, sequence: number) => void,
      ): () => void;
    };
  };
}
declare module 'soundor:state' {
  export const state: {
    readonly historyCounter: {
      get(): number;
      set(value: number | ((current: number) => number)): void;
      subscribe(listener: (value: number) => void): () => void;
    };
  };
}
