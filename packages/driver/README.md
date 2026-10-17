# @soundor/driver

Soundor Driver: inspect and control a running Soundor plugin's native UI from
Node.js. It connects to the DevTools session of `soundor dev` as a control
client, through the same authenticated transport as the DevTools dashboard,
and works with the real engine: its node tree, bounds, styles and
accessibility; clicks, drags, keys and text through the engine's own input
dispatch; and PNG captures of what it renders. It does not depend on a test
runner, JUCE or React.

```ts
import { connect } from '@soundor/driver';

// The descriptor path soundor dev prints as "DevTools session file".
const driver = await connect({
  descriptorPath: process.env.SOUNDOR_DEVTOOLS_SESSION,
});
try {
  const tree = await driver.getTree();
  console.log(tree.nodes.length);
  const reset = driver.getByDebugId('reset');
  console.log(await reset.getBounds());
  await reset.click();
  await driver.screenshot({ path: './after-reset.png' });
} finally {
  await driver.disconnect();
}
```

The `soundor driver` commands of the CLI use it:

```sh
soundor driver targets --json
soundor driver tree --json
soundor driver inspect reset
soundor driver click reset
soundor driver screenshot ./after-reset.png
```

- [Soundor Driver guide](https://soundor.dev/docs/driver)
- [Documentation](https://soundor.dev/docs)

## License

MIT
