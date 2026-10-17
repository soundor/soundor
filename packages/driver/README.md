# @soundor/driver

Soundor Driver: inspect and control a running Soundor plugin's native UI from
Node.js. It connects to the DevTools session of `soundor dev` as a control
client, through the same authenticated transport as the DevTools dashboard,
and works with the real engine: its node tree, bounds, styles and
accessibility. It does not depend on a test runner, JUCE or React.

```ts
import { connect } from '@soundor/driver';

// The descriptor path soundor dev prints as "DevTools session file".
const driver = await connect({
  descriptorPath: process.env.SOUNDOR_DEVTOOLS_SESSION,
});
try {
  const tree = await driver.getTree();
  console.log(tree.nodes.length);
  const gain = driver.getByDebugId('gain');
  console.log(await gain.getBounds());
} finally {
  await driver.disconnect();
}
```

The `soundor driver` commands of the CLI use it:

```sh
soundor driver targets --json
soundor driver tree --json
soundor driver inspect gain
```

- [Soundor Driver guide](https://soundor.dev/docs/driver)
- [Documentation](https://soundor.dev/docs)

## License

MIT
