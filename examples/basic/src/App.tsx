import { useHelloWorld } from '@soundor/react';
import { useEffect } from 'react';

function App() {
  const helloWorld = useHelloWorld();

  useEffect(() => {
    helloWorld();
  }, [helloWorld]);

  return <h1>Soundor</h1>;
}

export default App;
