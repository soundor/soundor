---
title: 'user.type'
description: 'Clicks a text input and types text into it, character by character.'
---

```ts
await user.type(input: NodeTarget, text: string): Promise<void>;
```

Clicks the text input, which focuses it, then types `text` one character
at a time, each a key down and up that the input edits
itself with, as it does for a user.

```ts
const name = screen.getByRole('textinput', { name: 'Preset name' });
await user.clear(name);
await user.type(name, 'Warm');
await user.keyboard('{Enter}');
```

## Good to know

- **The text is literal:** `{` and `[` are typed as they are. For Enter,
  arrows or held keys, use [`keyboard`](/docs/testing/keyboard).
- **It does not empty the input first:** [`clear`](/docs/testing/clear) it
  to replace its text.
- **Only a `TextInput`:** typing into another node throws.
