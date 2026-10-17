---
title: 'Connecting to a running plugin'
description: 'Sign in to a DevTools session, select an instance, and handle timeouts, cancellation, reloads and errors.'
---

`connect()` signs in to one DevTools session and returns a `Driver`. A
session is the one [`soundor dev`](/docs/cli/dev) runs; it ends with `dev`.

## The session

`soundor dev` writes a protected session descriptor and prints its path:

```text
DevTools: http://localhost:4545
DevTools session file: /tmp/soundor-devtools-a1b2c3/0d6e….json
```

Connect with it, in one of these ways:

```ts
import { connect } from '@soundor/driver';

// The descriptor, by path.
const driver = await connect({
  descriptorPath: '/tmp/soundor-devtools-…/….json',
});

// The same, from $SOUNDOR_DEVTOOLS_SESSION (as the plugin itself gets it).
const fromEnvironment = await connect();

// The endpoint and the descriptor's browserKey, for a client that cannot
// read the file: the key defaults to $SOUNDOR_DEVTOOLS_BROWSER_KEY.
const explicit = await connect({
  endpoint: 'http://127.0.0.1:4545',
  browserKey: process.env.SOUNDOR_DEVTOOLS_BROWSER_KEY,
});
```

The descriptor is the convenient way: it is private to your user, and the
Driver reads only its endpoint and `browserKey`. The endpoint must be
`http://127.0.0.1:<port>` (or `localhost`): DevTools never listens anywhere
else. Sessions are never discovered by scanning ports.

The Driver signs in as a control client, like a DevTools browser tab: it
exchanges the key for the session's cookie and opens the dashboard's
WebSocket with the session's Origin. It never registers as a runtime.

## Targets

A target is one running instance of a plugin. `targets()` lists them:

```ts
for (const target of await driver.targets())
  console.log(target.id, target.name, target.generation, target.capabilities);
```

The Driver works with one target. With one instance running, that is it.
With several, select one when connecting, by its ID or by a unique plugin
name; otherwise commands fail with `AMBIGUOUS_TARGET`:

```ts
const driver = await connect({ targetId: '3f0c…' });
const byName = await connect({ targetName: 'Orbit' });
```

An unknown selection fails at once with `TARGET_NOT_FOUND`. `target()`
returns the selected target; `waitForTarget({ timeout })` waits for an
instance to connect when none runs yet.

Once selected, a target is for good. When it disconnects (the plugin quit,
or the session restarted), every call fails with `TARGET_DISCONNECTED`: the
Driver never moves to another instance, even one with the same name.
Connect again to work with it.

A reload (`soundor dev` reloading the UI) keeps the target and starts a new
**generation**. Node references of the old generation fail with
`STALE_NODE`; a command the reload interrupted fails with
`GENERATION_CHANGED`. [Locators](/docs/driver/inspecting#locators) find
their node again by themselves.

## Control

Reading (the tree, nodes, locators) needs no control of the target, and works
while the DevTools dashboard or another client controls it. Commands that
change the target need its exclusive control lease, as the dashboard's
**Request control** does.

## Timeouts and cancellation

Each command waits 10 seconds by default; set `timeout` (milliseconds) on
`connect()` for all of them, or on a call. A call also takes an
`AbortSignal`:

```ts
const controller = new AbortController();
const tree = await driver.getTree({
  timeout: 2000,
  signal: controller.signal,
});
```

A timed-out or cancelled call fails with `TIMEOUT` or `CANCELLED`, and the
server tells the instance to drop the command. `connectTimeout` and `signal`
on `connect()` limit signing in.

`disconnect()` closes the connection; it is idempotent. Pending calls fail
with `DISCONNECTED`, and the server releases whatever the client controlled.

## Errors

Every failure is a `DriverError` with a stable `code` and a message that says
what to do. Messages never contain keys.

```ts
import { isDriverError } from '@soundor/driver';

try {
  await driver.getByDebugId('reset').getNode();
} catch (error) {
  if (isDriverError(error, 'ELEMENT_NOT_FOUND')) console.log('Not rendered');
  else throw error;
}
```

| Code                    | Meaning                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `INVALID_OPTIONS`       | Invalid options or arguments.                                          |
| `INVALID_DESCRIPTOR`    | The descriptor is missing (the session ended), unprotected or not one. |
| `AUTHENTICATION_FAILED` | The server rejected the key or the connection.                         |
| `SERVER_UNAVAILABLE`    | No DevTools server answers at the endpoint.                            |
| `DISCONNECTED`          | The connection closed.                                                 |
| `NO_TARGETS`            | No instance runs in the session.                                       |
| `TARGET_NOT_FOUND`      | No instance has the selected ID or name.                               |
| `AMBIGUOUS_TARGET`      | Several instances run (or share the name); select one.                 |
| `TARGET_DISCONNECTED`   | The selected instance disconnected.                                    |
| `GENERATION_CHANGED`    | The instance reloaded during the command.                              |
| `STALE_NODE`            | The node reference is from an earlier generation, or the node went.    |
| `LEASE_BUSY`            | Another client controls the instance.                                  |
| `LEASE_REQUIRED`        | The command needs control of the instance.                             |
| `BUSY`                  | The instance is busy with another interactive command.                 |
| `MISSING_CAPABILITY`    | The instance does not support the command.                             |
| `ELEMENT_NOT_FOUND`     | No node matches the locator.                                           |
| `AMBIGUOUS_ELEMENT`     | Several nodes match the locator.                                       |
| `TIMEOUT`               | The command did not finish in time.                                    |
| `CANCELLED`             | The command was cancelled.                                             |
| `PROTOCOL`              | Mismatched Soundor packages, or an invalid message.                    |
| `INTERNAL`              | The instance failed while handling the command.                        |
