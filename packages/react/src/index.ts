import { useCallback, useState } from 'react';

export function useHelloWorld() {
  const [count, setCount] = useState(0);

  const sayHello = useCallback(() => {
    console.log('Hello World!');
    setCount((count) => count + 1);
  }, []);

  return { count, sayHello };
}
