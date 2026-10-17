---
title: 'CLI reference'
description: 'soundor driver: inspect a running plugin from the command line, for people and for scripts and agents.'
---

`soundor driver` runs Soundor Driver from the
[CLI](/docs/cli): each command connects to the session, does one thing,
prints its result and disconnects, releasing anything it controlled. There is
no background process.

```sh
soundor driver targets
soundor driver tree --json
soundor driver inspect reset
```

`soundor driver <command> --help` describes a command and its options.

## Commands

| Command             | Prints                                                               |
| ------------------- | -------------------------------------------------------------------- |
| `targets`           | The instances connected to the session.                              |
| `tree`              | The target's native UI tree.                                         |
| `inspect <debugId>` | A node's details: bounds, properties, layout, styles, accessibility. |

`inspect` finds its node by a `debugId`, or instead by `--role <role>` (with
`--name <name>`) or `--text <text>`, as the
[locators](/docs/driver/inspecting#locators) do.

## Options

Every command takes these:

| Option                 | Default                     | What it does                                                                              |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `--descriptor <path>`  | `$SOUNDOR_DEVTOOLS_SESSION` | The session descriptor `soundor dev` prints as "DevTools session file".                   |
| `--endpoint <url>`     |                             | The session's `http://127.0.0.1:<port>`, with the key in `$SOUNDOR_DEVTOOLS_BROWSER_KEY`. |
| `--target <id>`        | the only instance           | The instance, by target ID, when several run.                                             |
| `--target-name <name>` |                             | The instance, by plugin name, when that is unique.                                        |
| `--json`               |                             | The result as JSON on stdout; an error as JSON on stderr.                                 |
| `--timeout <duration>` | `10s`                       | How long connecting and each step may take: `500ms`, `5s`, `1m`.                          |

The browser key is never an argument (arguments show in process lists and
shell history): it comes from the descriptor, or from the environment.

## Output

Results go to stdout, and nothing else does: no banners, no colors. With
`--json`, stdout is exactly one JSON document:

- `targets`: an array of targets (`id`, `name`, `runtime`, `generation`,
  `capabilities`, `controller`);
- `tree`: the tree snapshot (`generation`, `revision`, `roots`, `nodes`,
  `truncated`);
- `inspect`: the node with its details.

Their shapes are those of [inspection](/docs/driver/inspecting).

Errors go to stderr: `soundor driver: <message> (<CODE>)`, or with `--json`

```json
{
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "getByDebugId(\"reset\") matches no node"
  }
}
```

with a [Driver error code](/docs/driver/connecting#errors).

## Exit codes

| Code | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| 0    | Success.                                                                             |
| 1    | Another failure: mismatched packages, or the instance failed.                        |
| 2    | Invalid arguments or options, or several instances run and none was selected.        |
| 3    | Authentication failed, or the session descriptor is missing or unusable.             |
| 4    | No server, no instance, or the instance disconnected or reloaded during the command. |
| 5    | No node, several nodes, or a stale node for the query.                               |
| 6    | Another client controls the instance, or it is busy.                                 |
| 7    | The command timed out or was cancelled.                                              |
| 8    | The instance does not support the command.                                           |
