# @soundor/web-runtime

Runs a Soundor plugin in the browser. The plugin contract generated from
`soundor.config.ts` is implemented with TypeScript and browser APIs, and Vite
serves and builds the Web host.

```ts
// soundor.config.ts
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  // ...
  runtimes: [webRuntime()],
});
```

```sh
soundor init web    # scaffold runtimes/web/ (yours; never overwritten)
soundor dev web     # serve the Web host
soundor build web   # a static site in .soundor/dist/web
soundor doctor
```

## License

MIT
