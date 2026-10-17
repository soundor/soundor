---
title: 'ByLabelText'
description: 'Finds nodes by their accessibility label.'
---

```ts
screen.getByLabelText(text: TextMatch, options?: MatchOptions): TestNode;
// also queryByLabelText, getAllByLabelText, queryAllByLabelText, findByLabelText, findAllByLabelText
```

Finds nodes by their `accessibilityLabel`: a text input called "Preset
name", a knob called "Gain".

```ts
await user.type(screen.getByLabelText('Preset name'), 'Warm');
```

## Good to know

- **Only `accessibilityLabel`** labels a node: there is no HTML `<label>`
  association in Soundor.
- **Prefer [`ByRole`](/docs/testing/by-role)** with a `name` when the role
  matters too: `getByRole('textinput', { name: 'Preset name' })`.
- Options as for every [query](/docs/testing/queries#text-matching).
