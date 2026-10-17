---
title: soundor:storage
description: Persistent JSON key/value storage, private to the plugin.
---

Small persistent data: preferences, the last preset's name, a window's
state. Values are JSON data, kept per plugin (by `plugin.id`) and shared by
its instances.

```ts
import { storage } from 'soundor:storage';

await storage.set('lastPreset', 'warm');
const name = await storage.get<string>('lastPreset'); // 'warm', or undefined
```

## `storage`

| Method            | What it does                                  |
| ----------------- | --------------------------------------------- |
| `get(key)`        | The value stored under `key`, or `undefined`. |
| `set(key, value)` | Stores `value` (JSON data) under `key`.       |
| `delete(key)`     | Removes `key`.                                |
| `keys()`          | Every key.                                    |
| `clear()`         | Removes every key.                            |

Every method returns a promise.

- **Where:** natively, `storage.json` in the plugin's private data directory
  (JUCE: `<user application data>/Soundor/<plugin.id>`), safe across instances
  in one process; in the browser, IndexedDB, one database per `plugin.id`.
- **For files** (presets, samples, anything large), use
  [`soundor:fs`](/docs/api/fs).
- **Parameters are not storage:** the host saves them with the project; see
  [`soundor:parameters`](/docs/api/parameters).
