---
title: 'user.clear'
description: 'Clicks a text input, selects its text and deletes it.'
---

```ts
await user.clear(input: NodeTarget): Promise<void>;
```

Clicks the text input, selects all of its text and presses Backspace: the
input fires its input events as it empties.

```ts
await user.clear(screen.getByRole('textinput', { name: 'Preset name' }));
await user.type(
  screen.getByRole('textinput', { name: 'Preset name' }),
  'Bright',
);
```

## Good to know

- **Only a `TextInput`:** clearing another node throws.
- A controlled input (`value` and `onChangeText`) gets `onChangeText('')`,
  as it would from a user.
