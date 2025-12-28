import { useCallback } from 'react';

export function useHelloWorld() {
  return useCallback(() => {
    console.log('Hello World!');
  }, []);
}
