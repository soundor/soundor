import { useHelloWorld } from '@soundor/react';

function App() {
  const { count, sayHello } = useHelloWorld();

  return (
    <>
      <h1>Soundor</h1>
      <h2>Hello: {count}</h2>
      <button onClick={sayHello} type="button">
        Say Hello
      </button>
    </>
  );
}

export default App;
