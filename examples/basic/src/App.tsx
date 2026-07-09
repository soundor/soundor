import { SoundorProvider, useParam } from '@soundor/react';
import { bridge } from 'virtual:soundor/bridge';

function App() {
  return (
    <SoundorProvider bridge={bridge}>
      <Demo />
    </SoundorProvider>
  );
}

function Demo() {
  const [gain, setGain] = useParam('gain');

  return (
    <>
      <h1>Soundor</h1>
      <label>
        Gain: {gain.toFixed(2)}
        <input
          max="1"
          min="0"
          onChange={(event) => setGain(event.currentTarget.valueAsNumber)}
          step="0.01"
          type="range"
          value={gain}
        />
      </label>
    </>
  );
}

export default App;
