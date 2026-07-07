import { describe, expect, it } from 'vitest';

import { createCodegenSink, nullCodegenSink } from './codegen';

describe('createCodegenSink', () => {
  it('records emitted files in order', () => {
    const sink = createCodegenSink();
    sink.emit({ path: 'a.ts', contents: 'A' });
    sink.emitAll([
      { path: 'b.ts', contents: 'B' },
      { path: 'c.ts', contents: 'C' },
    ]);
    expect(sink.files()).toEqual([
      { path: 'a.ts', contents: 'A' },
      { path: 'b.ts', contents: 'B' },
      { path: 'c.ts', contents: 'C' },
    ]);
  });

  it('overwrites an earlier emit to the same path', () => {
    const sink = createCodegenSink();
    sink.emit({ path: 'a.ts', contents: 'first' });
    sink.emit({ path: 'a.ts', contents: 'second' });
    expect(sink.files()).toEqual([{ path: 'a.ts', contents: 'second' }]);
  });
});

describe('nullCodegenSink', () => {
  it('discards everything without throwing', () => {
    expect(() => {
      nullCodegenSink.emit({ path: 'a.ts', contents: 'A' });
      nullCodegenSink.emitAll([{ path: 'b.ts', contents: 'B' }]);
    }).not.toThrow();
  });
});
