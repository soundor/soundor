---
title: 'user.keyboard'
description: 'Presses keys: characters, named keys, held modifiers, physical keys.'
---

```ts
await user.keyboard(keys: string): Promise<void>;
```

Presses and releases keys on the focused node, in order. Characters are
typed as they are; named and held keys are written in braces.

```ts
await user.keyboard('{ArrowUp}'); // one key
await user.keyboard('{Shift>}{ArrowUp}{/Shift}'); // Shift held around ArrowUp
await user.keyboard('{Control>}a{/Control}{Backspace}'); // select all, delete
await user.keyboard('[KeyA]'); // a physical key, by its code
await user.keyboard('{{'); // a literal {
```

| Written    | What it presses                                                    |
| ---------- | ------------------------------------------------------------------ |
| `a`        | The key for that character, down and up.                           |
| `{Enter}`  | A named key (`Enter`, `Tab`, `Escape`, `ArrowUp`, `Backspace`, …). |
| `{Shift>}` | Holds the key down, until `{/Shift}` releases it.                  |
| `[KeyA]`   | A physical key, by its code (`KeyA`, `Digit1`).                    |
| `{{`, `[[` | A literal `{` or `[`.                                              |

## Good to know

- **Keys go to the focused node**: focus it first, with
  [`click`](/docs/testing/click) or [`tab`](/docs/testing/tab).
- **Default actions follow:** Tab moves focus, Enter presses a focused
  button, a text input edits itself (unless a listener prevents it).
- **Soundor's editing rules,** not a keyboard layout or an input method:
  what is typed is the character written.
