import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useHelloWorld } from './index';

describe('useHelloWorld', () => {
  it('should initialize count to 0', () => {
    const { result } = renderHook(() => useHelloWorld());

    expect(result.current.count).toBe(0);
  });

  it('should increment count when sayHello is called', () => {
    const { result } = renderHook(() => useHelloWorld());

    act(() => {
      result.current.sayHello();
    });

    expect(result.current.count).toBe(1);

    act(() => {
      result.current.sayHello();
    });

    expect(result.current.count).toBe(2);
  });

  it('should log "Hello World!" when sayHello is called', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { result } = renderHook(() => useHelloWorld());

    act(() => {
      result.current.sayHello();
    });

    expect(consoleSpy).toHaveBeenCalledWith('Hello World!');
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});
