# @soundor/react

React bindings for Soundor plugin UIs.

## Install

```sh
pnpm add @soundor/react @soundor/bridge react
```

## Usage

```tsx
import { SoundorProvider } from '@soundor/react';
import { bridge } from 'virtual:soundor/bridge';

export function App() {
  return <SoundorProvider bridge={bridge}>...</SoundorProvider>;
}
```

## License

MIT
