---
title: soundor:fs
description: Files in the plugin's private data directory.
---

Asynchronous file access, confined to the plugin's own data directory:
presets, user content, caches. The user's other files are never reachable.

```ts
import { readText, writeText, readDir } from 'soundor:fs';

await writeText('presets/warm.json', JSON.stringify(preset));
const warm = JSON.parse(await readText('presets/warm.json'));
const presets = await readDir('presets');
```

## Functions

| Function                       | What it does                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `readText(path)`               | The file's text (UTF-8).                                                                                     |
| `readBytes(path)`              | The file's bytes, as a `Uint8Array`.                                                                         |
| `writeText(path, text)`        | Replaces the file with `text`, atomically, creating missing parent directories.                              |
| `writeBytes(path, data)`       | The same, with an `ArrayBuffer` or a typed array.                                                            |
| `readDir(path?)`               | The directory's entries (the root without `path`): `{ name, kind }`, `kind` being `'file'` or `'directory'`. |
| `mkdir(path, { recursive? })`  | Makes a directory; with `recursive`, its parents too.                                                        |
| `remove(path, { recursive? })` | Removes a file, or a directory (with `recursive`, and what is in it).                                        |
| `stat(path)`                   | `{ kind, size, modified }` (`modified` in milliseconds since 1970), or `null` when nothing is there.         |
| `exists(path)`                 | Whether something is there.                                                                                  |

Every function returns a promise.

- **Paths** are relative and `/`-separated (`'presets/warm.json'`). `..`,
  absolute paths, and symlinks leading out of the directory are refused.
- **Writes are atomic:** a file is replaced whole or not at all.
- **Errors** are `DOMException`s, as on the Web: `NotFoundError`,
  `NotAllowedError`, and the like, the same in every runtime.
- **Where:** natively, `files/` in the plugin's private data directory (JUCE:
  `<user application data>/Soundor/<plugin.id>`); in the browser, a private
  file tree in IndexedDB.
