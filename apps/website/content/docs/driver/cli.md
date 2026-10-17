---
title: 'CLI reference'
description: 'soundor driver: inspect and control a running plugin from the command line, for people and for scripts and agents.'
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

| Command             | Prints                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `targets`           | The instances connected to the session.                                                                |
| `tree`              | The target's native UI tree.                                                                           |
| `inspect <debugId>` | A node's details: bounds, properties, layout, styles, accessibility.                                   |
| `click <debugId>`   | Clicks the node once it is actionable (`--button left`, `middle` or `right`).                          |
| `hover <debugId>`   | Moves the pointer over the node.                                                                       |
| `focus <debugId>`   | Gives a focusable node keyboard focus.                                                                 |
| `drag <debugId>`    | Drags from the node by `--dx`/`--dy` pixels, in `--steps` moves (5).                                   |
| `scroll <debugId>`  | Scrolls the wheel over the node by `--dx`/`--dy`; or at `--x`/`--y`.                                   |
| `move --x --y`      | Moves the pointer to a point of the view, in logical pixels.                                           |
| `key <key>`         | Presses a key in the focused node: `Enter`, `Control+a`.                                               |
| `type <text>`       | Types text into the focused node.                                                                      |
| `screenshot <path>` | Saves a PNG of the view as the engine renders it; of one node with `--debug-id`, `--role` or `--text`. |

Commands that act on a node find it by a `debugId`, or instead by
`--role <role>` (with `--name <name>`) or `--text <text>`, as the
[locators](/docs/driver/inspecting#locators) do, and wait until it is
[actionable](/docs/driver/interacting#actionability) for up to `--timeout`.
`key` and `type` take `--debug-id <id>` to focus a node first.

Input commands take control of the target, act, and give control back before
they exit, as the [Driver](/docs/driver/interacting#control-and-cleanup)
does; they fail with exit code 6 while another client controls it.

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
- `inspect`: the node with its details;
- `click`, `hover`, `drag`, `scroll`, `move`, `key`: what the input reached,
  `{ "handled": true, "node": { "generation": 1, "id": "12" } }`; `focus`:
  `{ "focused": true }`; `type`: `{ "typed": <characters> }`;
- `screenshot`: where it saved the PNG, and its `width`, `height`, `scale`,
  `format` and `bytes`. The image itself goes only to the file, never to
  stdout.

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
| 5    | No node, several nodes, a stale node, or one that cannot take the input.             |
| 6    | Another client controls the instance, or it is busy.                                 |
| 7    | The command timed out or was cancelled.                                              |
| 8    | The instance does not support the command, or cannot capture its view now.           |
