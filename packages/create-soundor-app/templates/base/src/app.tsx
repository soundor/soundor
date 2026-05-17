import { useHelloWorld } from '@soundor/react';

function App() {
  const { count, sayHello } = useHelloWorld();

  return (
    <>
      <h1>__PROJECT_NAME__</h1>
      <h2>Hello: {count}</h2>
      <button onClick={sayHello} type="button">
        Say Hello
      </button>
    </>
  );
}

export default App;
